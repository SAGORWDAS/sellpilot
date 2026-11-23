import { boss, QUEUES } from '@/lib/queue';
import { registerOfferJobs } from '@/worker/jobs/offer';
import { registerLeadJobs } from '@/worker/jobs/leads';
import { registerSendJobs } from '@/worker/jobs/send';
import { registerInboxJobs } from '@/worker/jobs/inbox';
import { registerReplyJobs } from '@/agents/reply-agent';
import { registerDigestJobs } from '@/worker/jobs/digest';

async function main() {
  const b = await boss();
  await registerOfferJobs(b);
  await registerLeadJobs(b);
  await registerSendJobs(b);
  await registerInboxJobs(b);
  await registerReplyJobs(b);
  await registerDigestJobs(b);

  await b.schedule(QUEUES.sendTick, '* * * * *', {});
  await b.schedule(QUEUES.pollInbox, '*/2 * * * *', {});
  await b.schedule(QUEUES.dailyDigest, '0 20 * * *', {});
  console.log('[worker] queue ready — full pipeline registered');

  const shutdown = async () => {
    console.log('[worker] stopping');
    await b.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});