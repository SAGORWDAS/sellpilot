import PgBoss from 'pg-boss';

export const QUEUES = {
  analyzeOffer: 'analyze-offer',
  buildStrategy: 'build-strategy',
  discoverLeads: 'discover-leads',
  auditLead: 'audit-lead',
  writeSequence: 'write-sequence',
  sendTick: 'send-tick',
  sendEmail: 'send-email',
  pollInbox: 'poll-inbox',
  pollMailbox: 'poll-mailbox',
  handleReply: 'handle-reply',
  dailyDigest: 'daily-digest',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const globalForBoss = globalThis as unknown as { __spBoss?: Promise<PgBoss> };

export function makeBoss(url: string): PgBoss {
  const boss = new PgBoss(url);
  boss.on('error', (err) => console.error('[pg-boss]', err));
  return boss;
}

export async function startBoss(boss: PgBoss): Promise<void> {
  await boss.start();
  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name);
  }
}

export function boss(): Promise<PgBoss> {
  if (!globalForBoss.__spBoss) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const b = makeBoss(url);
    globalForBoss.__spBoss = startBoss(b).then(() => b);
  }
  return globalForBoss.__spBoss;
}

export async function enqueue(
  name: QueueName,
  data: Record<string, unknown>,
  options: PgBoss.SendOptions = {},
): Promise<string | null> {
  const b = await boss();
  return b.send(name, data, {
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    ...options,
  });
}