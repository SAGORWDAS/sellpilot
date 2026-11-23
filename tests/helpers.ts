import { uuidv7 } from 'uuidv7';
import { makeDb, type Database } from '../src/db';
import { campaigns, mailboxes, memberships, offerProfiles, orgSettings, organizations, projects, users } from '../src/db/schema';
import { hashPassword } from '../src/lib/auth';
import { encryptSecret } from '../src/lib/crypto';
import type { Actor } from '../src/lib/actor';
import type { OfferProfile, Strategy } from '../src/lib/schemas';

export function testDb(): Database {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  return makeDb(url);
}

export async function seedWorkspace(
  db: Database,
  opts: { email?: string; password?: string } = {},
): Promise<{ orgId: string; userId: string; actor: Actor }> {
  const orgId = uuidv7();
  const userId = uuidv7();
  const email = opts.email ?? `user-${userId}@test.local`;

  await db.insert(organizations).values({ id: orgId, name: 'Test Workspace' });
  await db.insert(users).values({
    id: userId,
    email,
    passwordHash: await hashPassword(opts.password ?? 'correct-horse-battery'),
    name: 'Test Owner',
  });
  await db.insert(memberships).values({
    id: uuidv7(),
    organizationId: orgId,
    userId,
    role: 'owner',
  });
  await db.insert(orgSettings).values({ organizationId: orgId, senderName: 'Test Owner' });

  return {
    orgId,
    userId,
    actor: {
      userId,
      organizationId: orgId,
      role: 'owner',
      sessionId: uuidv7(),
      name: 'Test Owner',
      email,
    },
  };
}

export const FIXTURE_PROFILE: OfferProfile = {
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

export const FIXTURE_STRATEGY: Strategy = {
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

export async function seedCampaign(
  db: Database,
  orgId: string,
  opts: { strategy?: Strategy | null; closeLink?: string | null } = {},
): Promise<{ projectId: string; mailboxId: string; campaignId: string }> {
  const projectId = uuidv7();
  await db.insert(projects).values({
    id: projectId,
    organizationId: orgId,
    name: 'Golden Lining',
    type: 'service',
    goal: 'book_call',
    urls: ['https://goldenlining.example.com'],
    closeLink: opts.closeLink ?? null,
  });
  await db.insert(offerProfiles).values({
    id: uuidv7(),
    organizationId: orgId,
    projectId,
    profile: FIXTURE_PROFILE,
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
    strategy: opts.strategy === undefined ? FIXTURE_STRATEGY : opts.strategy,
  });
  return { projectId, mailboxId, campaignId };
}