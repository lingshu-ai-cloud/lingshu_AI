const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs'); const vm = require('node:vm'); const path = require('node:path');
function load(file) {const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,file),'utf8'),{module, Date, require:id=>load('lib/'+id.replace('./','')+'.js')});return module.exports;}
const {taskView} = load('lib/workbench.js');
test('native task view consumes shared status with server supplied blocker and next', () => {
  const view = taskView({id:'t', status:'waiting_external', blocked_reason:'等待真实回写', next:'核对平台回执'});
  assert.equal(view.statusLabel,'等待业务结果');
  assert.equal(view.execution.blocker,'等待真实回写');
  assert.equal(view.execution.next,'核对平台回执');
  assert.equal(view.next,'核对平台回执');
  assert.equal(taskView({status:'unexpected'}).statusLabel,'状态待确认');
});
