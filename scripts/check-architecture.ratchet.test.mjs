import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'lingshu-architecture-ratchet-'));
const fixtureGuard = path.join(fixtureRoot, 'scripts/check-architecture.mjs');
const fixtureConfig = path.join(fixtureRoot, 'architecture.config.json');

const baselineConfig = {
  schemaVersion: 1,
  sourceRoots: ['src', 'server', 'shared'],
  extensions: ['.ts', '.tsx'],
  defaultMaxLines: 4,
  excludeNameFragments: ['.test.', '.d.ts'],
  oversizedFileBudgets: {
    'src/legacy.ts': 7,
  },
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: fixtureRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`);
  }
  return result.stdout.trim();
}

async function writeConfig(config) {
  await writeFile(fixtureConfig, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function cloneBaseline() {
  return structuredClone(baselineConfig);
}

function runGuard(baselineCommit) {
  return spawnSync(process.execPath, [fixtureGuard], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env: { ...process.env, ARCHITECTURE_BASE_REF: baselineCommit },
  });
}

function output(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

async function expectRejected(baselineCommit, label, mutate, expected) {
  const config = cloneBaseline();
  mutate(config);
  await writeConfig(config);
  const result = runGuard(baselineCommit);
  assert.notEqual(result.status, 0, `${label} must fail the architecture ratchet`);
  assert.match(output(result), expected, `${label} must report the rejected policy change`);
}

try {
  await Promise.all([
    mkdir(path.join(fixtureRoot, 'scripts'), { recursive: true }),
    mkdir(path.join(fixtureRoot, 'src'), { recursive: true }),
    mkdir(path.join(fixtureRoot, 'server'), { recursive: true }),
    mkdir(path.join(fixtureRoot, 'shared'), { recursive: true }),
  ]);
  await cp(path.join(repositoryRoot, 'scripts/check-architecture.mjs'), fixtureGuard);
  await Promise.all([
    writeFile(path.join(fixtureRoot, 'src/small.ts'), 'export const small = true;\n', 'utf8'),
    writeFile(path.join(fixtureRoot, 'src/legacy.ts'), [
      'export const legacy = {',
      '  one: 1,',
      '  two: 2,',
      '  three: 3,',
      '  four: 4,',
      '};',
      '',
    ].join('\n'), 'utf8'),
    writeFile(path.join(fixtureRoot, 'server/view.tsx'), 'export const view = null;\n', 'utf8'),
    writeFile(path.join(fixtureRoot, 'shared/types.ts'), 'export type Shared = string;\n', 'utf8'),
    writeConfig(baselineConfig),
  ]);

  run('git', ['init', '--quiet']);
  run('git', ['config', 'user.email', 'architecture-ratchet@example.test']);
  run('git', ['config', 'user.name', 'Architecture Ratchet Test']);
  run('git', ['add', '.']);
  run('git', ['commit', '--quiet', '-m', 'baseline architecture policy']);
  const baselineCommit = run('git', ['rev-parse', 'HEAD']);

  const unchanged = runGuard(baselineCommit);
  assert.equal(unchanged.status, 0, `the unchanged baseline must pass:\n${output(unchanged)}`);

  await expectRejected(baselineCommit, 'a relaxed default limit', config => {
    config.defaultMaxLines = baselineConfig.defaultMaxLines + 1;
  }, /defaultMaxLines increased from 4 to 5/);

  await expectRejected(baselineCommit, 'an expanded legacy-debt budget', config => {
    config.oversizedFileBudgets['src/legacy.ts'] = 8;
  }, /src\/legacy\.ts: budget increased from 7 to 8/);

  await expectRejected(baselineCommit, 'a new exclusion fragment', config => {
    config.excludeNameFragments.push('.spec.');
  }, /new architecture exclusion requires an explicit guard-policy review: \.spec\./);

  await expectRejected(baselineCommit, 'a removed source root', config => {
    config.sourceRoots = config.sourceRoots.filter(root => root !== 'shared');
  }, /source root removed from architecture guard: shared/);

  await expectRejected(baselineCommit, 'a removed source extension', config => {
    config.extensions = config.extensions.filter(extension => extension !== '.tsx');
  }, /source extension removed from architecture guard: \.tsx/);

  const reducedBudget = cloneBaseline();
  reducedBudget.oversizedFileBudgets['src/legacy.ts'] = 6;
  await writeConfig(reducedBudget);
  const reduced = runGuard(baselineCommit);
  assert.equal(reduced.status, 0, `a budget reduced to the file's current size must pass:\n${output(reduced)}`);
  assert.match(output(reduced), /Architecture budget ratchet checked against/);

  console.log('architecture ratchet tests passed');
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
