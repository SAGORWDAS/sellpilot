import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import type PgBoss from 'pg-boss';
import { db, type Database } from '@/db';
import { campaigns, conversations, leads, mailboxes, messages, offerProfiles, orgSettings, projects, suppressions } from '@/db/schema';
import { closeSnippet, notifyHotLead } from '@/agents/closer';
import { recordEvent } from '@/lib/audit';
import { buildFooter, newMessageId, sendEmail } from '@/lib/email';
import { NotFound } from '@/lib/errors';
import { complete } from '@/lib/openai';
import { QUEUES } from '@/lib/queue';
import { replyDecisionSchema, type ReplyCategory } from '@/lib/schemas';
import { shortRef } from '@/lib/tokens';

const UNSUBSCRIBE_RE = /\bunsubscribe\b|\bstop emailing\b|\bremove me\b|\bdo not (?:email|contact)\b|\bnot interested.{0,30}\bstop\b/i;
const BOUNCE_FROM_RE = /^(mailer-daemon|postmaster)@/i;

async function suppress(d: Database, email: string, reason: string): Promise<void> {
  await d
    .insert(suppressions)
    .values({ email: email.toLowerCase(), reason })
    .onConflictDoNothing();
}

export async function handleReply(
  d: Database,
  input: { organizationId: string; messageId: string },
): Promise<void> {
  const [message] = await d
    .select()
    .from(messages)
    .where(and(eq(messages.id, input.messageId), eq(messages.organizationId, input.organizationId)))
    .limit(1);
  if (!message || message.direction !== 'inbound') throw new NotFound('Inbound message not found');

  const [lead] = await d.select().from(leads).where(eq(leads.id, message.leadId)).limit(1);
  if (!lead) throw new NotFound('Lead not found');
  const [campaign] = await d.select().from(campaigns).where(eq(campaigns.id, message.campaignId)).limit(1);
  const [project] = campaign
    ? await d.select().from(projects).where(eq(projects.id, campaign.projectId)).limit(1)
    : [null];
  const [offer] = campaign
    ? await d.select().from(offerProfiles).where(eq(offerProfiles.projectId, campaign.projectId)).limit(1)
    : [null];
  const [settings] = await d
    .select()
    .from(orgSettings)
    .where(eq(orgSettings.organizationId, input.organizationId))
    .limit(1);
  const [conversation] = await d
    .select()
    .from(conversations)
    .where(eq(conversations.leadId, lead.id))
    .limit(1);
  const [mailbox] = campaign
    ? await d.select().from(mailboxes).where(eq(mailboxes.id, campaign.mailboxId)).limit(1)
    : [null];
  if (!campaign || !project || !mailbox) throw new NotFound('Campaign context missing');

  const setConversation = async (state: 'ai_active' | 'closed' | 'suppressed', category: ReplyCategory) => {
    if (!conversation) return;
    await d
      .update(conversations)
      .set({ state, lastCategory: category, updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id));
  };

  if (BOUNCE_FROM_RE.test(message.fromAddress ?? '')) {
    await d.update(messages).set({ category: 'bounce' }).where(eq(messages.id, message.id));
    if (lead.email) await suppress(d, lead.email, 'bounce');
    await d.update(leads).set({ status: 'bounced', nextSendAt: null, updatedAt: new Date() }).where(eq(leads.id, lead.id));
    await setConversation('suppressed', 'bounce');
    await recordEvent(d, {
      organizationId: input.organizationId,
      action: 'lead.bounced',
      subjectType: 'lead',
      subjectId: lead.id,
    });
    return;
  }

  if (UNSUBSCRIBE_RE.test(message.subject) || UNSUBSCRIBE_RE.test(message.body.slice(0, 1000))) {
    await d.update(messages).set({ category: 'unsubscribe' }).where(eq(messages.id, message.id));
    if (lead.email) await suppress(d, lead.email, 'unsubscribe');
    await d.update(leads).set({ status: 'suppressed', nextSendAt: null, updatedAt: new Date() }).where(eq(leads.id, lead.id));
    await setConversation('suppressed', 'unsubscribe');
    await recordEvent(d, {
      organizationId: input.organizationId,
      action: 'lead.unsubscribed',
      subjectType: 'lead',
      subjectId: lead.id,
    });
    return;
  }

  const thread = await d
    .select()
    .from(messages)
    .where(eq(messages.leadId, lead.id))
    .orderBy(asc(messages.at))
    .limit(20);
  const threadText = thread
    .map((m) => `[${m.direction === 'outbound' ? 'US' : 'THEM'} | ${m.subject}]\n${m.body.slice(0, 1500)}`)
    .join('\n\n');

  const decision = await complete(d, {
    organizationId: input.organizationId,
    campaignId: campaign.id,
    operation: 'reply-handling',
    tier: 'bulk',
    schema: replyDecisionSchema,
    name: 'reply_decision',
    system: `You handle replies to cold outreach on behalf of a real sender. Classify the latest reply and decide whether to answer.
Categories: interested, question, objection, not_interested, out_of_office, unsubscribe, bounce, other.
Rules:
- Answer questions and objections factually, ONLY from the offer profile and objection handling notes. Never invent prices, guarantees or results.
- If they show interest, answer briefly and include the close action exactly as instructed below.
- If not interested, either a one-line polite acknowledgement or no reply (shouldReply false). Never argue.
- out_of_office: shouldReply false.
- Keep replies under 90 words, plain text, human, no marketing language, no spam-trigger words (free, guarantee, act now, limited time, 100%, urgent, !!!).
- Sign with {{sender_name}} on its own line.
- reasoning: one sentence for the audit log.`,
    user: `Offer profile:\n${JSON.stringify(offer?.profile ?? {})}\n\nObjection handling:\n${JSON.stringify(campaign.strategy?.objectionHandling ?? [])}\n\nClose action when interested:\n${closeSnippet(project, settings ?? null)}\n\nConversation so far:\n${threadText}\n\nLatest reply to handle:\n${message.body.slice(0, 3000)}`,
    maxTokens: 1500,
  });

  await d.update(messages).set({ category: decision.category }).where(eq(messages.id, message.id));

  if (decision.category === 'unsubscribe') {
    if (lead.email) await suppress(d, lead.email, 'unsubscribe');
    await d.update(leads).set({ status: 'suppressed', nextSendAt: null, updatedAt: new Date() }).where(eq(leads.id, lead.id));
    await setConversation('suppressed', 'unsubscribe');
    return;
  }

  if (decision.category === 'bounce') {
    if (lead.email) await suppress(d, lead.email, 'bounce');
    await d.update(leads).set({ status: 'bounced', nextSendAt: null, updatedAt: new Date() }).where(eq(leads.id, lead.id));
    await setConversation('suppressed', 'bounce');
    return;
  }

  if (decision.category === 'out_of_office') {
    await d
      .update(leads)
      .set({
        status: 'contacted',
        repliedAt: null,
        nextSendAt: new Date(Date.now() + 4 * 86_400_000),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, lead.id));
    await setConversation('ai_active', 'out_of_office');
    return;
  }

  if (decision.category === 'interested') {
    await d.update(leads).set({ status: 'interested', updatedAt: new Date() }).where(eq(leads.id, lead.id));
    if (conversation) {
      await d
        .update(conversations)
        .set({ lastCategory: 'interested', updatedAt: new Date() })
        .where(eq(conversations.id, conversation.id));
    }
    await notifyHotLead(d, mailbox, settings ?? null, lead, decision.reasoning);
  } else if (decision.category === 'not_interested') {
    await setConversation('closed', 'not_interested');
  } else if (conversation) {
    await d
      .update(conversations)
      .set({ lastCategory: decision.category, updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id));
  }

  const aiMayReply = !conversation || conversation.state === 'ai_active';
  if (!decision.shouldReply || !decision.body || !aiMayReply) return;
  if (lead.status === 'suppressed' || lead.status === 'bounced') return;
  if (!lead.email) return;

  const senderName = settings?.senderName ?? mailbox.fromName;
  const body =
    decision.body.replaceAll('{{sender_name}}', senderName) +
    buildFooter(senderName, settings?.senderAddress ?? null);
  const subject =
    decision.subject ??
    (message.subject.toLowerCase().startsWith('re:') ? message.subject : `Re: ${message.subject}`);
  const messageId = newMessageId(mailbox.email);
  const replyToken = shortRef();

  const msgId = uuidv7();
  await d.insert(messages).values({
    id: msgId,
    organizationId: input.organizationId,
    campaignId: campaign.id,
    leadId: lead.id,
    direction: 'outbound',
    kind: decision.category === 'interested' ? 'close' : 'reply',
    status: 'queued',
    messageId,
    inReplyTo: message.messageId,
    replyToken,
    subject,
    body,
  });

  try {
    await sendEmail(mailbox, {
      to: lead.email,
      subject,
      body,
      messageId,
      inReplyTo: message.messageId,
      replyToken,
    });
    await d.update(messages).set({ status: 'sent', at: new Date() }).where(eq(messages.id, msgId));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await d.update(messages).set({ status: 'failed', error }).where(eq(messages.id, msgId));
    throw err;
  }
}

const replyJob = z.object({ organizationId: z.string(), messageId: z.string() });

export function registerReplyJobs(boss: PgBoss): Promise<unknown> {
  return boss.work(QUEUES.handleReply, async (jobs) => {
    for (const job of jobs) {
      await handleReply(db(), replyJob.parse(job.data));
    }
  });
}