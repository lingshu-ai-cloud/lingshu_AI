import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editor = readFileSync(new URL('./WeeklyMatrixEditor.tsx', import.meta.url), 'utf8');
const matrix = readFileSync(new URL('../lib/weeklyMatrix.ts', import.meta.url), 'utf8');
const presets = readFileSync(new URL('../lib/weeklyTaskPackagePresets.ts', import.meta.url), 'utf8');
const decisions = readFileSync(new URL('../lib/directorDecision.ts', import.meta.url), 'utf8');

assert.match(editor, /addContent[\s\S]{0,500}route:\s*'clone'/, 'new matrix cards must start as viral replication');
assert.doesNotMatch(editor, /创作路径<select/, 'Agent matrix must not expose a route selector');
assert.match(editor, /历史任务：[^`]+（只读）/, 'legacy non-clone cards must remain visible and explicitly read-only');
for (const source of [matrix, presets, decisions]) assert.doesNotMatch(source, /route:\s*'product'/, 'Agent-created defaults must not use free creation');
console.log('WeeklyMatrixEditor clone-only contract tests passed');
