import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = readdirSync(path.join(root, 'server/platformAds')).filter(name => name.endsWith('.test.ts')).sort();
for (const test of tests) {
  console.log(`Testing platformAds/${test}`);
  const result = spawnSync(process.execPath, ['--import', 'tsx', `server/platformAds/${test}`], { cwd: root, stdio: 'inherit', timeout: 180_000 });
  if (result.error || result.status !== 0) { console.error(`Failed: ${test}${result.error ? ` (${result.error.message})` : ''}`); process.exit(1); }
}
console.log(`Passed ${tests.length} platform ads test files.`);
