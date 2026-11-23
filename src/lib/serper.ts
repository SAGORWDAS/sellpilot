import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Database } from '@/db';
import { apiUsage, orgSettings } from '@/db/schema';
import { assertCampaignBudget } from '@/lib/budget';
import { decryptSecret } from '@/lib/crypto';

export type SearchHit = { title: string; link: string; snippet: string };
export type PlaceHit = {
  title: string;
  website: string | null;
  phone: string | null;
  address: string | null;
};

async function resolveKey(db: Database, organizationId: string): Promise<string> {
  const [settings] = await db
    .select()
    .from(orgSettings)
    .where(eq(orgSettings.organizationId, organizationId))
    .limit(1);
  if (settings?.serperKeyEnc) return decryptSecret(settings.serperKeyEnc);
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('No Serper API key configured (settings or SERPER_API_KEY)');
  return key;
}

async function callSerper(
  db: Database,
  opts: { organizationId: string; campaignId?: string | null },
  endpoint: 'search' | 'places',
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (opts.campaignId) await assertCampaignBudget(db, opts.campaignId);
  const key = await resolveKey(db, opts.organizationId);
  const res = await fetch(`https://google.serper.dev/${endpoint}`, {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  await db.insert(apiUsage).values({
    id: uuidv7(),
    organizationId: opts.organizationId,
    campaignId: opts.campaignId ?? null,
    provider: 'serper',
    model: endpoint,
    operation: `lead-discovery-${endpoint}`,
    costUsd: endpoint === 'places' ? 0.003 : 0.001,
  });
  if (!res.ok) throw new Error(`Serper ${endpoint} failed: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function serperSearch(
  db: Database,
  opts: { organizationId: string; campaignId?: string | null; query: string },
): Promise<SearchHit[]> {
  const data = await callSerper(db, opts, 'search', { q: opts.query, num: 20 });
  const organic = Array.isArray(data['organic']) ? (data['organic'] as Record<string, unknown>[]) : [];
  return organic
    .filter((r) => typeof r['link'] === 'string')
    .map((r) => ({
      title: String(r['title'] ?? ''),
      link: String(r['link']),
      snippet: String(r['snippet'] ?? ''),
    }));
}

export async function serperPlaces(
  db: Database,
  opts: { organizationId: string; campaignId?: string | null; query: string; location: string | null },
): Promise<PlaceHit[]> {
  const body: Record<string, unknown> = { q: opts.query };
  if (opts.location) body['location'] = opts.location;
  const data = await callSerper(db, opts, 'places', body);
  const places = Array.isArray(data['places']) ? (data['places'] as Record<string, unknown>[]) : [];
  return places.map((p) => ({
    title: String(p['title'] ?? ''),
    website: typeof p['website'] === 'string' ? p['website'] : null,
    phone: typeof p['phoneNumber'] === 'string' ? p['phoneNumber'] : null,
    address: typeof p['address'] === 'string' ? p['address'] : null,
  }));
}