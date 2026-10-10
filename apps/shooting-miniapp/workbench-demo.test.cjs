const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function load(file, bindings={}) { const module={exports:{}}; vm.runInNewContext(fs.readFileSync(path.join(__dirname,file),'utf8'),{module,exports:module.exports,Date,console,...bindings}); return module.exports; }
const model = load('lib/workbench.js');
const demo = load('lib/workbench-demo.js',{require:()=>model});

test('demo projection covers overview, tasks, agents, calendar and actionable queue', () => {
  const data = demo.project(model.week(Date.parse('2026-10-10T04:00:00Z')));
  assert.equal(data.metrics.length, 5);
  assert.ok(data.tasks.length >= 5);
  assert.ok(data.agents.length >= 4);
  assert.ok(data.posts.length >= 3);
  assert.deepEqual(data.calendarItems, data.posts);
  assert.ok(data.matters.some(item => item.type === 'approval'));
  assert.ok(data.matters.some(item => item.type === 'task'));
  assert.ok(data.matters.some(item => item.type === 'shoot'));
  assert.equal(data.overview.inquiryDrilldown.items.length, 3);
});

test('demo queue keeps urgent work first and assistant answers from demo facts', () => {
  const data = demo.project(model.week());
  assert.match(data.matters[0].title, /封面/);
  assert.match(demo.answer('询盘怎么样'), /7 条/);
  assert.match(demo.answer('视频进度'), /128,600/);
});
