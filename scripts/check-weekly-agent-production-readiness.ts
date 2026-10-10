import { store } from '../server/storage/index.js';
import { probeWeeklyProductionEnvironment } from '../server/socialPrograms/weeklyProductionEnvironmentProbe.js';
import { checkBullMq, closeBullMq } from '../server/queues/bullmq.js';

const report = await probeWeeklyProductionEnvironment({
  env: process.env,
  atomicStore: () => store.supportsAtomicOperationLease?.() ?? false,
  queue: checkBullMq,
});
await closeBullMq();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ready) process.exitCode = 1;
