import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Database } from '../src/db';
import { events, leads, messages, orgSettings } from '../src/db/schema';
import { dailyDigest } from '../src/worker/jobs/digest';
import { sendEmail } from '../src/lib/email';
import { seedCampaign, seedWorkspace, testDb } from './helpers';

vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/email')>();
  return { ...actual, sendEmail: vi.fn() };
});

let db: Database;

beforeAll(() => {
  db = testDb();
});

beforeEach(async () => {
  vi.mocked(sendEmail).mockReset().mockResolvedValue(undefined);
  await db.update(orgSettings).set({ notifyEmail: null });
});

describe('dailyDigest', () => {
  it('emails a 24h summary to orgs with a notify address', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId } = await seedCampaign(db, orgId);
    await db
      .update(orgSettings)
      .set({ notifyEmail: 'boss@test.local' })
      .where(eq(orgSettings.organizationId, orgId));

    const leadId = uuidv7();
    await db.insert(leads).values({
      id: leadId,
      organizationId: orgId,
      campaignId,
      businessName: 'Acme Plumbing',
      email: `digest-${leadId}@acme.com`,
      status: 'interested',
    });
    await db.insert(messages).values({
      id: uuidv7(),
      organizationId: orgId,
      campaignId,
      leadId,
      direction: 'outbound',
      kind: 'opener',
      status: 'sent',
      subject: 'your site',
      body: 'Hi',
    });
    await db.insert(messages).values({
      id: uuidv7(),
      organizationId: orgId,
      campaignId,
      leadId,
      direction: 'inbound',
      kind: 'reply',
      status: 'received',
      subject: 'Re: your site',
      body: 'Interested',
    });
    await db.insert(events).values({
      id: uuidv7(),
      organizationId: orgId,
      action: 'lead.interested',
      subjectType: 'lead',
      subjectId: leadId,
      metadata: { business: 'Acme Plumbing' },
    });

    await dailyDigest(db);

    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(sendEmail).mock.calls[0]![1];
    expect(mail.to).toBe('boss@test.local');
    expect(mail.subject).toContain('1 replies');
    expect(mail.subject).toContain('1 interested');
    expect(mail.body).toContain('1 emails sent');
    expect(mail.body).toContain('Acme Plumbing');
  });

  it('skips orgs without a notify address', async () => {
    const { orgId } = await seedWorkspace(db);
    await seedCampaign(db, orgId);
    await dailyDigest(db);
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
  });
});