import { eq, sql } from 'drizzle-orm';
import type { Database } from '@/db';
import { apiUsage, campaigns } from '@/db/schema';
import { BudgetExceeded } from '@/lib/errors';

export async function assertCampaignBudget(db: Database, campaignId: string): Promise<void> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) return;
  const [spend] = await db
    .select({ total: sql<number>`coalesce(sum(${apiUsage.costUsd}), 0)` })
    .from(apiUsage)
    .where(eq(apiUsage.campaignId, campaignId));
  if (Number(spend?.total ?? 0) >= campaign.tokenBudgetUsd) {
    throw new BudgetExceeded();
  }
}