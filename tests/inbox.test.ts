import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Database } from '../src/db';
import { conversations, leads, mailboxes, messages } from '../src/db/schema';
import { processInbound, type InboundMail } from '../src/worker/jobs/inbox';
import { enqueue } from '../src/lib/queue';
import { seedCampaign, seedWorkspace, testDb } from './helpers';

vi.mock('@/lib/queue', () => ({
  enqueue: vi.fn(),
  QUEUES: { handleReply: 'handle-reply' },
}));

let db: Database;

beforeAll(() => {
  db = testDb();
});

beforeEach(() => {
  vi.mocked(enqueue).mockReset().mockResolvedValue('job-id');
});

async function seedContactedLead(orgId: string, campaignId: string) {
  const leadId = uuidv7();
  const email = `owner-${leadId}@acme.com`;
  await db.insert(leads).values({
    id: leadId,
    organizationId: orgId,
    campaignId,
    businessName: 'Acme Plumbing',
    email,
    status: 'contacted',
    stepIndex: 1,
    nextSendAt: new Date(Date.now() + 3 * 86_400_000),
    lastContactAt: new Date(),
  });
  const openerId = `<opener-${leadId}@example.com>`;
  await db.insert(messages).values({
    id: uuidv7(),
    organizationId: orgId,
    campaignId,
    leadId,
    direction: 'outbound',
    kind: 'opener',
    status: 'sent',
    messageId: openerId,
    subject: 'your site on phones',
    body: 'Hi — noticed the site is tricky on mobile.',
  });
  return { leadId, email, openerId };
}

function replyTo(openerId: string, from: string, overrides: Partial<InboundMail> = {}): InboundMail {
  return {
    from,
    subject: 'Re: your site on phones',
    text: 'Sounds interesting, tell me more.',
    messageId: `<reply-${uuidv7()}@acme.com>`,
    inReplyTo: openerId,
    references: [openerId],
    ...overrides,
  };
}

describe('processInbound', () => {
  it('matches by thread headers, stops follow-ups and queues the reply agent', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId, mailboxId } = await seedCampaign(db, orgId);
    const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).limit(1);
    const { leadId, email, openerId } = await seedContactedLead(orgId, campaignId);

    const result = await processInbound(db, mailbox!, replyTo(openerId, email));
    expect(result).toEqual({ matched: true, leadId });

    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead?.status).toBe('replied');
    expect(lead?.repliedAt).not.toBeNull();
    expect(lead?.nextSendAt).toBeNull();

    const [conversation] = await db.select().from(conversations).where(eq(conversations.leadId, leadId));
    expect(conversation?.state).toBe('ai_active');

    const inbound = await db
      .select()
      .from(messages)
      .where(and(eq(messages.leadId, leadId), eq(messages.direction, 'inbound')));
    expect(inbound).toHaveLength(1);
    expect(inbound[0]?.fromAddress).toBe(email);

    expect(vi.mocked(enqueue)).toHaveBeenCalledWith('handle-reply', {
      organizationId: orgId,
      messageId: inbound[0]!.id,
    });
  });

  it('falls back to sender address when thread headers are missing', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId, mailboxId } = await seedCampaign(db, orgId);
    const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).limit(1);
    const { leadId, email, openerId } = await seedContactedLead(orgId, campaignId);

    const result = await processInbound(
      db,
      mailbox!,
      replyTo(openerId, email, { inReplyTo: null, references: [] }),
    );
    expect(result).toEqual({ matched: true, leadId });
  });

  it('dedupes by message id', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId, mailboxId } = await seedCampaign(db, orgId);
    const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).limit(1);
    const { email, openerId } = await seedContactedLead(orgId, campaignId);

    const mail = replyTo(openerId, email);
    expect((await processInbound(db, mailbox!, mail)).matched).toBe(true);
    expect((await processInbound(db, mailbox!, mail)).matched).toBe(false);
    expect(vi.mocked(enqueue)).toHaveBeenCalledTimes(1);
  });

  it('ignores strangers and our own mailbox', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId, mailboxId } = await seedCampaign(db, orgId);
    const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).limit(1);
    const { email, openerId } = await seedContactedLead(orgId, campaignId);

    expect((await processInbound(db, mailbox!, replyTo(openerId, 'stranger@nowhere.org', { inReplyTo: null, references: [] }))).matched).toBe(false);
    expect((await processInbound(db, mailbox!, replyTo(openerId, mailbox!.email))).matched).toBe(false);
    expect((await processInbound(db, mailbox!, replyTo(openerId, email))).matched).toBe(true);
  });
});