import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/build-release-images.yml', import.meta.url), 'utf8');

test('build verification covers pull requests without restricting integration branches', () => {
  assert.match(workflow, /^  pull_request:\s*$/m);
  assert.doesNotMatch(workflow, /^  pull_request:\n\s+branches:/m);
  assert.match(workflow, /name: Verify source/);
  assert.match(workflow, /ARCHITECTURE_BASE_REF: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.base\.sha \|\| github\.sha \}\}/);
  assert.match(workflow, /MIGRATION_BASE_REF: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.base\.sha \|\| github\.sha \}\}/);
});

test('pull requests run governance and production build but never image publish or smoke jobs', () => {
  assert.match(workflow, /pnpm run check:architecture/);
  assert.match(workflow, /pnpm run test:architecture-ratchet/);
  assert.match(workflow, /pnpm run check:digital-employee-migrations/);
  assert.match(workflow, /pnpm run test:migration-guard/);
  assert.match(workflow, /pnpm run test:social-image-pipeline/);
  assert.match(workflow, /pnpm run test:translation-cues/);
  assert.match(workflow, /pnpm run build/);
  assert.equal((workflow.match(/if: github\.event_name != 'pull_request'/g) || []).length, 2);
});
