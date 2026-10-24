import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const isolatedRunner = 'scripts/run-customer-isolated-tests.mjs';
const sharedSuites = {
  pipeline: 'test:customer-pipeline',
  service: 'test:customer-service',
  whatsapp: 'test:whatsapp-onboarding',
};
const features = [
  'scripts/customer-candidate-matrix.test.mjs',
  'src/hooks/localCustomerProfile.test.ts',
  'server/customerService/localPreviewProfile.test.ts',
  'server/customerService/localPreviewProfileAnalysis.test.ts',
  'scripts/customer-isolation-diagnostics.test.mjs',
  'server/runtime/customerPreviewRecoveryPolicy.test.ts',
  'src/components/customers/CustomerQuoteLauncher.test.tsx',
  'src/components/customers/QuoteSkillCard.test.ts',
  'src/components/customers/CustomerProfileTags.test.tsx',
  'src/components/customers/CustomerProfileAnalysis.test.tsx',
  'src/components/customers/LocalCustomerSimulation.profile.test.ts',
  'src/components/customers/CustomerWorkspaceTools.test.tsx',
  'src/lib/customerReplyRequest.test.ts',
  'src/components/customers/customerReplyPreparation.test.ts',
  'server/customerService/localPreviewReplyCompatibility.test.ts',
  'server/routes/localCustomerSimulation.test.ts',
  'server/messenger/contextTags.test.ts',
  'server/messenger/conversations.test.ts',
  'server/whatsapp/customerProfilePersistence.test.ts',
  'server/routes/quoteSkill.test.ts',
  'server/quoteSkill/card.test.ts',
  'server/quoteSkill/engine.test.ts',
];
export function candidatePlan(suite = 'all', pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))) {
  if (!['all', 'features', 'isolation', ...Object.keys(sharedSuites)].includes(suite)) throw Error('unknown_customer_candidate_suite');
  const groups = [];
  if (suite === 'all' || suite === 'isolation') {
    groups.push({ name: 'isolation-bootstrap', args: ['--test', 'scripts/customer-isolation-bootstrap.test.mjs'] });
    groups.push({ name: 'isolation', args: [isolatedRunner, 'scripts/customer-isolation.test.mjs', 'server/customerService/localPreviewAiIsolation.test.ts'] });
  }
  for (const [name, script] of Object.entries(sharedSuites)) {
    if (suite !== 'all' && suite !== name) continue;
    const prefix = `node ${isolatedRunner} `;
    const command = pkg.scripts[script];
    if (!command?.startsWith(prefix)) throw Error(`customer_candidate_requires_isolated_script:${script}`);
    const files = command.slice(prefix.length).trim().split(/\s+/);
    if (!files.length || files.some(file => !/^[\w./-]+\.test\.(?:ts|tsx|mjs)$/.test(file))) throw Error(`customer_candidate_unsafe_script:${script}`);
    groups.push({ name, args: [isolatedRunner, ...files] });
  }
  if (suite === 'all' || suite === 'features') groups.push({ name: 'features', args: [isolatedRunner, ...features] });
  return groups;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const listOnly = args.includes('--list');
  const checks = args.includes('--checks');
  const names = args.filter(arg => !['--list', '--checks'].includes(arg));
  if (names.length > 1) throw Error('usage: customer-candidate-matrix.mjs [all|features|isolation|pipeline|service|whatsapp] [--list]');
  const plan = checks ? ['lint', 'check:architecture', 'test:architecture-ratchet', 'check:digital-employee-migrations', 'test:migration-guard', 'build'].map(name => ({name,args:['run',name],executable:'pnpm'})) : candidatePlan(names[0] || 'all');
  if (checks) plan.push({name:'diff-check',args:['diff','--check'],executable:'git'});
  if (listOnly) console.log(JSON.stringify(plan, null, 2));
  else {
    // Do not inherit paid-preview permission. Individual isolation-capability tests
    // use controlled providers and the lower transport canary remains installed.
    const env = { ...process.env, CUSTOMER_SIMULATION_REAL_AI: '0', CUSTOMER_ISOLATION_CANARY: '1' };
    const before = snapshot();
    const results = [];
    for (const group of plan) {
      console.log(`customer-candidate:${group.name}:start`);
      const result = spawnSync(group.executable || process.execPath, group.args, { cwd: root, env, stdio: 'inherit' });
      results.push({name:group.name,status:result.status,signal:result.signal,error:result.error?.message || null});
      if (result.error || result.status !== 0) {
        console.error(`customer-candidate:${group.name}:failed`, result.error?.message || result.signal || result.status);
        process.exitCode = result.status || 1;
        break;
      }
      console.log(`customer-candidate:${group.name}:passed`);
    }
    const after = snapshot();
    const changed = [...new Set([...Object.keys(before.files),...Object.keys(after.files)])].filter(file => before.files[file] !== after.files[file]);
    const stable = before.head === after.head && changed.length === 0;
    if (!stable) { console.error('customer-candidate:source-changed-during-run', changed); process.exitCode = 1; }
    const output = path.join(root, 'tmp/customer-service-preview', checks ? 'candidate-checks-result.json' : `candidate-${names[0] || 'all'}-result.json`);
    mkdirSync(path.dirname(output), {recursive:true});
    writeFileSync(output, JSON.stringify({before,after,stable,changed,results,passed:!process.exitCode},null,2)+'\n');
    console.log(`customer-candidate:evidence:${path.relative(root,output)}`);
  }
}

function snapshot() {
  const files = execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(file => /^(?:src\/|server\/|shared\/|scripts\/|pb_migrations\/|docs\/product\/)/.test(file) || ['package.json','pnpm-lock.yaml','vite.config.ts','architecture.config.json','tsconfig.json'].includes(file));
  const hashes = {};
  for (const file of [...new Set(files)].sort()) { try { hashes[file]=createHash('sha256').update(readFileSync(path.join(root,file))).digest('hex'); } catch (error) { if (error.code !== 'ENOENT') throw error; hashes[file]=null; } }
  return {at:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),files:hashes};
}
