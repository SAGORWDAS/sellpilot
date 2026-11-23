import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Database } from '../src/db';
import { conversations, events, leads, messages, orgSettings, suppressions } from '../src/db/schema';
import { handleReply } from '../src/agents/reply-agent';
import { complete } from '../src/lib/openai';
import { sendEmail } from '../src/lib/email';
import type { ReplyDecision } from '../src/lib/schemas';
import { seedCampaign, seedWorkspace, testDb } from './helpers';

vi.mock('@/lib/openai', () => ({ complete: vi.fn() }));
vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/email')>();
  return { ...actual, sendEmail: vi.fn() };
});

const CLOSE_LINK = 'https://cal.com/test/intro';

let db: Database;

beforeAll(() => {
  db = testDb();
});

beforeEach(() => {
  vi.mocked(complete).mockReset();
  vi.mocked(sendEmail).mockReset().mockResolvedValue(undefined);
});

async function seedThread(
  opts: { state?: 'ai_active' | 'human_takeover'; inboundText?: string; inboundFrom?: string } = {},
) {
  const { orgId } = await seedWorkspace(db);
  const { campaignId } = await seedCampaign(db, orgId, { closeLink: CLOSE_LINK });
  const leadId = uuidv7();
  const email = `owner-${leadId}@acme.com`;
  await db.insert(leads).values({
    id: leadId,
    organizationId: orgId,
    campaignId,
    businessName: 'Acme Plumbing',
    email,
    status: 'replied',
    repliedAt: new Date(),
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
  const inboundId = uuidv7();
  const inboundMessageId = `<reply-${leadId}@acme.com>`;
  await db.insert(messages).values({
    id: inboundId,
    organizationId: orgId,
    campaignId,
    leadId,
    direction: 'inbound',
    kind: 'reply',
    status: 'received',
    messageId: inboundMessageId,
    inReplyTo: openerId,
    fromAddress: opts.inboundFrom ?? email,
    subject: 'Re: your site on phones',
    body: opts.inboundText ?? 'Sounds interesting, tell me more.',
  });
  const conversationId = uuidv7();
  await db.insert(conversations).values({
    id: conversationId,
    organizationId: orgId,
    campaignId,
    leadId,
    state: opts.state ?? 'ai_active',
    rootMessageId: openerId,
  });
  return { orgId, campaignId, leadId, email, inboundId, inboundMessageId, conversationId };
}

function decision(overrides: Partial<ReplyDecision>): ReplyDecision {
  return {
    category: 'question',
    shouldReply: true,
    subject: null,
    body: 'Happy to explain — we rebuild sites for tradies.\n\n{{sender_name}}',
    reasoning: 'They asked for details.',
    ...overrides,
  };
}

describe('handleReply — deterministic guards (no LLM)', () => {
  it('unsubscribe suppresses globally without calling the LLM or sending anything', async () => {
    const t = await seedThread({ inboundText: 'Please unsubscribe me from these emails.' });
    await handleReply(db, { organizationId: t.orgId, messageId: t.inboundId });

    expect(vi.mocked(complete)).not.toHaveBeenCalled();
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();

    const [sup] = await db.select().from(suppressions).where(eq(suppressions.email, t.email));
    expect(sup?.reason).toBe('unsubscribe');
    const [lead] = await db.select().from(leads).where(eq(leads.id, t.leadId));
    expect(lead?.status).toBe('suppressed');
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, t.conversationId));
    expect(conversation?.state).toBe('suppressed');
    const [msg] = await db.select().from(messages).where(eq(messages.id, t.inboundId));
    expect(msg?.category).toBe('unsubscribe');
  });

  it('mailer-daemon bounces suppress the address', async () => {
    const t = await seedThread({
      inboundFrom: 'mailer-daemon@googlemail.com',
      inboundText: 'Delivery to the following recipient failed permanently.',
    });
    await handleReply(db, { organizationId: t.orgId, messageId: t.inboundId });

    expect(vi.mocked(complete)).not.toHaveBeenCalled();
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
    const [lead] = await db.select().from(leads).where(eq(leads.id, t.leadId));
    expect(lead?.status).toBe('bounced');
    const [sup] = await db.select().from(suppressions).where(eq(suppressions.email, t.email));
    expect(sup?.reason).toBe('bounce');
  });
});

describe('handleReply — LLM decisions', () => {
  it('interested: marks the lead, notifies the owner and sends the close link', async () => {
    const t = await seedThread({ inboundText: 'Yes, I would like to book a call.' });
    await db
      .update(orgSettings)
      .set({ notifyEmail: 'owner@test.local' })
      .where(eq(orgSettings.organizationId, t.orgId));
    vi.mocked(complete).mockResolvedValue(
      decision({
        category: 'interested',
        body: `Great — grab any slot that suits you: ${CLOSE_LINK}\n\n{{sender_name}}`,
        reasoning: 'They want to book.',
      }),
    );

    await handleReply(db, { organizationId: t.orgId, messageId: t.inboundId });

    const [lead] = await db.select().from(leads).where(eq(leads.id, t.leadId));
    expect(lead?.status).toBe('interested');
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, t.conversationId));
    expect(conversation?.lastCategory).toBe('interested');

    const evts = await db.select().from(events).where(eq(events.organizationId, t.orgId));
    expect(evts.some((e) => e.action === 'lead.interested')).toBe(true);

    const calls = vi.mocked(sendEmail).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![1].to).toBe('owner@test.local');
    expect(calls[0]![1].subject).toContain('Hot lead');
    expect(calls[1]![1].to).toBe(t.email);
    expect(calls[1]![1].body).toContain(CLOSE_LINK);
    expect(calls[1]![1].inReplyTo).toBe(t.inboundMessageId);

    const closeMsgs = await db
      .select()
      .from(messages)
      .where(and(eq(messages.leadId, t.leadId), eq(messages.kind, 'close')));
    expect(closeMsgs[0]?.status).toBe('sent');
    expect(closeMsgs[0]?.body).toContain('Test Owner');
  });

  it('question: sends a threaded factual reply', async () => {
    const t = await seedThread({ inboundText: 'How much does a website cost?' });
    vi.mocked(complete).mockResolvedValue(
      decision({ body: 'A five-page business site is $1,900 fixed.\n\n{{sender_name}}' }),
    );

    await handleReply(db, { organizationId: t.orgId, messageId: t.inboundId });

    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(sendEmail).mock.calls[0]![1];
    expect(sent.subject).toBe('Re: your site on phones');
    expect(sent.inReplyTo).toBe(t.inboundMessageId);
    expect(sent.body).toContain('$1,900');
    expect(sent.body).toContain('unsubscribe');

    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, t.conversationId));
    expect(conversation?.lastCategory).toBe('question');
    expect(conversation?.state).toBe('ai_active');
  });

  it('not interested with shouldReply false closes the thread quietly', async () => {
    const t = await seedThread({ inboundText: 'No thanks, we are sorted.' });
    vi.mocked(complete).mockResolvedValue(
      decision({ category: 'not_interested', shouldReply: false, body: null }),
    );

    await handleReply(db, { organizationId: t.orgId, messageId: t.inboundId });
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, t.conversationId));
    expect(conversation?.state).toBe('closed');
  });

  it('out of office reschedules instead of replying', async () => {
    const t = await seedThread({ inboundText: 'I am on leave until next week.' });
    vi.mocked(complete).mockResolvedValue(
      decision({ category: 'out_of_office', shouldReply: false, body: null }),
    );

    await handleReply(db, { organizationId: t.orgId, messageId: t.inboundId });
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
    const [lead] = await db.select().from(leads).where(eq(leads.id, t.leadId));
    expect(lead?.status).toBe('contacted');
    expect(lead?.repliedAt).toBeNull();
    const daysOut = (lead!.nextSendAt!.getTime() - Date.now()) / 86_400_000;
    expect(daysOut).toBeGreaterThan(3.5);
    expect(daysOut).toBeLessThan(4.5);
  });

  it('LLM-classified bounce still suppresses and never replies', async () => {
    const t = await seedThread({ inboundText: '550 mailbox unavailable' });
    vi.mocked(complete).mockResolvedValue(
      decision({ category: 'bounce', shouldReply: true, body: 'oops' }),
    );

    await handleReply(db, { organizationId: t.orgId, messageId: t.inboundId });
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
    const [lead] = await db.select().from(leads).where(eq(leads.id, t.leadId));
    expect(lead?.status).toBe('bounced');
  });

  it('human takeover: classifies but never sends over the human', async () => {
    const t = await seedThread({ state: 'human_takeover' });
    vi.mocked(complete).mockResolvedValue(decision({}));

    await handleReply(db, { organizationId: t.orgId, messageId: t.inboundId });
    expect(vi.mocked(complete)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
  });
});