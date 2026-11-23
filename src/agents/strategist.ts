import { and, eq } from 'drizzle-orm';
import type { Database } from '@/db';
import { campaigns, offerProfiles, projects } from '@/db/schema';
import { recordEvent } from '@/lib/audit';
import { NotFound, ValidationError } from '@/lib/errors';
import { complete } from '@/lib/openai';
import { strategySchema, type Strategy } from '@/lib/schemas';

const SYSTEM = `You are a B2B outbound sales strategist. Given an offer profile and an audience, design a cold outreach campaign that a fully autonomous system will execute.
Rules:
- icp: one precise sentence describing the ideal customer.
- discoveryQueries: 4-8 queries the lead finder will run.
  - For local businesses use kind "places": query is a business category (e.g. "plumbers"), location is a city/region (e.g. "Sydney NSW, Australia").
  - For anything else use kind "search": Google queries that surface business websites likely to publish a contact email (directories, associations, niche + city + "contact").
- angles: exactly 3 distinct message angles. hook = the personalized observation to open with; pitch = the value proposition tie-in.
- sequence: exactly 3 steps — step 0 delayDays 0 (opener), step 1 delayDays 3 (gentle bump, new angle), step 2 delayDays 7 (final, low-pressure close). guidance instructs the copywriter.
- objectionHandling: 4 likely objections with factual responses drawn ONLY from the offer profile.
- sampleEmail: a plain-text opener under 120 words. Short sentences. No spam-trigger words (free, guarantee, act now, limited time, !!!). No fabricated claims. Soft call to action consistent with the sales goal. Sign-off placeholder: {{sender_name}}.
- Everything must be truthful to the offer profile. Never invent prices or results.`;

export async function buildStrategy(
  db: Database,
  input: { organizationId: string; campaignId: string },
): Promise<Strategy> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(
      and(eq(campaigns.id, input.campaignId), eq(campaigns.organizationId, input.organizationId)),
    )
    .limit(1);
  if (!campaign) throw new NotFound('Campaign not found');

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, campaign.projectId), eq(projects.organizationId, input.organizationId)))
    .limit(1);
  const [offer] = await db
    .select()
    .from(offerProfiles)
    .where(eq(offerProfiles.projectId, campaign.projectId))
    .limit(1);
  if (!project || !offer) throw new ValidationError('Analyze the offer before building a strategy');

  const strategy = await complete(db, {
    organizationId: input.organizationId,
    campaignId: campaign.id,
    operation: 'strategy',
    tier: 'smart',
    schema: strategySchema,
    name: 'campaign_strategy',
    system: SYSTEM,
    user: `Offer profile:\n${JSON.stringify(offer.profile)}\n\nSales goal: ${project.goal}\nClose link: ${project.closeLink ?? '(none — propose a reply or call)'}\nClose notes: ${project.closeNotes ?? '(none)'}\n\nAudience:\n${JSON.stringify(campaign.audience)}\nDaily volume: ${campaign.dailyVolume}`,
    maxTokens: 6000,
  });

  await db
    .update(campaigns)
    .set({ strategy, updatedAt: new Date() })
    .where(eq(campaigns.id, campaign.id));

  await recordEvent(db, {
    organizationId: input.organizationId,
    action: 'strategy.built',
    subjectType: 'campaign',
    subjectId: campaign.id,
  });

  return strategy;
}