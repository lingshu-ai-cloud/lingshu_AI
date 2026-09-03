import assert from 'node:assert/strict';
import { isDigitalEmployeePostStats } from './postMutationPolicy.js';

assert.equal(isDigitalEmployeePostStats({ source: 'digital_employee' }), true);
assert.equal(isDigitalEmployeePostStats('{"source":"digital_employee"}'), true);
assert.equal(isDigitalEmployeePostStats({ source: 'manual' }), false);
assert.equal(isDigitalEmployeePostStats('{invalid'), false);
assert.equal(isDigitalEmployeePostStats(null), false);

console.log('digital employee calendar mutation policy tests passed');
