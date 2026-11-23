'use server';

import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { db } from '@/db';
import { offerProfiles, projects } from '@/db/schema';
import { analyzeOffer } from '@/agents/offer-analyst';
import { recordEvent } from '@/lib/audit';
import { assertPublicUrl } from '@/lib/crawl';
import { AppError, NotFound } from '@/lib/errors';
import { enqueue, QUEUES } from '@/lib/queue';
import { projectGoalSchema, projectTypeSchema, type OfferProfile } from '@/lib/schemas';
import { requireActor } from '@/lib/session';

export type WizardState = {
  error?: string;
  projectId?: string;
  profile?: OfferProfile;
  goal?: string;
};

const analyzeInput = z.object({
  url: z.string().min(4),
  type: projectTypeSchema,
  goal: projectGoalSchema,
  name: z.string().trim().max(120).optional(),
});

export async function analyzeProjectAction(
  _prev: WizardState,
  formData: FormData,
): Promise<WizardState> {
  const actor = await requireActor();
  const parsed = analyzeInput.safeParse({
    url: String(formData.get('url') ?? '').trim(),
    type: String(formData.get('type') ?? 'service'),
    goal: String(formData.get('goal') ?? 'book_call'),
    name: String(formData.get('name') ?? '').trim() || undefined,
  });
  if (!parsed.success) return { error: 'Check the URL and options.' };

  try {
    const url = assertPublicUrl(parsed.data.url);
    const projectId = uuidv7();
    await db().insert(projects).values({
      id: projectId,
      organizationId: actor.organizationId,
      name: parsed.data.name || url.hostname.replace(/^www\./, ''),
      type: parsed.data.type,
      goal: parsed.data.goal,
      urls: [url.toString()],
      createdById: actor.userId,
    });

    try {
      const profile = await analyzeOffer(db(), {
        organizationId: actor.organizationId,
        projectId,
      });
      if (!parsed.data.name && profile.businessName) {
        await db()
          .update(projects)
          .set({ name: profile.businessName, updatedAt: new Date() })
          .where(eq(projects.id, projectId));
      }
      await recordEvent(db(), {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: 'project.created',
        subjectType: 'project',
        subjectId: projectId,
      });
      return { projectId, profile, goal: parsed.data.goal };
    } catch (err) {
      await db().delete(projects).where(eq(projects.id, projectId));
      throw err;
    }
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    console.error(err);
    return { error: 'Analysis failed. Check the URL and your OpenAI key, then try again.' };
  }
}

const saveInput = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  goal: projectGoalSchema,
  closeLink: z.string().trim().max(500).optional(),
  closeNotes: z.string().trim().max(1000).optional(),
  businessName: z.string().trim().min(1).max(200),
  tagline: z.string().trim().max(300),
  description: z.string().trim().min(1).max(2000),
  targetAudience: z.string().trim().max(500),
  tone: z.enum(['professional', 'friendly', 'direct']),
  valueProps: z.string().max(2000),
  proofPoints: z.string().max(2000),
});

function lines(s: string): string[] {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 10);
}

export async function saveProjectAction(
  _prev: WizardState,
  formData: FormData,
): Promise<WizardState> {
  const actor = await requireActor();
  const parsed = saveInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Fill in the required fields.' };
  const input = parsed.data;

  const [project] = await db()
    .select()
    .from(projects)
    .where(
      and(eq(projects.id, input.projectId), eq(projects.organizationId, actor.organizationId)),
    )
    .limit(1);
  if (!project) throw new NotFound();

  const [offer] = await db()
    .select()
    .from(offerProfiles)
    .where(eq(offerProfiles.projectId, project.id))
    .limit(1);
  if (!offer) return { error: 'Analyze the project first.' };

  const profile: OfferProfile = {
    ...offer.profile,
    businessName: input.businessName,
    tagline: input.tagline,
    description: input.description,
    targetAudience: input.targetAudience,
    tone: input.tone,
    valueProps: lines(input.valueProps),
    proofPoints: lines(input.proofPoints),
  };

  await db()
    .update(offerProfiles)
    .set({ profile, updatedAt: new Date() })
    .where(eq(offerProfiles.projectId, project.id));
  await db()
    .update(projects)
    .set({
      name: input.name,
      goal: input.goal,
      closeLink: input.closeLink || null,
      closeNotes: input.closeNotes || null,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, project.id));

  redirect(`/projects/${project.id}`);
}

export async function reanalyzeAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const projectId = String(formData.get('projectId') ?? '');
  const [project] = await db()
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, actor.organizationId)))
    .limit(1);
  if (!project) throw new NotFound();

  await enqueue(QUEUES.analyzeOffer, {
    organizationId: actor.organizationId,
    projectId: project.id,
  });
  redirect(`/projects/${project.id}`);
}