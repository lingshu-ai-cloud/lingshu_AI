import assert from 'node:assert/strict';
import { AbortableSemaphore } from './abortableSemaphore.js';

const semaphore = new AbortableSemaphore(2);
const releaseOne = await semaphore.acquire();
const releaseTwo = await semaphore.acquire();
assert.equal(semaphore.activeCount, 2);

let thirdAdmitted = false;
const third = semaphore.acquire().then(release => {
  thirdAdmitted = true;
  return release;
});
await Promise.resolve();
assert.equal(thirdAdmitted, false);
assert.equal(semaphore.queuedCount, 1);
releaseOne();
const releaseThree = await third;
assert.equal(thirdAdmitted, true);
assert.equal(semaphore.activeCount, 2);

const cancelled = new AbortController();
const queued = semaphore.acquire(cancelled.signal);
cancelled.abort(new Error('caller left'));
await assert.rejects(queued, /caller left/);
assert.equal(semaphore.queuedCount, 0);

releaseTwo();
releaseThree();
assert.equal(semaphore.activeCount, 0);
console.log('abortable semaphore tests passed');
