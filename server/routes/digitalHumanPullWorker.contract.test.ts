import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const studio = readFileSync(new URL('./studio.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../../scripts/digital-human-local-worker.ts', import.meta.url), 'utf8');

assert.match(studio, /digital-human\/worker\/claim/);
assert.match(studio, /workerLeaseUntil/);
assert.match(studio, /requireDigitalHumanWorker/);
assert.match(studio, /finalizeDigitalHumanBytes/);
assert.match(studio, /pullWorkerEnabled/);
assert.match(worker, /DIGITAL_HUMAN_HUB_URL/);
assert.match(worker, /DIGITAL_HUMAN_WORKER_KEY/);
assert.match(worker, /pollHub/);
assert.match(worker, /dataBase64/);
assert.match(worker, /vertical_composition/);

console.log('digital human pull-worker contract tests passed');
