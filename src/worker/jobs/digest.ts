import type PgBoss from 'pg-boss';
import { and, count, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { db, type Database } from '@/db';
import { apiUsage, events, mailboxes, messages, orgSettings } from '@/db/schema';
import { newMessageId, sendEmail } from '@/lib/email';
import { QUEUES } from '@/lib/queue';
import { shortRef } from '@/lib/tokens';

export async function dailyDigest(d: Database): Promise<void> {
  const since = new Date(Date.now() - 86_400_000);
  const recipients = await d
    .select()
    .from(orgSettings)
    .where(isNotNull(orgSettings.notifyEmail));

  for (const settings of recipients) {
    if (!settings.notifyEmail) continue;
    const orgId = settings.organizationId;

    const [mailbox] = await d
      .select()
      .from(mailboxes)
      .where(and(eq(mailboxes.organizationId, orgId), isNull(mailboxes.archivedAt)))
      .limit(1);
    if (!mailbox) continue;

    const [sent] = await d
      .select({ n: count() })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, orgId),
          eq(messages.direction, 'outbound'),
          eq(messages.status, 'sent'),
          gte(messages.at, since),
        ),
      );
    const [replies] = await d
      .select({ n: count() })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, orgId),
          eq(messages.direction, 'inbound'),
          gte(messages.at, since),
        ),
      );
    const hot = await d
      .select()
      .from(events)
      .where(
        and(eq(events.organizationId, orgId), eq(events.action, 'lead.interested'), gte(events.at, since)),
      );
    const closed = await d
      .select()
      .from(events)
      .where(
        and(eq(events.organizationId, orgId), eq(events.action, 'lead.closed'), gte(events.at, since)),
      );
    const [spend] = await d
      .select({ total: sql<number>`coalesce(sum(${apiUsage.costUsd}), 0)` })
      .from(apiUsage)
      .where(and(eq(apiUsage.organizationId, orgId), gte(apiUsage.at, since)));

    const lines = [
      `Last 24 hours:`,
      `- ${sent?.n ?? 0} emails sent`,
      `- ${replies?.n ?? 0} replies received`,
      `- ${hot.length} interested leads`,
      `- ${closed.length} deals marked closed`,
      `- $${Number(spend?.total ?? 0).toFixed(2)} AI + search spend`,
    ];
    if (hot.length > 0) {
      lines.push('', 'Interested:');
      for (const e of hot.slice(0, 10)) {
        const meta = e.metadata as { business?: string } | null;
        lines.push(`- ${meta?.business ?? 'Unknown business'}`);
      }
    }

    try {
      await sendEmail(mailbox, {
        to: settings.notifyEmail,
        subject: `SellPilot daily: ${replies?.n ?? 0} replies, ${hot.length} interested`,
        body: lines.join('\n'),
        messageId: newMessageId(mailbox.email),
        replyToken: shortRef(),
      });
    } catch (err) {
      console.error('[digest] send failed', err);
    }
  }
}

export function registerDigestJobs(boss: PgBoss): Promise<unknown> {
  return boss.work(QUEUES.dailyDigest, async () => {
    await dailyDigest(db());
  });
}