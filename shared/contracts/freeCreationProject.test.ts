import assert from 'node:assert/strict';
import { freeCreationCompletionIssues, normalizeFreeCreationProjectSpec } from './freeCreationProject.js';

const draft = normalizeFreeCreationProjectSpec({ creationPath: 'free_creation', freeCreation: { hookSource: 'none', brief: { productIds: ['p1', 'p2'], goal: '询盘', audience: '采购经理', platform: 'tiktok', language: 'en' }, script: { status: 'confirmed', version: 2, lines: [{ id: 's1', start: 0, end: 3, narration: '', silent: true, shotType: 'factory', factReferences: ['kb:factory'], primaryHook: true }] } } });
assert.equal(draft.manualWorkflow, true);
assert.deepEqual(draft.freeCreation.brief.productIds, ['p1', 'p2']);
assert.equal(draft.freeCreation.script.lines[0].silent, true, 'silent shots are a supported first-class script line');
assert.deepEqual(freeCreationCompletionIssues(draft.freeCreation), []);

const d2c = normalizeFreeCreationProjectSpec({ creationPath: 'free_creation', freeCreation: { brief: draft.freeCreation.brief, script: { lines: [
  { id: 'd2c', start: 0, end: 3, narration: '', silent: true, shotType: 'consumer_demo', primaryHook: true },
  { id: 'legacy-usage', start: 3, end: 6, narration: '', silent: true, shotType: 'usage' },
  { id: 'legacy-general', start: 6, end: 9, narration: '', silent: true, shotType: 'general' },
] } } });
assert.deepEqual(d2c.freeCreation.script.lines.map((line: { shotType: string }) => line.shotType), ['consumer_demo', 'consumer_demo', 'consumer_demo']);

const changed = normalizeFreeCreationProjectSpec({ ...draft, freeCreation: { ...draft.freeCreation, brief: { ...draft.freeCreation.brief, productIds: ['p2'] } } }, draft);
assert.equal(changed.freeCreation.script.status, 'needs_update');
assert.match(changed.freeCreation.script.invalidatedReasons.join(','), /主推产品/);
console.log('free creation project contract tests passed');
