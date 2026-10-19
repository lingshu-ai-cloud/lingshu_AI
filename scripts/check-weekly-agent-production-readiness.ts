import { store } from '../server/storage/index.js';
import { probeContentWorkerHeartbeat, probeWeeklyProductionEnvironment } from '../server/socialPrograms/weeklyProductionEnvironmentProbe.js';
import { checkBullMq, closeBullMq } from '../server/queues/bullmq.js';
import { runtimeBuildInfo } from '../server/runtime/buildInfo.js';
import { runWeeklyProductionRuntimeProbe } from '../server/socialPrograms/weeklyProductionRuntimeProbe.js';

let durableRuntimeProbe: Promise<boolean> | undefined;
const runtimeProbe = () => durableRuntimeProbe ??= runWeeklyProductionRuntimeProbe({
  dataStore: store, webBuildSha: runtimeBuildInfo().commitSha,
});

const report = await probeWeeklyProductionEnvironment({
  env: process.env,
  atomicStore: () => store.supportsAtomicOperationLease?.() ?? false,
  contentOrderAtomicStore: async () => Boolean(store.compareAndSwap) && await store.supportsAtomicCompareAndSwap?.() === true,
  queue: checkBullMq,
  contentWorkerHeartbeat: () => probeContentWorkerHeartbeat({ dataStore: store, expectedBuildSha: runtimeBuildInfo().commitSha }),
  langgraphCheckpointStore: runtimeProbe,
  webToWorkerJobClaim: runtimeProbe,
});
await closeBullMq();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ready) process.exitCode = 1;
