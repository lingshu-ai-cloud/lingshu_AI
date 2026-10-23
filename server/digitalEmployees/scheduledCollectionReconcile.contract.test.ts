import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../routes/digitalEmployees.ts', import.meta.url), 'utf8');

assert.match(source, /!mustReobserveSucceededCollection\(task\.task_key, task\.status\)/,
  'a succeeded scheduled collection must bypass the generic terminal-task skip and be observed again');
assert.match(source, /if \(!dependencyStateReady\)[\s\S]{0,800}\['waiting_external', 'waiting_human', 'waiting_approval'\]\.includes\(task\.status\)[\s\S]{0,800}status: 'pending'/,
  'a stale downstream wait must return to dependency-pending after its upstream proof regresses');

console.log('scheduled collection reconcile contract tests passed');
