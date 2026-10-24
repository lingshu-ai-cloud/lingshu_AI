const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
function loadNative(name) {
  const exports = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/' + name), 'utf8'), { exports });
  return exports;
}
const workflow = loadNative('shootingWorkflow');
const taxonomy = loadNative('materialTaxonomy');

test('native modules execute without Node, browser or wx globals', () => {
  for (const name of ['materialTaxonomy', 'shootingWorkflow']) {
    const exports = {};
    vm.runInNewContext(fs.readFileSync(require.resolve('./lib/' + name), 'utf8'), { exports });
    assert.ok(Object.keys(exports).length > 0);
  }
});
test('material source compatibility and theme classification are available in native runtime', () => {
  assert.equal(taxonomy.materialSourceCategoryOf({ sourceProvider: 'seedance' }), 'user_generated');
  assert.equal(taxonomy.materialSourceCategoryOf({ scope: 'shared' }), 'official_import');
  assert.equal(taxonomy.materialSourceCategoryOf({ sourceType: 'local-upload' }), 'local_upload');
  assert.deepEqual(Array.from(taxonomy.materialThemeTagsOf({ name: '工厂产品特写' })), ['factory', 'product']);
  assert.deepEqual(Array.from(taxonomy.materialThemeTagsOf({ primaryTheme: 'talking_head', name: '工厂产品特写' })), ['talking_head']);
});
test('mobile never claims uploaded material has refilled a shot', () => {
  const incomplete = workflow.shootingTaskPresentation({ uploadedMaterialIds: ['material'], sourceShotId: 'shot' });
  assert.equal(incomplete.done, true);
  assert.match(incomplete.bindingText, /手动选用/);
  const bound = workflow.shootingTaskPresentation({ sourceProjectId: 'draft', sourceAssemblyId: 'assembly', sourceShotId: 'shot', requirements: 'same', uploadedMaterialIds: ['material'] });
  assert.match(bound.bindingText, /返回网页草稿后核对/);
  assert.match(bound.bindingText, /不覆盖/);
});
test('native refill preserves stable identity and refuses edited or occupied shots', () => {
  let id = 0;
  const source = [{ id: 'slot-1', detail: '设备', start: 0, end: 3 }, { id: 'slot-2', detail: '产品', start: 3, end: 6 }];
  const slots = workflow.reconcileShootingSlots([], source, 'A/zh/9:16', () => 'shot-' + ++id);
  const task = { sourceProjectId: 'draft', sourceAssemblyId: 'assembly', sourceShotId: slots[0].id, requirements: slots[0].requirements, uploadedMaterialIds: ['material'] };
  const context = { projectId: 'draft', assemblyId: 'assembly', slots, assignments: {}, confirmed: {} };
  const reordered = workflow.reconcileShootingSlots(slots, [{ ...source[1], id: 'slot-1' }, { ...source[0], id: 'slot-2' }], 'A/zh/9:16', () => 'shot-' + ++id);
  assert.equal(workflow.shootingRefillTarget(task, { ...context, slots: reordered }).slot.slotId, 'slot-2');
  for (const next of [{ ...context, assignments: { 'slot-1': 'existing' } }, { ...context, confirmed: { 'slot-1': true } }, { ...context, assemblyId: 'new-version' }, { ...context, slots: [{ ...slots[0], requirements: 'changed' }] }]) assert.equal(workflow.shootingRefillTarget(task, next).slot, undefined);
});
test('shooting page uses shared presentation and taxonomy after upload', async () => {
  let page;
  const source = fs.readFileSync(require.resolve('./pages/index/index'), 'utf8');
  const task = { id: 'task', title: '产品', uploadedMaterialIds: [], suggestedDurationSec: 5, soundMode: 'source' };
  const calls = [];
  const api = {
    uploadVideo: async () => ({ id: 'material', sourceType: 'local-upload', primaryTheme: 'product' }),
    attach: async (...args) => calls.push(args),
  };
  vm.runInNewContext(source, { Page(value) { page = value; }, require(name) { return name.endsWith('/api') ? api : name.endsWith('/shootingWorkflow') ? workflow : taxonomy; }, wx: {} });
  page.data = { ...page.data, selected: task };
  page.setData = values => Object.assign(page.data, values);
  page.refresh = async () => {};
  assert.equal(page.displayTask(task).soundText, workflow.shootingTaskPresentation(task).soundText);
  await page.submit({ size: 100, tempFilePath: 'video.mp4' });
  assert.equal(page.data.uploadedMaterialSummary, '本地上传 · 产品实拍');
  assert.equal(page.data.pendingMaterialId, '');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'task');
  assert.equal(calls[0][1], 'material');
});
test('task deep link can select the requested shot and open the camera immediately', async () => {
  let page, chooseOptions;
  const task = { id: 'shot-1', title: '产品特写', uploadedMaterialIds: [] };
  const api = { token: () => 'token', me: async () => ({ user: {} }), tasks: async () => [task] };
  vm.runInNewContext(fs.readFileSync(require.resolve('./pages/index/index'), 'utf8'), { Page(value) { page = value; }, require(name) { return name.endsWith('/api') ? api : name.endsWith('/shootingWorkflow') ? workflow : taxonomy; }, wx: { chooseMedia(options) { chooseOptions = options; } } });
  page.data = { ...page.data };
  page.setData = values => Object.assign(page.data, values);
  page.onLoad({ taskId: 'shot-1', autoShoot: '1' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.selected.id, 'shot-1');
  assert.deepEqual(Array.from(chooseOptions.sourceType), ['camera']);
});
test('upload recovery blocks leaving until attached; logout clears completed upload state', async () => {
  let page, cleared = 0, attempts = 0, exitModal;
  const api = { clearToken() { cleared++; }, attach: async () => { attempts++; }, tasks: async () => [] };
  vm.runInNewContext(fs.readFileSync(require.resolve('./pages/index/index'), 'utf8'), { Page(value) { page = value; }, require(name) { return name.endsWith('/api') ? api : name.endsWith('/shootingWorkflow') ? workflow : taxonomy; }, wx: { showModal(options) { exitModal = options; } } });
  const task = { id: 'task', uploadedMaterialIds: [] };
  page.data = { ...page.data, loggedIn: true, selected: task, pendingMaterialId: 'material', uploadedMaterialSummary: '本地上传' };
  page.setData = values => Object.assign(page.data, values);
  page.signOut();
  assert.match(exitModal.content, /不会删除素材/);
  exitModal.success({ confirm: false });
  page.back(); page.setFilter({ currentTarget: { dataset: { filter: 'all' } } });
  page.selectTask({ currentTarget: { dataset: { id: 'other' } } });
  assert.equal(cleared, 0);
  assert.equal(page.data.selected.id, 'task');
  assert.equal(page.data.pendingMaterialId, 'material');
  assert.match(page.data.message, /重试关联/);
  await page.refresh();
  assert.equal(page.data.selected.id, 'task');
  await page.retryAttach();
  assert.equal(attempts, 1);
  assert.equal(page.data.pendingMaterialId, '');
  page.data.busy = true;
  page.signOut();
  assert.equal(cleared, 0);
  page.data.busy = false;
  page.signOut();
  assert.equal(cleared, 1);
  assert.equal(page.data.uploadedMaterialSummary, '');
  assert.equal(page.data.pendingMaterialId, '');
  page.data = { ...page.data, loggedIn: true, selected: task, pendingMaterialId: 'orphan', uploadedMaterialSummary: '本地上传' };
  page.signOut();
  assert.equal(cleared, 1);
  exitModal.success({ confirm: true });
  assert.equal(cleared, 2);
  assert.equal(page.data.pendingMaterialId, '');
  assert.equal(page.data.uploadedMaterialSummary, '');
  assert.equal(page.data.loggedIn, false);
});
