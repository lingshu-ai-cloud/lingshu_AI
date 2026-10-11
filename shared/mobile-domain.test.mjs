import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as domain from './mobile-domain.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const moduleBox = {exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../apps/shooting-miniapp/lib/generated/mobile-domain.js'), 'utf8'), {module:moduleBox, Date});
const bundled = moduleBox.exports;
const normalize = value => JSON.parse(JSON.stringify(value));
test('Shanghai week crosses UTC date and year boundaries consistently on both clients', () => {
  const now = Date.parse('2025-12-28T16:01:00Z');
  assert.deepEqual(domain.week(now), normalize(bundled.week(now)));
  assert.equal(domain.week(now).start, '2025-12-29');
  assert.equal(domain.week(now).end, '2026-01-04');
  assert.equal(domain.week(now, -1).start, '2025-12-22');
  assert.equal(domain.day('2026-10-10T17:30:00Z'), '2026-10-11');
  assert.equal(domain.time('2026-10-10T17:30:00Z'), '01:30');
});
test('urgency uses overdue before priority without mutating response arrays', () => {
  const items = [{id:'later',priority:'critical',dueAt:'2026-10-12T00:00:00Z'}, {id:'overdue',priority:'low',dueAt:'2026-10-10T00:00:00Z'}, {id:'unknown',priority:'low',dueAt:'invalid'}];
  assert.deepEqual(domain.sortUrgency(items, Date.parse('2026-10-11T00:00:00Z')).map(x=>x.id), ['overdue','later','unknown']);
  assert.equal(items[0].id, 'later');
});
test('schedule preserves missing time and current node without fabricating a plan', () => {
  assert.equal(domain.timestamp('2026-10-11'), '10/11');
  assert.equal(domain.timestamp('invalid'), '');
  const groups = domain.buildAgentSchedule({availability:'available',items:[{taskId:'t',role:'content',status:'blocked',stage:'unknown_node'}]});
  assert.equal(groups[0].label, '内容 Agent');
  assert.equal(groups[0].items[0].timeLabel, '计划时间未提供');
  assert.equal(groups[0].items[0].stageLabel, '当前节点待同步');
  assert.deepEqual(groups, normalize(bundled.buildAgentSchedule({availability:'available',items:[{taskId:'t',role:'content',status:'blocked',stage:'unknown_node'}]})));
});
test('unavailable schedule does not expose stale assignments', () => {
  assert.deepEqual(domain.buildAgentSchedule({availability:'unavailable',items:[{taskId:'stale',role:'content'}]}, [{role:'content'}]), [{role:'content',label:'内容 Agent',unavailable:true,items:[]}]);
});
