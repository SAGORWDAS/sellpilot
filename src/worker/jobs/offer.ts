import type PgBoss from 'pg-boss';
import { z } from 'zod';
import { db } from '@/db';
import { analyzeOffer } from '@/agents/offer-analyst';
import { buildStrategy } from '@/agents/strategist';
import { QUEUES } from '@/lib/queue';

const offerJob = z.object({ organizationId: z.string(), projectId: z.string() });
const strategyJob = z.object({ organizationId: z.string(), campaignId: z.string() });

export function registerOfferJobs(boss: PgBoss): Promise<unknown> {
  return Promise.all([
    boss.work(QUEUES.analyzeOffer, async (jobs) => {
      for (const job of jobs) {
        const data = offerJob.parse(job.data);
        await analyzeOffer(db(), data);
      }
    }),
    boss.work(QUEUES.buildStrategy, async (jobs) => {
      for (const job of jobs) {
        const data = strategyJob.parse(job.data);
        await buildStrategy(db(), data);
      }
    }),
  ]);
}