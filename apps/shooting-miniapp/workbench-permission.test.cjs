const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function load(file, bindings = {}) { const module = { exports: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), { module, Date, ...bindings }); return module.exports; }
const model = load('lib/workbench.js');
function page(wx = {}) { let definition; load('pages/workbench/index.js', { Page: value => definition = value, require: id => id.endsWith('workbench') ? model : id.endsWith('starter') ? load('lib/starter.js', { require: () => model }) : {}, wx: { getStorageSync: () => [], ...wx }, setInterval: () => 1, clearInterval: () => {} }); return { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } }; }
test('denied recorder permission keeps text fallback and opens settings only after user choice', async () => {
  let modal; let opened = 0; let recorder = 0;
  const p = page({ getSetting: options => options.success({ authSetting: { 'scope.record': false } }), showModal: options => modal = options, openSetting: () => opened++, getRecorderManager: () => recorder++ });
  await p.toggleVoice();
  assert.equal(recorder, 0);
  assert.match(p.data.error, /文字输入/);
  assert.equal(opened, 0);
  modal.success({ confirm: true });
  assert.equal(opened, 1);
});
test('first voice use requests recorder permission before starting', async () => {
  let scope = ''; let starts = 0;
  const manager = { onStart() {}, onError() {}, onStop() {}, start() { starts++; } };
  const p = page({ getSetting: options => options.success({ authSetting: {} }), authorize: options => { scope = options.scope; options.success(); }, getRecorderManager: () => manager });
  await p.toggleVoice();
  assert.equal(scope, 'scope.record');
  assert.equal(starts, 1);
});
