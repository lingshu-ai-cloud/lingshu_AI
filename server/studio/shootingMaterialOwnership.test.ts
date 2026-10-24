import assert from 'node:assert/strict';
import test from 'node:test';
import { ownsShootingVideo } from './shootingMaterialOwnership.js';

test('new upload IDs resolve using owned cloud records instead of the legacy inventory', async () => {
  const calls: string[][] = [];
  const getOwned = async (id: string, tenant: string) => {
    calls.push([id, tenant]);
    return id === 'upload' && tenant === 'A' ? { type: 'video', usage: 'editable' } : null;
  };
  assert.equal(await ownsShootingVideo('pb-upload', 'A', () => [], getOwned), true);
  assert.equal(await ownsShootingVideo('pb-upload', 'B', () => [], getOwned), false);
  assert.deepEqual(calls, [['upload', 'A'], ['upload', 'B']]);
  for (const record of [null, {type:'image'}, {type:'video',usage:'reference_only'}]) {
    assert.equal(await ownsShootingVideo('pb-upload', 'A', () => [], async () => record), false);
  }
  await assert.rejects(ownsShootingVideo('pb-upload', 'A', () => [], async () => {throw Error('store unavailable');}));
});

test('legacy videos remain supported while shared and reference materials are rejected', async () => {
  for (const [record, expected] of [
    [{id:'old',tenantId:'A',type:'video'},true],
    [{id:'old',tenantId:'B',type:'video'},false],
    [{id:'old',tenantId:'A',type:'video',scope:'shared'},false],
    [{id:'old',tenantId:'A',type:'video',usage:'reference_only'},false],
    [{id:'old',tenantId:'A',type:'image'},false],
  ] as const) assert.equal(await ownsShootingVideo('old','A',()=>[record]), expected);
});
