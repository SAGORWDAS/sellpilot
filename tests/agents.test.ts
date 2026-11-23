import { beforeAll, describe, expect, vi, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Database } from '../src/db';
import { campaigns, events, mailboxes, offerProfiles, projects } from '../src/db/schema';
import { analyzeOffer } from '../src/agents/offer-analyst';
import { buildStrategy } from '../src/agents/strategist';
import { complete } from '../src/lib/openai';
import { crawlOffer } from '../src/lib/crawl';
import { encryptSecret } from '../src/lib/crypto';
import { NotFound, ValidationError } from '../src/lib/errors';
import type { OfferProfile, Strategy } from '../src/lib/schemas';
import { seedWorkspace, testDb } from './helpers';

vi.mock('@/lib/openai', () => ({ complete: vi.fn() }));
vi.mock('@/lib/crawl', () => ({ crawlOffer: vi.fn() }));

const PROFILE: OfferProfile = {
  businessName: 'Golden Lining Solution',
  tagline: 'Websites that win work',
  description: 'Web design for Australian small businesses.',
  offerings: [{ name: 'Business website', description: '5-page site', price: '$1,900' }],
  valueProps: ['Fast load times', 'Mobile-first design'],
  proofPoints: ['10 years in business'],
  targetAudience: 'Local service businesses with outdated websites',
  differentiators: ['Fixed pricing'],
  tone: 'friendly',
  faq: [{ q: 'How long does it take?', a: 'About two weeks.' }],
};

const STRATEGY: Strategy = {
  icp: 'Sydney tradies with outdated websites',
  discoveryQueries: [{ kind: 'places', query: 'plumbers', location: 'Sydney NSW, Australia' }],
  angles: [{ name: 'Mobile fix', hook: 'site is hard to use on a phone', pitch: 'mobile-first rebuild' }],
  sequence: [
    { step: 0, delayDays: 0, goal: 'start a conversation', guidance: 'short opener with the hook' },
    { step: 1, delayDays: 3, goal: 'bump', guidance: 'new angle, one line' },
    { step: 2, delayDays: 7, goal: 'close the loop', guidance: 'polite final note' },
  ],
  objectionHandling: [{ objection: 'too expensive', response: 'fixed $1,900, no surprises' }],
  sampleEmail: { subject: 'quick note about your site', body: 'Hi — noticed your site…\n\n{{sender_name}}' },
};

let db: Database;

beforeAll(() => {
  db = testDb();
});

async function seedProject(orgId: string) {
  const projectId = uuidv7();
  await db.insert(projects).values({
    id: projectId,
    organizationId: orgId,
    name: 'Golden Lining',
    type: 'service',
    goal: 'book_call',
    urls: ['https://goldenlining.example.com'],
  });
  return projectId;
}

describe('offer analyst', () => {
  it('analyzes, stores the profile and records an event; re-run upserts', async () => {
    const { orgId } = await seedWorkspace(db);
    const projectId = await seedProject(orgId);
    vi.mocked(crawlOffer).mockResolvedValue('Golden Lining Solution — websites for tradies…');
    vi.mocked(complete).mockResolvedValue(PROFILE);

    const profile = await analyzeOffer(db, { organizationId: orgId, projectId });
    expect(profile.businessName).toBe('Golden Lining Solution');

    await analyzeOffer(db, { organizationId: orgId, projectId });
    const rows = await db.select().from(offerProfiles).where(eq(offerProfiles.projectId, projectId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.profile.tone).toBe('friendly');

    const evts = await db.select().from(events).where(eq(events.organizationId, orgId));
    expect(evts.some((e) => e.action === 'offer.analyzed')).toBe(true);
  });

  it('refuses projects from another organization', async () => {
    const a = await seedWorkspace(db);
    const b = await seedWorkspace(db);
    const projectId = await seedProject(a.orgId);
    await expect(
      analyzeOffer(db, { organizationId: b.orgId, projectId }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it('fails cleanly when the site yields nothing', async () => {
    const { orgId } = await seedWorkspace(db);
    const projectId = await seedProject(orgId);
    vi.mocked(crawlOffer).mockResolvedValue('');
    await expect(analyzeOffer(db, { organizationId: orgId, projectId })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('strategist', () => {
  it('builds and stores a strategy on the campaign', async () => {
    const { orgId } = await seedWorkspace(db);
    const projectId = await seedProject(orgId);
    await db.insert(offerProfiles).values({
      id: uuidv7(),
      organizationId: orgId,
      projectId,
      profile: PROFILE,
    });
    const mailboxId = uuidv7();
    await db.insert(mailboxes).values({
      id: mailboxId,
      organizationId: orgId,
      label: 'Main',
      email: 'sales@example.com',
      fromName: 'Sales',
      smtpHost: 'smtp.example.com',
      smtpUser: 'sales@example.com',
      smtpSecretEnc: encryptSecret('pw'),
      imapHost: 'imap.example.com',
      imapUser: 'sales@example.com',
      imapSecretEnc: encryptSecret('pw'),
    });
    const campaignId = uuidv7();
    await db.insert(campaigns).values({
      id: campaignId,
      organizationId: orgId,
      projectId,
      mailboxId,
      name: 'Sydney tradies',
      audience: { mode: 'local', niche: 'plumbers', location: 'Sydney', description: null },
    });

    vi.mocked(complete).mockResolvedValue(STRATEGY);
    const strategy = await buildStrategy(db, { organizationId: orgId, campaignId });
    expect(strategy.icp).toContain('Sydney');

    const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    expect(row?.strategy?.sequence).toHaveLength(3);
  });

  it('requires an analyzed offer first', async () => {
    const { orgId } = await seedWorkspace(db);
    const projectId = await seedProject(orgId);
    const mailboxId = uuidv7();
    await db.insert(mailboxes).values({
      id: mailboxId,
      organizationId: orgId,
      label: 'Main',
      email: 'sales@example.com',
      fromName: 'Sales',
      smtpHost: 'smtp.example.com',
      smtpUser: 'sales@example.com',
      smtpSecretEnc: encryptSecret('pw'),
      imapHost: 'imap.example.com',
      imapUser: 'sales@example.com',
      imapSecretEnc: encryptSecret('pw'),
    });
    const campaignId = uuidv7();
    await db.insert(campaigns).values({
      id: campaignId,
      organizationId: orgId,
      projectId,
      mailboxId,
      name: 'No offer yet',
      audience: { mode: 'generic', niche: null, location: null, description: 'SaaS founders' },
    });
    await expect(buildStrategy(db, { organizationId: orgId, campaignId })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});