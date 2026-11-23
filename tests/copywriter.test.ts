import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Database } from '../src/db';
import { leads } from '../src/db/schema';
import { lintCopy, writeSequence } from '../src/agents/copywriter';
import { complete } from '../src/lib/openai';
import { seedCampaign, seedWorkspace, testDb } from './helpers';

vi.mock('@/lib/openai', () => ({ complete: vi.fn() }));

let db: Database;

beforeAll(() => {
  db = testDb();
});

describe('lintCopy', () => {
  it('flags spam triggers but allows "feel free"', () => {
    const bad = lintCopy([{ subject: 'FREE offer!!!', body: 'Act now and buy today, limited time only, guaranteed results for you.' }]);
    expect(bad.length).toBeGreaterThan(0);
    const good = lintCopy([
      {
        subject: 'quick note about your site',
        body: 'Hi — noticed your site is tricky on a phone. We rebuild sites like yours for tradies. Feel free to reply if a quick chat is useful.\n\nDave',
      },
    ]);
    expect(good).toEqual([]);
  });

  it('flags overlong bodies', () => {
    const body = Array(200).fill('word').join(' ');
    expect(lintCopy([{ subject: 'x', body }]).some((p) => p.includes('150 words'))).toBe(true);
  });
});

describe('writeSequence', () => {
  it('writes the sequence, replaces the sender placeholder and queues the lead', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId } = await seedCampaign(db, orgId);
    const leadId = uuidv7();
    await db.insert(leads).values({
      id: leadId,
      organizationId: orgId,
      campaignId,
      businessName: 'Acme Plumbing',
      email: 'info@acme.com',
      website: 'https://acme.com',
      hook: 'their website is hard to use on a phone',
      status: 'audited',
    });

    vi.mocked(complete).mockResolvedValue({
      steps: [
        { subject: 'your site on phones', body: 'Hi — noticed the site is tricky on mobile. We fix that for plumbers. Open to a quick chat?\n\n{{sender_name}}' },
        { subject: 'one more thought', body: 'A faster site usually means more calls. Worth a look?\n\n{{sender_name}}' },
        { subject: 'closing the loop', body: 'No worries if timing is off. If it changes, I am here.\n\n{{sender_name}}' },
      ],
    });

    const sequence = await writeSequence(db, { organizationId: orgId, leadId });
    expect(sequence.steps).toHaveLength(3);
    expect(sequence.steps[0]?.body).toContain('Test Owner');
    expect(sequence.steps[0]?.body).not.toContain('{{sender_name}}');

    const [row] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(row?.status).toBe('queued');
    expect(row?.nextSendAt).not.toBeNull();
    expect(row?.sequence?.steps).toHaveLength(3);
  });
});