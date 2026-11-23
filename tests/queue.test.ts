import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import PgBoss from 'pg-boss';
import { makeBoss, startBoss } from '../src/lib/queue';

let boss: PgBoss;

beforeAll(async () => {
  boss = makeBoss(process.env.TEST_DATABASE_URL!);
  await startBoss(boss);
});

afterAll(async () => {
  await boss.stop();
});

describe('job queue', () => {
  it('delivers a job payload to a worker', async () => {
    const received: unknown[] = [];
    await boss.work('audit-lead', async (jobs) => {
      for (const job of jobs) received.push(job.data);
    });

    await boss.send('audit-lead', { leadId: 'abc', organizationId: 'org' });

    const deadline = Date.now() + 15_000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(received).toEqual([{ leadId: 'abc', organizationId: 'org' }]);
  });
});