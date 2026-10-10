import { store } from '../server/storage/index.js';
import { evaluateWeeklyProductionEnvironment } from '../server/socialPrograms/weeklyProductionEnvironmentReadiness.js';

const atomic = await store.supportsAtomicOperationLease?.() === true;
const report = evaluateWeeklyProductionEnvironment(process.env, atomic);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ready) process.exitCode = 1;
