import { execFileSync } from 'node:child_process';

const run = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const lines = value => value ? value.split('\n').filter(Boolean) : [];

const branch = run('branch', '--show-current');
const head = run('rev-parse', 'HEAD');
const status = lines(run('status', '--porcelain=v1', '-uall'));
const trackedChanges = status.filter(line => !line.startsWith('??'));
const untracked = status.filter(line => line.startsWith('??'));
const runtimeOnly = status.filter(line => /^(data|video|work|tmp|artifacts|reports)\//.test(line.slice(3)));
const baselineRelevant = status.filter(line => !/^(data|video|work|tmp|artifacts|reports)\//.test(line.slice(3)));
const codeOrMigrationChanges = status.filter(line => {
  const file = line.slice(3);
  return /^(apps|desktop|pb_migrations|scripts|server|shared|src)\//.test(file)
    || ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'vite.config.ts'].includes(file);
});

let diffCheck = 'passed';
let diffCheckOutput = '';
try {
  run('diff', '--check');
} catch (error) {
  diffCheck = 'failed';
  diffCheckOutput = String(error.stdout || error.message || error).trim();
}

const report = {
  schema: 'workspace-baseline-report.v1',
  generatedAt: new Date().toISOString(),
  branch,
  head,
  clean: baselineRelevant.length === 0,
  worktreeCompletelyClean: status.length === 0,
  trackedChangeCount: trackedChanges.length,
  untrackedCount: untracked.length,
  runtimeOnlyChangeCount: runtimeOnly.length,
  baselineRelevantChangeCount: baselineRelevant.length,
  codeOrMigrationChangeCount: codeOrMigrationChanges.length,
  diffCheck,
  diffCheckOutput,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.clean || report.diffCheck !== 'passed') process.exitCode = 1;
