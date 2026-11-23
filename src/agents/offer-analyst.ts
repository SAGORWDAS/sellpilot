import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Database } from '@/db';
import { offerProfiles, projects } from '@/db/schema';
import { recordEvent } from '@/lib/audit';
import { crawlOffer } from '@/lib/crawl';
import { NotFound, ValidationError } from '@/lib/errors';
import { complete } from '@/lib/openai';
import { offerProfileSchema, type OfferProfile } from '@/lib/schemas';

const SYSTEM = `You are a sales offer analyst. From website content, extract a factual profile of the business and its offer.
Rules:
- Never invent prices, claims, testimonials or statistics. Only use what the content supports.
- If something is unknown, use null or an empty array — never guess.
- description: 2-3 plain sentences about what the business sells and to whom.
- targetAudience: one sentence describing who buys this offer.
- valueProps: concrete benefits stated or clearly implied by the content (max 6).
- proofPoints: only real proof present in the content (reviews, years in business, client names, guarantees).
- offerings: the actual products/services with prices exactly as shown (null if not shown).
- faq: up to 5 questions a buyer would ask, answered ONLY from the content.
- tone: the voice that fits this business (professional, friendly or direct).`;

export async function analyzeOffer(
  db: Database,
  input: { organizationId: string; projectId: string },
): Promise<OfferProfile> {
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(eq(projects.id, input.projectId), eq(projects.organizationId, input.organizationId)),
    )
    .limit(1);
  if (!project) throw new NotFound('Project not found');
  if (project.urls.length === 0) throw new ValidationError('Project has no URL to analyze');

  const sourceText = await crawlOffer(project.urls);
  if (!sourceText.trim()) {
    throw new ValidationError('Could not read any content from the project URL');
  }

  const profile = await complete(db, {
    organizationId: input.organizationId,
    operation: 'offer-analysis',
    tier: 'bulk',
    schema: offerProfileSchema,
    name: 'offer_profile',
    system: SYSTEM,
    user: `Project type: ${project.type}\nSales goal: ${project.goal}\nURLs: ${project.urls.join(', ')}\n\nWebsite content:\n${sourceText}`,
    maxTokens: 4000,
  });

  const values = {
    id: uuidv7(),
    organizationId: input.organizationId,
    projectId: project.id,
    profile,
    sourceText: sourceText.slice(0, 50_000),
    analyzedAt: new Date(),
    updatedAt: new Date(),
  };
  await db
    .insert(offerProfiles)
    .values(values)
    .onConflictDoUpdate({
      target: offerProfiles.projectId,
      set: { profile, sourceText: values.sourceText, analyzedAt: values.analyzedAt, updatedAt: values.updatedAt },
    });

  await recordEvent(db, {
    organizationId: input.organizationId,
    action: 'offer.analyzed',
    subjectType: 'project',
    subjectId: project.id,
    metadata: { businessName: profile.businessName },
  });

  return profile;
}