import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Database } from '../src/db';
import { campaigns, conversations, leads, mailboxes, messages, suppressions } from '../src/db/schema';
import { sendLeadEmail, sendTick } from '../src/worker/jobs/send';
import { sendEmail } from '../src/lib/email';
import { enqueue } from '../src/lib/queue';
import { seedCampaign, seedWorkspace, testDb } from './helpers';

vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/email')>();
  return { ...actual, sendEmail: vi.fn() };
});
vi.mock('@/lib/queue', () => ({
  enqueue: vi.fn(),
  QUEUES: { writeSequence: 'write-sequence', sendEmail: 'send-email', auditLead: 'audit-lead' },
}));

const SEQUENCE = {
  steps: [
    { subject: 'your site on phones', body: 'Hi — noticed the site is tricky on mobile. Open to a chat?\n\nDave' },
    { subject: 'one more thought', body: 'A faster site usually means more calls. Worth a look?\n\nDave' },
    { subject: 'closing the loop', body: 'No worries if timing is off.\n\nDave' },
  ],
};

let db: Database;

beforeAll(() => {
  db = testDb();
});

beforeEach(async () => {
  vi.mocked(sendEmail).mockReset().mockResolvedValue(undefined);
  vi.mocked(enqueue).mockReset().mockResolvedValue('job-id');
  await db.update(campaigns).set({ status: 'paused' });
});

async function seedLead(
  orgId: string,
  campaignId: string,
  overrides: Partial<typeof leads.$inferInsert> = {},
) {
  const leadId = uuidv7();
  await db.insert(leads).values({
    id: leadId,
    organizationId: orgId,
    campaignId,
    businessName: 'Acme Plumbing',
    email: `info-${leadId}@acme.com`,
    website: 'https://acme.com',
    hook: 'their website is hard to use on a phone',
    status: 'queued',
    sequence: SEQUENCE,
    nextSendAt: new Date(Date.now() - 60_000),
    ...overrides,
  });
  return leadId;
}

describe('sendTick', () => {
  it('queues copywriting for audited leads and sends for due leads', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId } = await seedCampaign(db, orgId);
    await db.update(campaigns).set({ status: 'active' }).where(eq(campaigns.id, campaignId));

    await seedLead(orgId, campaignId, { status: 'audited', sequence: null, nextSendAt: null });
    const dueId = await seedLead(orgId, campaignId);

    await sendTick(db);

    const calls = vi.mocked(enqueue).mock.calls;
    expect(calls.some(([q, data]) => q === 'write-sequence' && 'leadId' in data)).toBe(true);
    expect(calls.some(([q, data]) => q === 'send-email' && data['leadId'] === dueId)).toBe(true);

    const [due] = await db.select().from(leads).where(eq(leads.id, dueId));
    expect(due?.nextSendAt).toBeNull();
  });

  it('respects the warmup cap across the mailbox', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId } = await seedCampaign(db, orgId);
    await db.update(campaigns).set({ status: 'active' }).where(eq(campaigns.id, campaignId));
    for (let i = 0; i < 8; i++) await seedLead(orgId, campaignId);

    await sendTick(db);

    const sendCalls = vi.mocked(enqueue).mock.calls.filter(([q]) => q === 'send-email');
    expect(sendCalls).toHaveLength(5);
  });

  it('ignores paused campaigns', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId } = await seedCampaign(db, orgId);
    await db.update(campaigns).set({ status: 'paused' }).where(eq(campaigns.id, campaignId));
    await seedLead(orgId, campaignId);

    await sendTick(db);
    expect(vi.mocked(enqueue)).not.toHaveBeenCalled();
  });
});

describe('sendLeadEmail', () => {
  it('sends the opener, advances the lead and opens a conversation', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId } = await seedCampaign(db, orgId);
    await db.update(campaigns).set({ status: 'active' }).where(eq(campaigns.id, campaignId));
    const leadId = await seedLead(orgId, campaignId);

    await sendLeadEmail(db, { organizationId: orgId, leadId });

    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(sendEmail).mock.calls[0]![1];
    expect(sent.subject).toBe('your site on phones');
    expect(sent.body).toContain('unsubscribe');

    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead?.status).toBe('contacted');
    expect(lead?.stepIndex).toBe(1);
    expect(lead?.lastContactAt).not.toBeNull();
    const daysOut = (lead!.nextSendAt!.getTime() - Date.now()) / 86_400_000;
    expect(daysOut).toBeGreaterThan(2);
    expect(daysOut).toBeLessThan(4.5);

    const [conversation] = await db.select().from(conversations).where(eq(conversations.leadId, leadId));
    expect(conversation?.state).toBe('ai_active');

    const msgs = await db.select().from(messages).where(eq(messages.leadId, leadId));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.status).toBe('sent');
    expect(msgs[0]?.kind).toBe('opener');
  });

  it('sends a threaded followup for step 1', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId } = await seedCampaign(db, orgId);
    await db.update(campaigns).set({ status: 'active' }).where(eq(campaigns.id, campaignId));
    const leadId = await seedLead(orgId, campaignId);
    await sendLeadEmail(db, { organizationId: orgId, leadId });

    await db
      .update(leads)
      .set({ nextSendAt: new Date(Date.now() - 1000) })
      .where(eq(leads.id, leadId));
    await sendLeadEmail(db, { organizationId: orgId, leadId });

    const second = vi.mocked(sendEmail).mock.calls[1]![1];
    expect(second.subject).toBe('one more thought');
    expect(second.inReplyTo).toBeTruthy();

    const msgs = await db
      .select()
      .from(messages)
      .where(and(eq(messages.leadId, leadId), eq(messages.kind, 'followup')));
    expect(msgs[0]?.inReplyTo).toBe(second.inReplyTo);
  });

  it('never emails a lead who replied', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId } = await seedCampaign(db, orgId);
    await db.update(campaigns).set({ status: 'active' }).where(eq(campaigns.id, campaignId));
    const leadId = await seedLead(orgId, campaignId, { repliedAt: new Date() });

    await sendLeadEmail(db, { organizationId: orgId, leadId });
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead?.nextSendAt).toBeNull();
  });

  it('never emails a suppressed address', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId } = await seedCampaign(db, orgId);
    await db.update(campaigns).set({ status: 'active' }).where(eq(campaigns.id, campaignId));
    const leadId = await seedLead(orgId, campaignId, { email: 'gone@acme.com' });
    await db.insert(suppressions).values({ email: 'gone@acme.com', reason: 'unsubscribe' });

    await sendLeadEmail(db, { organizationId: orgId, leadId });
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
  });

  it('never emails over a human takeover', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId } = await seedCampaign(db, orgId);
    await db.update(campaigns).set({ status: 'active' }).where(eq(campaigns.id, campaignId));
    const leadId = await seedLead(orgId, campaignId);
    await db.insert(conversations).values({
      id: uuidv7(),
      organizationId: orgId,
      campaignId,
      leadId,
      state: 'human_takeover',
    });

    await sendLeadEmail(db, { organizationId: orgId, leadId });
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
  });

  it('records failure, backs off an hour and surfaces the mailbox error', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId, mailboxId } = await seedCampaign(db, orgId);
    await db.update(campaigns).set({ status: 'active' }).where(eq(campaigns.id, campaignId));
    const leadId = await seedLead(orgId, campaignId);
    vi.mocked(sendEmail).mockRejectedValue(new Error('SMTP auth failed'));

    await expect(sendLeadEmail(db, { organizationId: orgId, leadId })).rejects.toThrow('SMTP auth failed');

    const [msg] = await db.select().from(messages).where(eq(messages.leadId, leadId));
    expect(msg?.status).toBe('failed');
    expect(msg?.error).toContain('SMTP auth failed');

    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead?.stepIndex).toBe(0);
    const backoff = lead!.nextSendAt!.getTime() - Date.now();
    expect(backoff).toBeGreaterThan(50 * 60_000);

    const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId));
    expect(mailbox?.lastError).toContain('SMTP auth failed');
  });
});