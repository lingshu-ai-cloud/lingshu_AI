import assert from 'node:assert/strict';
import { AsyncSerialGate } from './asyncSerialGate.js';

const gate = new AsyncSerialGate();
let active = 0;
let maxActive = 0;
const order: string[] = [];
const run = (id: string, delay: number) => gate.run(async () => {
  active += 1;
  maxActive = Math.max(maxActive, active);
  order.push(`start:${id}`);
  await new Promise(resolve => setTimeout(resolve, delay));
  order.push(`end:${id}`);
  active -= 1;
  return id;
});

assert.deepEqual(await Promise.all([run('a', 8), run('b', 1), run('c', 1)]), ['a', 'b', 'c']);
assert.equal(maxActive, 1);
assert.deepEqual(order, ['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);

await assert.rejects(() => gate.run(() => { throw new Error('expected'); }), /expected/);
assert.equal(await gate.run(() => 'still-open'), 'still-open', 'a rejected task must release the gate');

console.log('async serial gate tests passed');
