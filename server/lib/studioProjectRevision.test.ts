import assert from 'node:assert/strict';
import { studioProjectRevisionConflict } from './studioProjectRevision.js';

const current = '2026-09-28T22:24:13.295Z';
assert.equal(studioProjectRevisionConflict(current, current), false);
assert.equal(studioProjectRevisionConflict('2026-09-28T22:20:00.000Z', current), true);
assert.equal(studioProjectRevisionConflict('', current), true);
assert.equal(studioProjectRevisionConflict(undefined, current), true);
console.log('Studio project optimistic revision guard passed');
