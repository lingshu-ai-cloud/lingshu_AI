import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const dockerfile = read('Dockerfile');
const pocketbaseDockerfile = read('Dockerfile.pocketbase');
const dockerignore = read('.dockerignore');
const compose = read('docker-compose.yml');
const releaseCompose = read('deploy/compose.release.yml');
const packageJson = JSON.parse(read('package.json'));

assert.match(packageJson.packageManager || '', /^pnpm@\d+\.\d+\.\d+$/, 'packageManager must pin pnpm');
assert.equal(typeof packageJson.dependencies?.tsx, 'string', 'the production start command requires tsx as a runtime dependency');
assert.equal(packageJson.devDependencies?.tsx, undefined, 'tsx must not be development-only while production starts TypeScript directly');
assert.equal(fs.existsSync(new URL('../package-lock.json', import.meta.url)), false, 'npm lockfile must not diverge from pnpm');
assert.match(dockerfile, /COPY package\.json pnpm-lock\.yaml/);
assert.match(dockerfile, /pnpm install --frozen-lockfile/);
assert.match(dockerfile, /AS build[\s\S]*pnpm prune --prod[\s\S]*AS runtime/, 'runtime image must not retain development dependencies');
assert.doesNotMatch(dockerfile, /\bnpm ci|\bnpm run|setup:pb/, 'the app image must use the same dependency graph and leave schema writes to PB migrations');
assert.doesNotMatch(dockerignore, /^\*\.(?:png|gif)$/m, 'runtime UI images must not be globally excluded');
assert.match(compose, /api\/overseas\/ready/, 'container health must exercise dependency readiness');
assert.match(compose, /app:[\s\S]*PROCESS_ROLE:\s*web/, 'the HTTP service must run with the web-only process role');
assert.match(compose, /worker:[\s\S]*PROCESS_ROLE:\s*worker/, 'background production must run in an independent worker service');
assert.match(compose, /PROCESS_ROLE_SPLIT_ENABLED:\s*"true"/, 'the durable web/worker split must be explicitly enabled');
assert.match(releaseCompose, /api\/overseas\/ready/, 'release container health must exercise dependency readiness');
assert.match(dockerfile, /person-replacement-qa-requirements\.txt[\s\S]*person_replacement_visual_qa\.py/, 'runtime image must copy the independent visual QA dependencies and script');
assert.match(dockerfile, /person_replacement_visual_qa\.py --self-check/, 'runtime image build must execute the visual QA self-check');
assert.match(dockerfile, /DIGITAL_HUMAN_VISUAL_QA_PYTHON=\/usr\/bin\/python3/, 'runtime image must declare the bundled QA interpreter');
assert.match(
  pocketbaseDockerfile,
  /COPY\s+pb_migrations\s+\/pb\/pb_migrations/,
  'the immutable PocketBase image must contain the versioned migrations used at startup',
);

const ignoreRules = dockerignore.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
for (const sensitiveRoot of ['backups', 'restore', 'pb_data']) {
  assert.ok(
    ignoreRules.includes(sensitiveRoot) || ignoreRules.includes(`${sensitiveRoot}/`),
    `${sensitiveRoot}/ must be absent from the Docker build context`,
  );
}
const dataDenyIndex = Math.max(ignoreRules.lastIndexOf('data/'), ignoreRules.lastIndexOf('data/**'));
assert.notEqual(dataDenyIndex, -1, 'the Docker context must deny runtime data/** by default');
assert.equal(
  ignoreRules.slice(dataDenyIndex + 1).some(rule => /^!\/?data(?:\/|$)/.test(rule)),
  false,
  'no later dockerignore rule may re-include tenant runtime data',
);

const contextCopies = dockerfile.split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => /^COPY\s/.test(line) && !/^COPY\s+--from=/.test(line));
const copiedContextSources = [];
for (const instruction of contextCopies) {
  const tokens = instruction.replace(/^COPY\s+/, '').split(/\s+/);
  const sources = tokens.slice(0, -1);
  assert.ok(sources.length > 0, `COPY instruction has no source: ${instruction}`);
  for (const source of sources) {
    assert.notEqual(source, '.', 'Dockerfile must use an explicit source allowlist instead of COPY .');
    assert.doesNotMatch(source.replace(/^\.\//, ''), /^data(?:\/|$)/, 'Dockerfile must never copy runtime data into an image layer');
    copiedContextSources.push(source.replace(/^\.\//, '').replace(/\/$/, ''));
  }
}
assert.doesNotMatch(dockerfile, /^ADD\s/m, 'ADD can bypass the reviewed COPY source allowlist');

// Exercise the deny boundary with representative tenant secrets. Docker is not
// required for this contract: the unconditional data/** rule proves these files
// are absent from the daemon context, while the COPY allowlist independently
// proves they cannot enter an image layer even if a client misapplies ignores.
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-docker-context-'));
try {
  const fixtures = [
    'data/local-store/tenant_api_keys.json',
    'data/local-auth-tenants.json',
    'data/local-auth-accounts.json',
    'data/whatsapp-customers.json',
    'data/media/tenants/customer/private-video.mp4',
    'data/backups/latest/whatsapp-customers.json',
  ];
  for (const relative of fixtures) {
    const target = path.join(fixtureRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `CONTAINER_SECRET_FIXTURE:${relative}\n`, 'utf8');
  }
  fs.mkdirSync(path.join(fixtureRoot, 'public/demo'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'public/demo/static.txt'), 'public-static-fixture\n', 'utf8');

  const normalized = relative => relative.replace(/\\/g, '/').replace(/^\.\//, '');
  const includedByContextPolicy = relative => {
    const candidate = normalized(relative);
    let included = true;
    for (const rawRule of ignoreRules) {
      const negated = rawRule.startsWith('!');
      const rule = normalized(negated ? rawRule.slice(1) : rawRule);
      const matches = (rule === 'data/' || rule === 'data/**')
        && (candidate === 'data' || candidate.startsWith('data/'));
      if (matches) included = negated;
    }
    return included;
  };
  const copiedIntoImage = relative => {
    const candidate = normalized(relative);
    return copiedContextSources.some(source => candidate === source || candidate.startsWith(`${source}/`));
  };
  for (const relative of fixtures) {
    assert.equal(includedByContextPolicy(relative), false, `${relative} must be absent from the Docker context`);
    assert.equal(copiedIntoImage(relative), false, `${relative} must be unreachable from the image COPY allowlist`);
  }
  assert.equal(includedByContextPolicy('public/demo/static.txt'), true, 'reviewed immutable public assets remain available');
  assert.equal(copiedIntoImage('public/demo/static.txt'), true, 'reviewed immutable public assets are copied explicitly');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

for (const asset of ['public/brand-logo.png']) {
  assert.equal(fs.existsSync(new URL(`../${asset}`, import.meta.url)), true, `${asset} must exist in the build context`);
}

console.log('container reproducibility contract passed');
