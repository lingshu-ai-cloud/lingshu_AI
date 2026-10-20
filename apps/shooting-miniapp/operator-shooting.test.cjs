const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')

function loadNative(name) {
  const exports = {}
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/' + name), 'utf8'), { exports })
  return exports
}
function loadCommonJs(name) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/' + name), 'utf8'), { module, exports: module.exports, Date })
  return module.exports
}
const list = loadCommonJs('shootingList')
const workflow = loadNative('shootingWorkflow')
const taxonomy = loadNative('materialTaxonomy')

function pageWith(api, wx = {}) {
  let page
  const source = fs.readFileSync(require.resolve('./packages/operator/shooting/index'), 'utf8')
  vm.runInNewContext(source, { Page(value) { page = value }, require(name) {
    if (name.endsWith('/api')) return api
    if (name.endsWith('/shootingWorkflow')) return workflow
    if (name.endsWith('/materialTaxonomy')) return taxonomy
    if (name.endsWith('/shootingList')) return list
    throw new Error(name)
  }, wx })
  page.data = { ...page.data }
  page.setData = values => Object.assign(page.data, values)
  return page
}

test('my shooting groups tasks chronologically and keeps completed cards in place', () => {
  const tasks = [
    { id: 'late', title: '后天', dueAt: '2026-10-14T09:00:00+08:00', uploadedMaterialIds: [] },
    { id: 'done', title: '今天完成', dueAt: '2026-10-12T10:00:00+08:00', uploadedMaterialIds: ['m1'] },
    { id: 'todo', title: '今天待拍', dueAt: '2026-10-12T11:00:00+08:00', uploadedMaterialIds: [] },
  ]
  const groups = list.groupShootingTasks(tasks, '2026-10-12T08:00:00+08:00')
  assert.equal(groups[0].label, '今天')
  assert.equal(groups[0].tasks.map(item => item.id).join(','), 'done,todo')
  assert.equal(groups[0].tasks[0].uploadedMaterialIds[0], 'm1')
  assert.equal(groups[1].tasks[0].id, 'late')
})

test('reference preview requires exact project, shot assignment and video material', () => {
  const task = { sourceProjectId: 'project', sourceStoryboardSlotId: 'slot-1', sourceShotId: 'shot-1' }
  const project = { id: 'project', spec: {
    shootingSlots: [{ id: 'shot-1', slotId: 'slot-1' }],
    storyboardAssignments: { 'slot-1': 'video-1' },
    materialSnapshots: [{ id: 'video-1', type: 'video', url: '/video.mp4', poster: '/poster.jpg' }],
    clipEdits: { 'slot-1:video-1': { trimStart: 1.25, trimEnd: 4.5 } },
  } }
  assert.deepEqual(JSON.parse(JSON.stringify(list.referencePreview(task, project))), {
    materialId: 'video-1', url: '/video.mp4', poster: '/poster.jpg', start: 1.25, end: 4.5, rangeText: '1.3–4.5 秒',
  })
  assert.equal(list.referencePreview(task, { ...project, id: 'other' }), null)
  assert.equal(list.referencePreview(task, { ...project, spec: { ...project.spec, storyboardAssignments: { 'slot-1': 'missing' } } }), null)
  assert.deepEqual(JSON.parse(JSON.stringify(list.cardPreview(task, project))), {
    materialId: 'video-1', url: '/video.mp4', poster: '/poster.jpg', start: 1.25, end: 4.25, rangeText: '前三秒预览',
  })
})

test('shooting detail resolves signed reference assets from the project projection', async () => {
  const task = { id: 'task', sourceProjectId: 'project', sourceStoryboardSlotId: 'slot-1', sourceShotId: 'shot-1', uploadedMaterialIds: [] }
  const api = {
    studioProject: async () => ({ id: 'project', spec: { shootingSlots: [{ id: 'shot-1', slotId: 'slot-1' }], storyboardAssignments: { 'slot-1': 'video' }, materialSnapshots: [{ id: 'video', type: 'video', url: '/media/video.mp4', poster: '/media/poster.jpg' }], clipEdits: {} } }),
    assetUrl: value => 'https://local.test' + value,
  }
  const page = pageWith(api)
  page.data.tasks = [task]
  await page.selectTask({ currentTarget: { dataset: { id: 'task' } } })
  assert.equal(page.data.referencePreview.url, 'https://local.test/media/video.mp4')
  assert.equal(page.data.referencePreview.poster, 'https://local.test/media/poster.jpg')
})

test('reference playback stops at the assigned trim end and returns to its start', () => {
  const calls = []
  const page = pageWith({}, { createVideoContext() { return { pause() { calls.push('pause') }, seek(value) { calls.push('seek:' + value) } } } })
  page.data.referencePreview = { start: 1.25, end: 4.5 }
  page.referenceTimeUpdate({ detail: { currentTime: 4.49 } })
  assert.equal(calls.length, 0)
  page.referenceTimeUpdate({ detail: { currentTime: 4.5 } })
  assert.equal(calls.join(','), 'pause,seek:1.25')
})

test('operator shooting presents pending totals and never exposes task creation', () => {
  const page = pageWith({})
  const state = page.present([
    { id: 'done', uploadedMaterialIds: ['material'] },
    { id: 'todo', uploadedMaterialIds: [] },
  ])
  assert.equal(state.pendingCount, 1)
  assert.equal(state.completedCount, 1)
  assert.equal(state.taskGroups[0].tasks.length, 2)
  const source = fs.readFileSync(require.resolve('./packages/operator/shooting/index'), 'utf8')
  const markup = fs.readFileSync(require.resolve('./packages/operator/shooting/index.wxml'), 'utf8')
  assert.doesNotMatch(source, /createTask|create-form|api\.products/)
  assert.doesNotMatch(markup, /我要创建|全部任务|已上传[^素]/)
  assert.match(markup, /shot-media[\s\S]*分镜/)
  assert.match(markup, /收音要求/)
  assert.match(markup, /factory-benchmark-frame\.jpg/)
  assert.match(markup, /工厂镜头构图参考/)
  assert.match(markup, /预览 3 秒/)
  assert.match(markup, /bindtimeupdate="cardPreviewTimeUpdate"/)
})

test('shooting cards load signed previews and stop after three seconds', async () => {
  const calls = []
  const api = {
    studioProject: async () => ({ id: 'project', spec: { shootingSlots: [{ id: 'shot', slotId: 'slot' }], storyboardAssignments: { slot: 'video' }, materialSnapshots: [{ id: 'video', type: 'video', url: '/video.mp4', poster: '/poster.jpg' }], clipEdits: {} } }),
    assetUrl: value => 'https://local.test' + value,
  }
  const page = pageWith(api, { createVideoContext(id) { return { pause() { calls.push('pause:' + id) }, seek(value) { calls.push('seek:' + value) } } } })
  const tasks = await page.loadCardPreviews([{ id: 'task', sourceProjectId: 'project', sourceStoryboardSlotId: 'slot', sourceShotId: 'shot', uploadedMaterialIds: [] }])
  assert.equal(tasks[0].cardPreview.url, 'https://local.test/video.mp4')
  assert.equal(tasks[0].cardPreview.end, 3)
  page.cardPreviewTimeUpdate({ currentTarget: { dataset: { player: tasks[0].previewPlayerId, start: 0, end: 3 } }, detail: { currentTime: 3 } })
  assert.deepEqual(calls, ['pause:shot-preview-task', 'seek:0'])
})

test('uploaded material completes the selected task and keeps recovery state on attach failure', async () => {
  let attached = false
  const api = {
    uploadVideo: async (_file, progress) => { progress(100); return { id: 'material', sourceType: 'local-upload', primaryTheme: 'product' } },
    attach: async () => { if (!attached) throw new Error('关联失败') },
    tasks: async () => [{ id: 'task', uploadedMaterialIds: attached ? ['material'] : [] }],
  }
  const page = pageWith(api)
  page.data.selected = { id: 'task', uploadedMaterialIds: [] }
  await page.submit({ size: 100, tempFilePath: 'video.mp4' })
  assert.equal(page.data.pendingMaterialId, 'material')
  assert.match(page.data.message, /关联失败/)
  attached = true
  await page.retryAttach()
  assert.equal(page.data.pendingMaterialId, '')
  assert.equal(page.data.selected.done, true)
  assert.equal(page.data.completedCount, 1)
})

test('task deep link can open guided camera immediately', async () => {
  let cameraUrl
  const api = { token: () => '', tasks: async () => [{ id: 'shoot', uploadedMaterialIds: [] }] }
  const page = pageWith(api, { navigateTo(options) { cameraUrl = options.url } })
  page.onLoad({ taskId: 'shoot', autoShoot: '1' })
  await page.refresh()
  assert.equal(page.data.selected.id, 'shoot')
  assert.equal(cameraUrl, '/packages/operator/camera/index?taskId=shoot')
})
