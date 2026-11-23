import { and, eq } from 'drizzle-orm';
import type { Database } from '@/db';
import { campaigns, leads, offerProfiles, orgSettings, projects } from '@/db/schema';
import { NotFound, ValidationError } from '@/lib/errors';
import { complete } from '@/lib/openai';
import { leadSequenceSchema, type LeadSequence } from '@/lib/schemas';
import { jitter, nextSendWindow } from '@/lib/sending';
import { z } from 'zod';

const SPAM_PATTERNS: Array<[RegExp, string]> = [
  [/(?<!feel )\bfree\b/i, '"free"'],
  [/\bguarantee[d]?\b/i, '"guarantee"'],
  [/\bact now\b/i, '"act now"'],
  [/\blimited time\b/i, '"limited time"'],
  [/\bbuy now\b/i, '"buy now"'],
  [/\bclick here\b/i, '"click here"'],
  [/\brisk[- ]free\b/i, '"risk-free"'],
  [/\b100%\b/, '"100%"'],
  [/!!!/, 'triple exclamation marks'],
  [/\bwinner\b/i, '"winner"'],
  [/\burgent\b/i, '"urgent"'],
];

export function lintCopy(steps: Array<{ subject: string; body: string }>): string[] {
  const problems: string[] = [];
  steps.forEach((s, i) => {
    if (s.subject.length > 90) problems.push(`step ${i}: subject over 90 chars`);
    const words = s.body.split(/\s+/).filter(Boolean).length;
    if (words > 150) problems.push(`step ${i}: body over 150 words (${words})`);
    if (words < 10) problems.push(`step ${i}: body too short`);
    for (const [re, label] of SPAM_PATTERNS) {
      if (re.test(s.subject) || re.test(s.body)) problems.push(`step ${i}: spam-trigger ${label}`);
    }
  });
  return problems;
}

const copySchema = z
  .object({
    steps: z.array(z.object({ subject: z.string(), body: z.string() })).min(2).max(4),
  })
  .superRefine((val, ctx) => {
    const problems = lintCopy(val.steps);
    for (const p of problems) {
      ctx.addIssue({ code: 'custom', message: p });
    }
  });

const SYSTEM = `You write cold outreach emails that a fully autonomous system sends from a real person's mailbox.
Rules:
- Plain text only. No markdown, no links except the close link when the guidance says to include it.
- Every email under 120 words. Short sentences. Sounds like a busy human, not a marketer.
- Step 0 opens with the personalized hook about THEIR business, then one sentence tying it to the offer, then a soft question. Never pitch hard in step 0.
- Later steps follow the sequence guidance: new angle, no "just following up" clichés, final step is a polite take-away.
- Subjects: lowercase, short, specific, curiosity without clickbait. Reply-style "re:" is forbidden.
- Truthful to the offer profile only. Never invent prices, results, clients or claims.
- No spam-trigger words: free, guarantee, act now, limited time, buy now, click here, risk-free, 100%, urgent, winner, !!!.
- Sign every email with the placeholder {{sender_name}} on its own line.
- Never use "I hope this email finds you well" or similar filler.`;

export async function writeSequence(
  db: Database,
  input: { organizationId: string; leadId: string },
): Promise<LeadSequence> {
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)))
    .limit(1);
  if (!lead) throw new NotFound('Lead not found');
  if (!lead.email) throw new ValidationError('Lead has no email');

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, lead.campaignId))
    .limit(1);
  if (!campaign?.strategy) throw new ValidationError('Campaign has no strategy');

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, campaign.projectId))
    .limit(1);
  const [offer] = await db
    .select()
    .from(offerProfiles)
    .where(eq(offerProfiles.projectId, campaign.projectId))
    .limit(1);
  if (!project || !offer) throw new ValidationError('Project offer missing');

  const [settings] = await db
    .select()
    .from(orgSettings)
    .where(eq(orgSettings.organizationId, input.organizationId))
    .limit(1);
  const senderName = settings?.senderName ?? 'The team';

  const sequenceGuidance = campaign.strategy.sequence
    .map((s) => `step ${s.step} (day ${s.delayDays}): goal=${s.goal}; ${s.guidance}`)
    .join('\n');

  const result = await complete(db, {
    organizationId: input.organizationId,
    campaignId: campaign.id,
    operation: 'copywriting',
    tier: 'bulk',
    schema: copySchema,
    name: 'lead_sequence',
    system: SYSTEM,
    user: `Write exactly ${campaign.strategy.sequence.length} steps.

Lead:
- business: ${lead.businessName}
- website: ${lead.website ?? 'unknown'}
- city: ${lead.city ?? 'unknown'}
- personalized hook: ${lead.hook ?? 'their website could do more to win customers'}
- audit findings: ${lead.audit?.issues.join('; ') || 'none'}

Offer profile:
${JSON.stringify(offer.profile)}

Sales goal: ${project.goal}
Close link (use only in the final step if natural): ${project.closeLink ?? 'none — ask for a reply instead'}

Angles:
${JSON.stringify(campaign.strategy.angles)}

Sequence guidance:
${sequenceGuidance}`,
    maxTokens: 3000,
  });

  const sequence: LeadSequence = {
    steps: result.steps.map((s) => ({
      subject: s.subject.replaceAll('{{sender_name}}', senderName),
      body: s.body.replaceAll('{{sender_name}}', senderName),
    })),
  };

  await db
    .update(leads)
    .set({
      sequence,
      status: lead.status === 'audited' ? 'queued' : lead.status,
      nextSendAt:
        lead.status === 'audited'
          ? nextSendWindow(new Date(), lead.timezone, jitter(20))
          : lead.nextSendAt,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, lead.id));

  return sequence;
}