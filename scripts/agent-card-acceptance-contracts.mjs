import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Each row names the existing isolated business fixture and the public/UI contract.
// This runner never imports the server entry point or live provider implementations.
export const categories = [
  ['publication-execution', '发布执行', ['server/publishing/weeklyPublicationExecutionWorker.test.ts', 'src/lib/agentOperatingControlActions.test.ts']],
  ['inventory-reuse', '库存复用', ['server/socialPrograms/weeklyInventoryReuse.integration.test.ts', 'src/lib/weeklyInventoryReuseApi.test.ts']],
  ['cross-week-material', '跨周素材', ['server/socialPrograms/weeklyCrossWeekMaterialContinuations.test.ts']],
  ['knowledge-quote', '客服知识/报价补齐', ['server/socialPrograms/weeklyCustomerKnowledgeQuote.test.ts', 'src/lib/weeklyCustomerKnowledgeQuoteApi.test.ts']],
  ['publication-recovery', '发布恢复', ['server/socialPrograms/weeklyPublicationRecovery.test.ts', 'src/lib/weeklyPublicationRecoveryApi.test.ts']],
  ['native-recovery', 'M/IG恢复', ['server/socialPrograms/weeklyNativeSendRecovery.test.ts', 'src/lib/weeklyNativeSendRecoveryApi.test.ts']],
  ['wa-recovery', 'WA恢复', ['server/socialPrograms/weeklyCustomerSendRecovery.test.ts', 'src/lib/weeklyCustomerSendRecoveryApi.test.ts']],
  ['sales-handoff', '销售交接', ['src/components/socialProgram/weeklySalesCalendarProjection.test.ts', 'src/lib/weeklySalesConversationEvidenceApi.test.ts']],
  ['content-production', '内容生产', ['src/lib/weeklyContentProductionView.test.ts', 'src/lib/weeklyContentNavigationApi.test.ts']],
  ['manual-material', '人工素材', ['server/socialPrograms/weeklyMaterialNewConsumerAcceptance.test.ts', 'src/lib/weeklyMaterialBinding.test.ts']],
  ['customer-runtime', '客服运行', ['src/lib/weeklyCustomerRunApi.test.ts', 'src/lib/weeklyCustomerChannelScopeApi.test.ts']],
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const selected = process.argv.slice(2);
const unknown = selected.filter(id => !categories.some(row => row[0] === id));
if (unknown.length) throw new Error(`Unknown category: ${unknown.join(', ')}`);
const rows = categories.filter(row => !selected.length || selected.includes(row[0]));
const output = resolve(root, 'work/agent-card-acceptance');
mkdirSync(output, { recursive: true });
const results = [];
for (const [id, label, files] of rows) {
  for (const file of files) if (!existsSync(resolve(root, file))) throw new Error(`Missing fixture contract: ${file}`);
  const args = ['exec', 'tsx', '--test', ...files];
  const run = spawnSync('pnpm', args, { cwd: root, encoding: 'utf8', timeout: 120000 });
  writeFileSync(resolve(output, `${id}.log`), `${run.stdout ?? ''}\n${run.stderr ?? ''}\n${run.error ?? ''}`);
  const result = { id, label, files, command: `pnpm ${args.join(' ')}`, passed: run.status === 0 && !run.error, exitCode: run.status, signal: run.signal, error: run.error?.message ?? null };
  results.push(result);
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${id}: ${label}`);
}
writeFileSync(resolve(output, 'results.json'), JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2));
process.exitCode = results.every(row => row.passed) ? 0 : 1;
