import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Database } from '@/db';
import { campaigns, leads } from '@/db/schema';
import { recordEvent } from '@/lib/audit';
import { NotFound, ValidationError } from '@/lib/errors';
import { enqueue, QUEUES } from '@/lib/queue';
import { serperPlaces, serperSearch } from '@/lib/serper';

const SKIP_DOMAINS = [
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
  'youtube.com', 'tiktok.com', 'pinterest.com', 'reddit.com', 'quora.com',
  'yelp.com', 'tripadvisor.com', 'wikipedia.org', 'amazon.com', 'ebay.com',
  'etsy.com', 'gumtree.com.au', 'yellowpages.com.au', 'truelocal.com.au',
  'hotfrog.com.au', 'google.com', 'bing.com', 'apple.com', 'play.google.com',
  'medium.com', 'blogspot.com', 'wordpress.com', 'wix.com', 'shopify.com',
  'squarespace.com', 'godaddy.com', 'youtube-nocookie.com', 'whatsapp.com',
];

export function isSkippableDomain(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
    return SKIP_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return true;
  }
}

export function domainOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

type Candidate = {
  businessName: string;
  website: string;
  phone: string | null;
  city: string | null;
  source: 'places' | 'search';
  sourceRef: string | null;
};

const MAX_NEW_LEADS = 100;

export async function discoverLeads(
  db: Database,
  input: { organizationId: string; campaignId: string },
): Promise<{ discovered: number }> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(
      and(eq(campaigns.id, input.campaignId), eq(campaigns.organizationId, input.organizationId)),
    )
    .limit(1);
  if (!campaign) throw new NotFound('Campaign not found');
  if (!campaign.strategy) throw new ValidationError('Build the strategy before finding leads');

  const existing = await db
    .select({ website: leads.website, email: leads.email })
    .from(leads)
    .where(eq(leads.campaignId, campaign.id));
  const seenDomains = new Set(
    existing.map((l) => (l.website ? domainOf(l.website) : null)).filter(Boolean),
  );

  const candidates: Candidate[] = [];
  for (const q of campaign.strategy.discoveryQueries.slice(0, 8)) {
    try {
      if (q.kind === 'places') {
        const places = await serperPlaces(db, {
          organizationId: input.organizationId,
          campaignId: campaign.id,
          query: q.query,
          location: q.location,
        });
        for (const p of places) {
          if (!p.website || isSkippableDomain(p.website)) continue;
          candidates.push({
            businessName: p.title,
            website: p.website,
            phone: p.phone,
            city: p.address,
            source: 'places',
            sourceRef: q.query,
          });
        }
      } else {
        const hits = await serperSearch(db, {
          organizationId: input.organizationId,
          campaignId: campaign.id,
          query: q.query,
        });
        for (const h of hits) {
          if (isSkippableDomain(h.link)) continue;
          candidates.push({
            businessName: h.title.split(/[|\-–—]/)[0]?.trim() || h.title,
            website: h.link,
            phone: null,
            city: q.location,
            source: 'search',
            sourceRef: q.query,
          });
        }
      }
    } catch (err) {
      console.error(`[lead-scout] query failed: ${q.query}`, err);
    }
    if (candidates.length >= MAX_NEW_LEADS * 2) break;
  }

  let discovered = 0;
  for (const c of candidates) {
    if (discovered >= MAX_NEW_LEADS) break;
    const domain = domainOf(c.website);
    if (!domain || seenDomains.has(domain)) continue;
    seenDomains.add(domain);

    const leadId = uuidv7();
    await db.insert(leads).values({
      id: leadId,
      organizationId: input.organizationId,
      campaignId: campaign.id,
      businessName: c.businessName.slice(0, 200),
      website: c.website,
      phone: c.phone,
      city: c.city,
      source: c.source,
      sourceRef: c.sourceRef,
      status: 'discovered',
    });
    await enqueue(QUEUES.auditLead, { organizationId: input.organizationId, leadId });
    discovered++;
  }

  await recordEvent(db, {
    organizationId: input.organizationId,
    action: 'leads.discovered',
    subjectType: 'campaign',
    subjectId: campaign.id,
    metadata: { count: discovered },
  });

  return { discovered };
}