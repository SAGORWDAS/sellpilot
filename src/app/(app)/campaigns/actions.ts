'use server';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { db } from '@/db';
import { campaigns, leads, mailboxes, offerProfiles, projects, suppressions } from '@/db/schema';
import { buildStrategy } from '@/agents/strategist';
import { recordEvent } from '@/lib/audit';
import { parseLeadCsv } from '@/lib/csv';
import { AppError, NotFound, ValidationError } from '@/lib/errors';
import { enqueue, QUEUES } from '@/lib/queue';
import { audienceSchema, type Strategy } from '@/lib/schemas';
import { requireActor } from '@/lib/session';
import type { ActionState } from '@/lib/action-state';

export type LaunchState = {
  error?: string;
  campaignId?: string;
  strategy?: Strategy;
};

async function requireCampaign(campaignId: string) {
  const actor = await requireActor();
  const [campaign] = await db()
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.organizationId, actor.organizationId)))
    .limit(1);
  if (!campaign) throw new NotFound();
  return { actor, campaign };
}

const launchInput = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  mailboxId: z.string().uuid(),
  mode: z.enum(['local', 'generic']),
  niche: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  dailyVolume: z.coerce.number().int().min(5).max(40),
  budget: z.coerce.number().min(1).max(100),
});

export async function createCampaignAction(
  _prev: LaunchState,
  formData: FormData,
): Promise<LaunchState> {
  const actor = await requireActor();
  const parsed = launchInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Check the fields — name, mailbox and audience are required.' };
  const input = parsed.data;

  if (input.mode === 'local' && (!input.niche || !input.location)) {
    return { error: 'Local mode needs a niche and a location (e.g. plumbers, Sydney).' };
  }
  if (input.mode === 'generic' && !input.description) {
    return { error: 'Describe the audience for a generic campaign.' };
  }

  try {
    const [project] = await db()
      .select()
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.organizationId, actor.organizationId)))
      .limit(1);
    if (!project) throw new NotFound();

    const [offer] = await db()
      .select()
      .from(offerProfiles)
      .where(eq(offerProfiles.projectId, project.id))
      .limit(1);
    if (!offer) throw new ValidationError('Analyze the project offer first.');

    const [mailbox] = await db()
      .select()
      .from(mailboxes)
      .where(
        and(
          eq(mailboxes.id, input.mailboxId),
          eq(mailboxes.organizationId, actor.organizationId),
          isNull(mailboxes.archivedAt),
        ),
      )
      .limit(1);
    if (!mailbox) throw new ValidationError('Pick a connected mailbox.');

    const audience = audienceSchema.parse({
      mode: input.mode,
      niche: input.niche ?? null,
      location: input.location ?? null,
      description: input.description ?? null,
    });

    const campaignId = uuidv7();
    await db().insert(campaigns).values({
      id: campaignId,
      organizationId: actor.organizationId,
      projectId: project.id,
      mailboxId: mailbox.id,
      name: input.name,
      audience,
      dailyVolume: input.dailyVolume,
      tokenBudgetUsd: input.budget,
      status: 'draft',
    });

    const strategy = await buildStrategy(db(), {
      organizationId: actor.organizationId,
      campaignId,
    });
    return { campaignId, strategy };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    console.error(err);
    return { error: 'Strategy generation failed. Check your OpenAI key and try again.' };
  }
}

export async function regenerateStrategyAction(
  _prev: LaunchState,
  formData: FormData,
): Promise<LaunchState> {
  try {
    const { actor, campaign } = await requireCampaign(String(formData.get('campaignId') ?? ''));
    const strategy = await buildStrategy(db(), {
      organizationId: actor.organizationId,
      campaignId: campaign.id,
    });
    return { campaignId: campaign.id, strategy };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    console.error(err);
    return { error: 'Regeneration failed.' };
  }
}

export async function activateCampaignAction(formData: FormData): Promise<void> {
  const { actor, campaign } = await requireCampaign(String(formData.get('campaignId') ?? ''));
  if (!campaign.strategy) throw new ValidationError('No strategy');
  await db()
    .update(campaigns)
    .set({ status: 'active', startedAt: new Date(), pausedAt: null, updatedAt: new Date() })
    .where(eq(campaigns.id, campaign.id));
  await enqueue(QUEUES.discoverLeads, {
    organizationId: actor.organizationId,
    campaignId: campaign.id,
  });
  await recordEvent(db(), {
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: 'campaign.launched',
    subjectType: 'campaign',
    subjectId: campaign.id,
  });
  redirect(`/campaigns/${campaign.id}`);
}

export async function pauseCampaignAction(formData: FormData): Promise<void> {
  const { actor, campaign } = await requireCampaign(String(formData.get('campaignId') ?? ''));
  await db()
    .update(campaigns)
    .set({ status: 'paused', pausedAt: new Date(), updatedAt: new Date() })
    .where(eq(campaigns.id, campaign.id));
  await recordEvent(db(), {
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: 'campaign.paused',
    subjectType: 'campaign',
    subjectId: campaign.id,
  });
  redirect(`/campaigns/${campaign.id}`);
}

export async function resumeCampaignAction(formData: FormData): Promise<void> {
  const { actor, campaign } = await requireCampaign(String(formData.get('campaignId') ?? ''));
  await db()
    .update(campaigns)
    .set({ status: 'active', pausedAt: null, updatedAt: new Date() })
    .where(eq(campaigns.id, campaign.id));
  await recordEvent(db(), {
    organizationId: actor.organizationId,
    actorId: actor.userId,
    action: 'campaign.resumed',
    subjectType: 'campaign',
    subjectId: campaign.id,
  });
  redirect(`/campaigns/${campaign.id}`);
}

export async function findLeadsAction(formData: FormData): Promise<void> {
  const { actor, campaign } = await requireCampaign(String(formData.get('campaignId') ?? ''));
  if (campaign.strategy) {
    await enqueue(QUEUES.discoverLeads, {
      organizationId: actor.organizationId,
      campaignId: campaign.id,
    });
    await recordEvent(db(), {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: 'leads.discovery_requested',
      subjectType: 'campaign',
      subjectId: campaign.id,
    });
  }
  redirect(`/campaigns/${campaign.id}`);
}

export async function importCsvAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { actor, campaign } = await requireCampaign(String(formData.get('campaignId') ?? ''));
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { error: 'Choose a CSV file.' };
    if (file.size > 2_000_000) return { error: 'File too large (max 2 MB).' };

    const { rows, skipped } = parseLeadCsv(await file.text());
    if (rows.length === 0) {
      return { error: 'No valid rows. The CSV needs an "email" column (name, website, phone, city optional).' };
    }

    const existing = await db()
      .select({ email: leads.email })
      .from(leads)
      .where(eq(leads.campaignId, campaign.id));
    const existingEmails = new Set(existing.map((l) => l.email?.toLowerCase()).filter(Boolean));

    const candidateEmails = rows.map((r) => r.email);
    const suppressedRows = await db()
      .select()
      .from(suppressions)
      .where(inArray(suppressions.email, candidateEmails));
    const suppressedEmails = new Set(suppressedRows.map((s) => s.email));

    let imported = 0;
    let duplicates = 0;
    let suppressedCount = 0;
    for (const row of rows) {
      if (existingEmails.has(row.email)) {
        duplicates++;
        continue;
      }
      existingEmails.add(row.email);
      const suppressed = suppressedEmails.has(row.email);
      const leadId = uuidv7();
      await db().insert(leads).values({
        id: leadId,
        organizationId: actor.organizationId,
        campaignId: campaign.id,
        businessName: row.businessName.slice(0, 200),
        email: row.email,
        website: row.website,
        phone: row.phone,
        city: row.city,
        source: 'csv',
        status: suppressed ? 'suppressed' : 'audited',
      });
      if (suppressed) {
        suppressedCount++;
        continue;
      }
      if (row.website) {
        await enqueue(QUEUES.auditLead, { organizationId: actor.organizationId, leadId });
      }
      imported++;
    }

    await recordEvent(db(), {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: 'leads.imported',
      subjectType: 'campaign',
      subjectId: campaign.id,
      metadata: { imported, duplicates, suppressed: suppressedCount, skipped },
    });

    return {
      ok: true,
      error: undefined,
      fieldErrors: {
        summary: `Imported ${imported}. ${duplicates} duplicates, ${suppressedCount} suppressed, ${skipped} invalid rows skipped.`,
      },
    };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    console.error(err);
    return { error: 'Import failed.' };
  }
}