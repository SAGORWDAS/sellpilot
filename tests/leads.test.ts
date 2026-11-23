import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Database } from '../src/db';
import { leads, suppressions } from '../src/db/schema';
import { discoverLeads, isSkippableDomain } from '../src/agents/lead-scout';
import { auditLead } from '../src/agents/site-audit';
import { serperPlaces, serperSearch } from '../src/lib/serper';
import { enqueue } from '../src/lib/queue';
import { fetchPage } from '../src/lib/crawl';
import { ValidationError } from '../src/lib/errors';
import { seedCampaign, seedWorkspace, testDb } from './helpers';

vi.mock('@/lib/serper', () => ({ serperPlaces: vi.fn(), serperSearch: vi.fn() }));
vi.mock('@/lib/queue', () => ({ enqueue: vi.fn(), QUEUES: { auditLead: 'audit-lead' } }));
vi.mock('@/lib/crawl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/crawl')>();
  return { ...actual, fetchPage: vi.fn() };
});

let db: Database;

beforeAll(() => {
  db = testDb();
});

describe('lead scout', () => {
  it('discovers, dedupes by domain and skips social directories', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId } = await seedCampaign(db, orgId);

    vi.mocked(serperPlaces).mockResolvedValue([
      { title: 'Acme Plumbing', website: 'https://acmeplumbing.com.au', phone: '0400', address: 'Sydney' },
      { title: 'Acme Again', website: 'https://www.acmeplumbing.com.au/about', phone: null, address: 'Sydney' },
      { title: 'No Website Co', website: null, phone: '0411', address: 'Sydney' },
      { title: 'Facebook Page', website: 'https://facebook.com/someplumber', phone: null, address: null },
      { title: 'Beta Plumbing', website: 'https://betaplumbing.com.au', phone: null, address: 'Parramatta' },
    ]);
    vi.mocked(serperSearch).mockResolvedValue([]);

    const { discovered } = await discoverLeads(db, { organizationId: orgId, campaignId });
    expect(discovered).toBe(2);

    const rows = await db.select().from(leads).where(eq(leads.campaignId, campaignId));
    expect(rows.map((r) => r.businessName).sort()).toEqual(['Acme Plumbing', 'Beta Plumbing']);
    expect(vi.mocked(enqueue)).toHaveBeenCalledTimes(2);

    const second = await discoverLeads(db, { organizationId: orgId, campaignId });
    expect(second.discovered).toBe(0);
  });

  it('requires a strategy', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId } = await seedCampaign(db, orgId, { strategy: null });
    await expect(discoverLeads(db, { organizationId: orgId, campaignId })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('flags directory and social domains', () => {
    expect(isSkippableDomain('https://www.yelp.com/biz/x')).toBe(true);
    expect(isSkippableDomain('https://m.facebook.com/x')).toBe(true);
    expect(isSkippableDomain('https://acmeplumbing.com.au')).toBe(false);
  });
});

describe('site audit', () => {
  const BAD_SITE = `<html><head><title>Acme Plumbing</title></head>
    <body><p>Call us © 2018</p><a href="mailto:info@acmeplumbing.com.au">info@acmeplumbing.com.au</a></body></html>`;

  it('audits the site, finds the email and writes a hook', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId } = await seedCampaign(db, orgId);
    const leadId = uuidv7();
    await db.insert(leads).values({
      id: leadId,
      organizationId: orgId,
      campaignId,
      businessName: 'Acme Plumbing',
      website: 'http://acmeplumbing.com.au',
      status: 'discovered',
    });
    vi.mocked(fetchPage).mockResolvedValue({ url: 'http://acmeplumbing.com.au', html: BAD_SITE });

    await auditLead(db, { organizationId: orgId, leadId });
    const [row] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(row?.status).toBe('audited');
    expect(row?.email).toBe('info@acmeplumbing.com.au');
    expect(row?.audit?.https).toBe(false);
    expect(row?.audit?.mobileFriendly).toBe(false);
    expect(row?.audit?.issues).toContain('No contact form');
    expect(row?.hook).toContain('phone');
  });

  it('never revives a suppressed email', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId } = await seedCampaign(db, orgId);
    await db.insert(suppressions).values({ email: 'info@acmeplumbing.com.au', reason: 'unsubscribe' });
    const leadId = uuidv7();
    await db.insert(leads).values({
      id: leadId,
      organizationId: orgId,
      campaignId,
      businessName: 'Acme Plumbing',
      website: 'http://acmeplumbing.com.au',
      status: 'discovered',
    });
    vi.mocked(fetchPage).mockResolvedValue({ url: 'http://acmeplumbing.com.au', html: BAD_SITE });

    await auditLead(db, { organizationId: orgId, leadId });
    const [row] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(row?.status).toBe('suppressed');
  });

  it('marks unreachable sites with a down-site hook', async () => {
    const { orgId } = await seedWorkspace(db);
    const { campaignId } = await seedCampaign(db, orgId);
    const leadId = uuidv7();
    await db.insert(leads).values({
      id: leadId,
      organizationId: orgId,
      campaignId,
      businessName: 'Ghost Co',
      website: 'https://ghost.example.org',
      status: 'discovered',
    });
    vi.mocked(fetchPage).mockResolvedValue(null);

    await auditLead(db, { organizationId: orgId, leadId });
    const [row] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(row?.audit?.reachable).toBe(false);
    expect(row?.hook).toContain('down');
    expect(row?.status).toBe('audited');
  });
});