import type PgBoss from 'pg-boss';
import { and, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { db, type Database } from '@/db';
import { campaigns, conversations, leads, mailboxes, messages, orgSettings, suppressions } from '@/db/schema';
import type { Campaign, Lead, Mailbox } from '@/db/schema';
import { writeSequence } from '@/agents/copywriter';
import { buildFooter, newMessageId, sendEmail } from '@/lib/email';
import { NotFound } from '@/lib/errors';
import { enqueue, QUEUES } from '@/lib/queue';
import { effectiveDailyCap, jitter, nextSendWindow, outboundCountToday } from '@/lib/sending';
import { shortRef } from '@/lib/tokens';

export async function sendTick(d: Database): Promise<void> {
  const active = await d.select().from(campaigns).where(eq(campaigns.status, 'active'));
  const now = new Date();

  for (const campaign of active) {
    const [mailbox] = await d
      .select()
      .from(mailboxes)
      .where(and(eq(mailboxes.id, campaign.mailboxId), isNull(mailboxes.archivedAt)))
      .limit(1);
    if (!mailbox) continue;

    const needCopy = await d
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.campaignId, campaign.id),
          eq(leads.status, 'audited'),
          isNotNull(leads.email),
          isNull(leads.sequence),
        ),
      )
      .limit(campaign.dailyVolume * 2);
    for (const lead of needCopy) {
      await enqueue(
        QUEUES.writeSequence,
        { organizationId: campaign.organizationId, leadId: lead.id },
        { singletonKey: `copy:${lead.id}` },
      );
    }

    const cap = effectiveDailyCap(mailbox, campaign, now);
    const already = await outboundCountToday(d, mailbox.id);
    const remaining = cap - already;
    if (remaining <= 0) continue;

    const due = await d
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.campaignId, campaign.id),
          inArray(leads.status, ['queued', 'contacted']),
          lte(leads.nextSendAt, now),
          isNotNull(leads.sequence),
          isNotNull(leads.email),
          isNull(leads.repliedAt),
        ),
      )
      .orderBy(leads.nextSendAt)
      .limit(remaining);

    for (const lead of due) {
      await d.update(leads).set({ nextSendAt: null }).where(eq(leads.id, lead.id));
      await enqueue(
        QUEUES.sendEmail,
        { organizationId: campaign.organizationId, leadId: lead.id },
        { singletonKey: `send:${lead.id}:${lead.stepIndex}` },
      );
    }
  }
}

async function shouldSkip(
  d: Database,
  lead: Lead,
  campaign: Campaign,
): Promise<string | null> {
  if (campaign.status !== 'active') return 'campaign not active';
  if (!lead.email) return 'no email';
  if (lead.repliedAt) return 'replied — stop on reply';
  if (!['queued', 'contacted'].includes(lead.status)) return `status ${lead.status}`;
  if (!lead.sequence || lead.stepIndex >= lead.sequence.steps.length) return 'sequence exhausted';

  const [suppressed] = await d
    .select()
    .from(suppressions)
    .where(eq(suppressions.email, lead.email.toLowerCase()))
    .limit(1);
  if (suppressed) return 'suppressed';

  const [conversation] = await d
    .select()
    .from(conversations)
    .where(eq(conversations.leadId, lead.id))
    .limit(1);
  if (conversation && conversation.state !== 'ai_active') return `conversation ${conversation.state}`;
  return null;
}

export async function sendLeadEmail(
  d: Database,
  input: { organizationId: string; leadId: string },
): Promise<void> {
  const [lead] = await d
    .select()
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, input.organizationId)))
    .limit(1);
  if (!lead) throw new NotFound('Lead not found');

  const [campaign] = await d.select().from(campaigns).where(eq(campaigns.id, lead.campaignId)).limit(1);
  if (!campaign) throw new NotFound('Campaign not found');

  const skip = await shouldSkip(d, lead, campaign);
  if (skip) {
    await d.update(leads).set({ nextSendAt: null }).where(eq(leads.id, lead.id));
    return;
  }

  const [mailbox] = await d.select().from(mailboxes).where(eq(mailboxes.id, campaign.mailboxId)).limit(1);
  if (!mailbox) throw new NotFound('Mailbox not found');

  const [settings] = await d
    .select()
    .from(orgSettings)
    .where(eq(orgSettings.organizationId, input.organizationId))
    .limit(1);

  const step = lead.sequence!.steps[lead.stepIndex]!;
  const isFirst = lead.stepIndex === 0;
  const messageId = newMessageId(mailbox.email);
  const replyToken = shortRef();
  const body = step.body + buildFooter(settings?.senderName ?? mailbox.fromName, settings?.senderAddress ?? null);

  const [previous] = await d
    .select()
    .from(messages)
    .where(
      and(eq(messages.leadId, lead.id), eq(messages.direction, 'outbound'), eq(messages.status, 'sent')),
    )
    .orderBy(messages.at)
    .limit(1);

  const msgId = uuidv7();
  await d.insert(messages).values({
    id: msgId,
    organizationId: input.organizationId,
    campaignId: campaign.id,
    leadId: lead.id,
    direction: 'outbound',
    kind: isFirst ? 'opener' : 'followup',
    status: 'queued',
    messageId,
    inReplyTo: isFirst ? null : (previous?.messageId ?? null),
    replyToken,
    subject: step.subject,
    body,
  });

  try {
    await sendEmail(mailbox, {
      to: lead.email!,
      subject: step.subject,
      body,
      messageId,
      inReplyTo: isFirst ? null : (previous?.messageId ?? null),
      replyToken,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await d.update(messages).set({ status: 'failed', error }).where(eq(messages.id, msgId));
    await d
      .update(leads)
      .set({ nextSendAt: new Date(Date.now() + 3_600_000), updatedAt: new Date() })
      .where(eq(leads.id, lead.id));
    await d.update(mailboxes).set({ lastError: error }).where(eq(mailboxes.id, mailbox.id));
    throw err;
  }

  const now = new Date();
  await d.update(messages).set({ status: 'sent', at: now }).where(eq(messages.id, msgId));
  await d.update(mailboxes).set({ lastError: null }).where(eq(mailboxes.id, mailbox.id));

  const nextStep = lead.stepIndex + 1;
  const steps = lead.sequence!.steps;
  const delays = campaign.strategy?.sequence ?? [];
  const currentDelay = delays[lead.stepIndex]?.delayDays ?? 0;
  const nextDelay = delays[nextStep]?.delayDays ?? currentDelay + 4;
  const nextSendAt =
    nextStep < steps.length
      ? nextSendWindow(
          new Date(now.getTime() + Math.max(1, nextDelay - currentDelay) * 86_400_000),
          lead.timezone,
          jitter(30),
        )
      : null;

  await d
    .update(leads)
    .set({
      status: 'contacted',
      stepIndex: nextStep,
      lastContactAt: now,
      nextSendAt,
      updatedAt: now,
    })
    .where(eq(leads.id, lead.id));

  await d
    .insert(conversations)
    .values({
      id: uuidv7(),
      organizationId: input.organizationId,
      campaignId: campaign.id,
      leadId: lead.id,
      state: 'ai_active',
      rootMessageId: messageId,
    })
    .onConflictDoNothing({ target: conversations.leadId });
}

const copyJob = z.object({ organizationId: z.string(), leadId: z.string() });
const sendJob = z.object({ organizationId: z.string(), leadId: z.string() });

export function registerSendJobs(boss: PgBoss): Promise<unknown> {
  return Promise.all([
    boss.work(QUEUES.writeSequence, { batchSize: 2 }, async (jobs) => {
      await Promise.all(jobs.map((job) => writeSequence(db(), copyJob.parse(job.data))));
    }),
    boss.work(QUEUES.sendEmail, async (jobs) => {
      for (const job of jobs) {
        await sendLeadEmail(db(), sendJob.parse(job.data));
      }
    }),
    boss.work(QUEUES.sendTick, async () => {
      await sendTick(db());
    }),
  ]);
}