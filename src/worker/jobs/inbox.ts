import type PgBoss from 'pg-boss';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { simpleParser } from 'mailparser';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { db, type Database } from '@/db';
import { campaigns, conversations, leads, mailboxes, messages } from '@/db/schema';
import type { Mailbox } from '@/db/schema';
import { imapClient } from '@/lib/imap';
import { enqueue, QUEUES } from '@/lib/queue';

export type InboundMail = {
  from: string;
  subject: string;
  text: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
};

export async function processInbound(
  d: Database,
  mailbox: Mailbox,
  mail: InboundMail,
): Promise<{ matched: boolean; leadId?: string }> {
  const from = mail.from.toLowerCase().trim();
  if (!from || from === mailbox.email.toLowerCase()) return { matched: false };

  if (mail.messageId) {
    const [existing] = await d
      .select()
      .from(messages)
      .where(and(eq(messages.messageId, mail.messageId), eq(messages.direction, 'inbound')))
      .limit(1);
    if (existing) return { matched: false };
  }

  const threadIds = [mail.inReplyTo, ...mail.references].filter((x): x is string => Boolean(x));
  let leadId: string | null = null;
  let campaignId: string | null = null;

  if (threadIds.length > 0) {
    const [hit] = await d
      .select()
      .from(messages)
      .where(inArray(messages.messageId, threadIds))
      .limit(1);
    if (hit) {
      leadId = hit.leadId;
      campaignId = hit.campaignId;
    }
  }

  if (!leadId) {
    const [hit] = await d
      .select({ leadId: leads.id, campaignId: leads.campaignId })
      .from(leads)
      .innerJoin(campaigns, eq(campaigns.id, leads.campaignId))
      .where(and(eq(leads.email, from), eq(campaigns.mailboxId, mailbox.id)))
      .orderBy(desc(leads.lastContactAt))
      .limit(1);
    if (hit) {
      leadId = hit.leadId;
      campaignId = hit.campaignId;
    }
  }

  if (!leadId || !campaignId) return { matched: false };

  const [lead] = await d.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return { matched: false };

  const msgId = uuidv7();
  await d.insert(messages).values({
    id: msgId,
    organizationId: lead.organizationId,
    campaignId,
    leadId,
    direction: 'inbound',
    kind: 'reply',
    status: 'received',
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    fromAddress: from,
    subject: mail.subject,
    body: mail.text.slice(0, 20_000),
  });

  const now = new Date();
  await d
    .update(leads)
    .set({
      repliedAt: now,
      nextSendAt: null,
      status: ['suppressed', 'bounced'].includes(lead.status) ? lead.status : 'replied',
      updatedAt: now,
    })
    .where(eq(leads.id, leadId));

  await d
    .insert(conversations)
    .values({
      id: uuidv7(),
      organizationId: lead.organizationId,
      campaignId,
      leadId,
      state: 'ai_active',
      updatedAt: now,
    })
    .onConflictDoUpdate({ target: conversations.leadId, set: { updatedAt: now } });

  await enqueue(QUEUES.handleReply, { organizationId: lead.organizationId, messageId: msgId });
  return { matched: true, leadId };
}

export async function pollMailbox(
  d: Database,
  input: { organizationId: string; mailboxId: string },
): Promise<void> {
  const [mailbox] = await d
    .select()
    .from(mailboxes)
    .where(
      and(
        eq(mailboxes.id, input.mailboxId),
        eq(mailboxes.organizationId, input.organizationId),
        isNull(mailboxes.archivedAt),
      ),
    )
    .limit(1);
  if (!mailbox) return;

  const client = imapClient(mailbox);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const mb = client.mailbox;
      if (!mb) return;
      const uidValidity = Number(mb.uidValidity);
      let lastUid = mailbox.imapLastUid;
      if (mailbox.imapUidValidity !== null && mailbox.imapUidValidity !== uidValidity) {
        lastUid = 0;
      }

      let maxUid = lastUid;
      const range = `${lastUid + 1}:*`;
      for await (const msg of client.fetch(range, { uid: true, source: true })) {
        if (msg.uid <= lastUid) continue;
        maxUid = Math.max(maxUid, msg.uid);
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const from = parsed.from?.value?.[0]?.address ?? '';
        const references = Array.isArray(parsed.references)
          ? parsed.references
          : parsed.references
            ? [parsed.references]
            : [];
        await processInbound(d, mailbox, {
          from,
          subject: parsed.subject ?? '(no subject)',
          text: parsed.text ?? '',
          messageId: parsed.messageId ?? null,
          inReplyTo: parsed.inReplyTo ?? null,
          references,
        });
      }

      await d
        .update(mailboxes)
        .set({
          imapUidValidity: uidValidity,
          imapLastUid: maxUid,
          lastPollAt: new Date(),
          lastError: null,
        })
        .where(eq(mailboxes.id, mailbox.id));
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await d
      .update(mailboxes)
      .set({ lastError: `IMAP: ${message}`, lastPollAt: new Date() })
      .where(eq(mailboxes.id, mailbox.id));
    try {
      client.close();
    } catch {
      /* already closed */
    }
    throw err;
  }
}

const pollJob = z.object({ organizationId: z.string(), mailboxId: z.string() });

export async function pollAllInboxes(d: Database): Promise<void> {
  const rows = await d.select().from(mailboxes).where(isNull(mailboxes.archivedAt));
  for (const mailbox of rows) {
    await enqueue(
      QUEUES.pollMailbox,
      { organizationId: mailbox.organizationId, mailboxId: mailbox.id },
      { singletonKey: `poll:${mailbox.id}` },
    );
  }
}

export function registerInboxJobs(boss: PgBoss): Promise<unknown> {
  return Promise.all([
    boss.work(QUEUES.pollInbox, async () => {
      await pollAllInboxes(db());
    }),
    boss.work(QUEUES.pollMailbox, async (jobs) => {
      for (const job of jobs) {
        await pollMailbox(db(), pollJob.parse(job.data));
      }
    }),
  ]);
}