import type PgBoss from 'pg-boss';
import { z } from 'zod';
import { db } from '@/db';
import { discoverLeads } from '@/agents/lead-scout';
import { auditLead } from '@/agents/site-audit';
import { QUEUES } from '@/lib/queue';

const discoverJob = z.object({ organizationId: z.string(), campaignId: z.string() });
const auditJob = z.object({ organizationId: z.string(), leadId: z.string() });

export function registerLeadJobs(boss: PgBoss): Promise<unknown> {
  return Promise.all([
    boss.work(QUEUES.discoverLeads, async (jobs) => {
      for (const job of jobs) {
        await discoverLeads(db(), discoverJob.parse(job.data));
      }
    }),
    boss.work(QUEUES.auditLead, { batchSize: 5 }, async (jobs) => {
      await Promise.all(jobs.map((job) => auditLead(db(), auditJob.parse(job.data))));
    }),
  ]);
}