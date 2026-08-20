import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createLinkedAbort } from './abort.js';

const timed = createLinkedAbort({ timeoutMs: 20, label: 'test request' });
await delay(30);
assert.equal(timed.signal.aborted, true);
assert.equal(timed.timedOut, true);
assert.match(String(timed.signal.reason), /test request timed out/);
timed.cleanup();

const parent = new AbortController();
const linked = createLinkedAbort({ timeoutMs: 5_000, parentSignal: parent.signal, label: 'linked request' });
parent.abort(new Error('client disconnected'));
assert.equal(linked.signal.aborted, true);
assert.equal(linked.timedOut, false);
assert.match(String(linked.signal.reason), /client disconnected/);
linked.cleanup();

const cleaned = createLinkedAbort({ timeoutMs: 10, label: 'cleaned request' });
cleaned.cleanup();
await delay(20);
assert.equal(cleaned.signal.aborted, false);

console.log('abort deadline tests passed');
