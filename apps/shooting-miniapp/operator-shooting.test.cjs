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
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/' + name), 'utf8'), { module, exports: module.exports, Date, require: id => {
    assert.equal(id, './shootingReference'); return loadNative('shootingReference')
  } })
  return module.exports
}
const list = loadCommonJs('shootingList')
const workflow = loadNative('shootingWorkflow')
const taxonomy = loadNative('materialTaxonomy')

function pageWith(api, wx = {}, timers = { setTimeout, clearTimeout }) {
  api = { request: async () => ({url:'/media/cropped.mp4',poster:'',physicalClip:true,start:0,end:3.5,sourceStart:12.5,sourceEnd:16}), ...api }
  let page
  const source = fs.readFileSync(require.resolve('./packages/operator/shooting/index'), 'utf8')
  vm.runInNewContext(source, { Page(value) { page = value }, require(name) {
    if (name.endsWith('/api')) return api
    if (name.endsWith('/shootingWorkflow')) return workflow
    if (name.endsWith('/materialTaxonomy')) return taxonomy
    if (name.endsWith('/shootingList')) return list
    throw new Error(name)
  }, wx, ...timers })
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
    materialId: 'video-1', url: '/video.mp4', poster: '/poster.jpg', start: 1.25, end: 4.25, rangeText: '前三秒预览', sourceLabel: '已分配参考素材', description: '',
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
  assert.equal(state.visibleTaskGroups[0].tasks.length, 2)
  assert.deepEqual(Array.from(state.taskFilters, item => item.label), ['全部', '待拍', '已完成'])
  assert.equal(state.tasks[0].assigneeLabel, '待分配')
  const source = fs.readFileSync(require.resolve('./packages/operator/shooting/index'), 'utf8')
  const markup = fs.readFileSync(require.resolve('./packages/operator/shooting/index.wxml'), 'utf8')
  assert.doesNotMatch(source, /createTask|create-form|api\.products/)
  assert.doesNotMatch(markup, /我要创建|全部任务|已上传[^素]/)
  assert.match(markup, /shot-media[\s\S]*分镜/)
  assert.match(markup, /收音要求/)
  assert.doesNotMatch(markup, /factory-benchmark-frame\.jpg/)
  assert.match(markup, /暂无可用的对标分镜/)
  assert.match(markup, /最多 3 秒/)
  assert.ok(markup.indexOf('surface reference-panel') < markup.indexOf('surface detail-guidance'))
  assert.match(markup, /object-fit="contain"/)
  assert.match(markup, /bindtimeupdate="cardPreviewTimeUpdate"/)
  assert.match(markup, /class="shoot-grid"/)
  assert.match(markup, /负责人/)
  assert.match(markup, /bindtap="selectTaskFilter"/)
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

function benchmarkFixture() {
  return {
    task: { id: 'task', sourceProjectId: 'project', sourceShotId: 'durable-1', sourceStoryboardSlotId: 'slot-1', requirements: 'factory-v1', uploadedMaterialIds: [] },
    project: { id: 'project', spec: {
      shootingSlots: [{ id: 'durable-1', slotId: 'slot-1', requirements: 'factory-v1' }],
      analysisResults: { storyboard: { slots: [{ id: 'slot-1', sourceShotId: 'factory' }] } },
      storyboardAssignments: {},
      videoKickoff: { video: { videoUrl: '/benchmark.mp4', thumbnail: '/cover.jpg', aiAnalysis: { materialUrl: '/cached-benchmark.mp4' } },
        referenceAnalysis: { details: [{ shotId: 'replication-factory', time: '12.5–16.0s', visual: '工厂生产线推进镜头' }] } }
    } }
  }
}

test('unassigned factory shot resolves the exact benchmark segment instead of production materials', () => {
  const { task, project } = benchmarkFixture()
  const preview = list.benchmarkPreview(task, project)
  assert.equal(preview.url, '/cached-benchmark.mp4')
  assert.equal(preview.start, 12.5)
  assert.equal(preview.end, 16)
  assert.equal(preview.description, '工厂生产线推进镜头')
  assert.equal(preview.sourceLabel, '对标分镜')
  assert.equal(list.cardPreview(task, project).end, 15.5)
  project.spec.storyboardAssignments['slot-1'] = 'own-video'
  project.spec.materialSnapshots = [{ id: 'own-video', type: 'video', url: '/own.mp4' }]
  assert.equal(list.shootingPreview(task, project).url, '/cached-benchmark.mp4')
})

test('benchmark preview refuses foreign, stale, ambiguous and invalid shot evidence', () => {
  const mutations = [
    p => { p.id = 'other-project' },
    p => { p.spec.shootingSlots[0].id = 'other-shot' },
    p => { p.spec.shootingSlots[0].slotId = 'other-slot' },
    p => { p.spec.shootingSlots[0].requirements = 'factory-v2' },
    p => { p.spec.analysisResults.storyboard.slots[0].sourceShotId = 'unmatched' },
    p => { p.spec.analysisResults.storyboard.slots.push({ ...p.spec.analysisResults.storyboard.slots[0] }) },
    p => { p.spec.videoKickoff.referenceAnalysis.details.push({ ...p.spec.videoKickoff.referenceAnalysis.details[0] }) },
    p => { p.spec.videoKickoff.referenceAnalysis.details[0].time = '16–12s' },
    p => { p.spec.videoKickoff.referenceAnalysis.details[0].time = '无时间码' },
    p => { p.spec.videoKickoff.video = { videoUrl: 'javascript:bad' } },
    p => { p.spec.videoKickoff.video.contentFormat = 'image' },
  ]
  for (const mutate of mutations) {
    const { task, project } = benchmarkFixture()
    mutate(project)
    assert.equal(list.benchmarkPreview(task, project), null)
  }
})

test('saved source identities survive reordered reference details and retimed production slots', () => {
  const { task, project } = benchmarkFixture()
  project.spec.analysisResults.storyboard.slots[0] = { id: 'slot-1', start: 0, end: 2 }
  project.spec.socialSourceShotIds = ['factory']
  project.spec.videoKickoff.referenceAnalysis.details.unshift({ shotId: 'product', time: '0–3s' })
  assert.equal(list.benchmarkPreview(task, project).start, 12.5)
  project.spec.socialSourceShotIds = ['factory', 'product']
  assert.equal(list.benchmarkPreview(task, project), null)
})

test('task deep link shows the benchmark before explicitly opening the existing camera', async () => {
  const { task, project } = benchmarkFixture()
  const urls = []
  const api = { token: () => '', tasks: async () => [task], studioProject: async () => project, assetUrl: value => 'https://local.test' + value }
  const page = pageWith(api, { navigateTo: value => urls.push(value.url), createVideoContext: () => ({ pause() {} }) })
  page.onLoad({ taskId: task.id })
  await page.refresh()
  assert.equal(urls.length, 0)
  assert.equal(page.data.referencePreview.url, 'https://local.test/media/cropped.mp4')
  assert.equal(page.data.referencePreview.rangeText, '12.5–16.0 秒')
  page.shoot()
  assert.deepEqual(urls, ['/packages/operator/camera/index?taskId=task'])
})

test('reference read and playback failures can retry without blocking shooting', async () => {
  const { task, project } = benchmarkFixture()
  let unavailable = true
  const page = pageWith({ studioProject: async () => { if (unavailable) throw Error('offline'); return project }, assetUrl: v => v })
  page.data.tasks = [task]
  await page.selectTask({ currentTarget: { dataset: { id: task.id } } })
  assert.match(page.data.referenceError, /重试/)
  assert.equal(page.data.selected.id, task.id)
  assert.equal(page.canLeaveTask(), true)
  unavailable = false
  await page.retryReference()
  assert.equal(page.data.referenceError, '')
  assert.equal(page.data.referencePreview.start, 0)
  page.referencePlaybackError()
  assert.match(page.data.referenceError, /播放失败/)
  await page.retryReference()
  assert.equal(page.data.referenceError, '')
})

test('rapid shot changes cannot show a previous shot or leave the next preview unloaded', async () => {
  const { task, project } = benchmarkFixture()
  const pending = []
  const page = pageWith({ studioProject: () => new Promise(resolve => pending.push(resolve)), assetUrl: v => v })
  page.data.tasks = [task, { ...task, id: 'second' }]
  const first = page.selectTask({ currentTarget: { dataset: { id: 'task' } } })
  const second = page.selectTask({ currentTarget: { dataset: { id: 'second' } } })
  pending[0]({ ...project, id: 'wrong' }); await first
  assert.equal(page.data.referencePreview, null)
  assert.equal(page.data.referenceLoading, true)
  pending[1](project); await second
  assert.equal(page.data.referencePreview.start, 0)
  assert.equal(page.data.referenceLoading, false)
})

test('leaving the detail invalidates its pending reference result', async () => {
  const { task, project } = benchmarkFixture()
  let resolve
  const page = pageWith({ studioProject: () => new Promise(r => { resolve = r }), assetUrl: v => v })
  page.data.tasks = [task]
  const pending = page.selectTask({ currentTarget: { dataset: { id: 'task' } } })
  page.back()
  resolve(project); await pending
  assert.equal(page.data.selected, null)
  assert.equal(page.data.referencePreview, null)
  assert.equal(page.data.referenceLoading, false)
})

test('reference cannot play before the source shot and pauses on page hide', () => {
  const calls = []
  const page = pageWith({}, { createVideoContext: () => ({ pause: () => calls.push('pause'), seek: value => calls.push('seek:' + value) }) })
  page.data.referencePreview = { start: 12.5, end: 16 }
  page.referenceTimeUpdate({ detail: { currentTime: 0 } })
  page.onHide()
  assert.deepEqual(calls, ['seek:12.5', 'pause'])
})

test('stored benchmark requests a physical task clip and refreshes its signature', async () => {
  const { task, project } = benchmarkFixture()
  project.spec.videoKickoff.video.referenceRecordId = 'reference/1'
  delete project.spec.videoKickoff.video.videoUrl
  delete project.spec.videoKickoff.video.aiAnalysis
  const calls = []
  const page = pageWith({
    studioProject: async () => project,
    request: async (route, method) => { calls.push(route); assert.equal(method,'POST'); return { url: '/media/benchmark.mp4?signature=fresh',physicalClip:true,start:0,end:3.5,sourceStart:12.5,sourceEnd:16 } },
    assetUrl: value => 'https://local.test' + value
  })
  page.data.tasks = [task]
  await page.selectTask({ currentTarget: { dataset: { id: task.id } } })
  assert.equal(page.data.referencePreview.url, 'https://local.test/media/benchmark.mp4?signature=fresh')
  assert.deepEqual(calls, ['studio/shooting-tasks/task/reference-preview'])
  await page.retryReference()
  assert.equal(calls.length, 2)
})

test('a denied media read never falls back to an old unapproved playback URL', async () => {
  const { task, project } = benchmarkFixture()
  project.spec.videoKickoff.video.referenceRecordId = 'reference'
  const page = pageWith({ studioProject: async () => project, request: async () => { throw Error('403') }, assetUrl: value => value })
  page.data.tasks = [task]
  await page.selectTask({ currentTarget: { dataset: { id: task.id } } })
  assert.equal(page.data.referencePreview, null)
  assert.match(page.data.referenceError, /重试/)
})

test('frozen storyboard timeline identities take priority over compatibility snapshots', () => {
  const { task, project } = benchmarkFixture()
  project.spec.storyboardTimeline = [{ id: 'slot-1', sourceShotId: 'factory' }]
  project.spec.analysisResults.storyboard.slots[0].sourceShotId = 'outdated'
  assert.equal(list.benchmarkPreview(task, project).start, 12.5)
})

test('reference end uses the real media clock between coarse progress events and resets for replay', () => {
  const timers = new Map(), calls = []
  let next = 0
  const page = pageWith({}, { createVideoContext: () => ({ pause: () => calls.push('pause'), seek: value => calls.push('seek:' + value) }) }, {
    setTimeout: (fn, delay) => { timers.set(++next, { fn, delay }); return next }, clearTimeout: id => timers.delete(id)
  })
  page.data.referencePreview = { start: 23.77, end: 25.3 }
  page.referencePosition = 25.28
  page.referencePlay()
  assert.ok(Math.abs(timers.get(next).delay - 20) < 0.001)
  const callback = timers.get(next).fn
  timers.delete(next)
  callback()
  assert.deepEqual(calls, ['pause', 'seek:23.77'])
  assert.equal(page.referencePlaying, false)
  page.referencePlay()
  assert.ok(Math.abs(timers.get(next).delay - 1530) < 0.001)
  page.referenceWaiting()
  assert.equal(timers.size, 0)
  page.referenceTimeUpdate({ detail: { currentTime: 24 } })
  assert.ok(Math.abs(timers.get(next).delay - 1300) < 0.001)
  page.referencePause()
  assert.equal(page.referencePlaying, false)
  assert.equal(page.referenceEndTimer, null)
  assert.equal(timers.size, 0)
})

test('a pending reference end cannot affect another task after navigation', () => {
  let finish
  const calls = []
  const page = pageWith({}, { createVideoContext: () => ({ pause: () => calls.push('pause'), seek: value => calls.push(value) }) }, {
    setTimeout: fn => { finish = fn; return 1 }, clearTimeout() {}
  })
  page.referenceRequest = 1
  page.data.referencePreview = { start: 5, end: 8 }
  page.referencePlay()
  page.referenceRequest = 2
  page.data.referencePreview = { start: 12, end: 15 }
  finish()
  assert.deepEqual(calls, [])
})

test('a server-persisted reference previews without rereading or guessing the source project', async () => {
  const task = { id: 'real-created-task', sourceProjectId: 'project', sourceAssemblyId: 'assembly', sourceStoryboardSlotId: 'slot-15',
    sourceShotId: 'durable-shot', requirements: 'v1', uploadedMaterialIds: [],
    referenceClip: { schemaVersion: 'shooting-reference.v1', projectId: 'project', shotId: 'durable-shot', storyboardSlotId: 'slot-15',
      videoId: 'benchmark', referenceShotId: 'factory', startSeconds: 23.77, endSeconds: 25.3, description: '工厂灌装' } }
  const requests = []
  const page = pageWith({
    studioProject: async () => { throw Error('must not reread project') },
    request: async route => { requests.push(route); return { url: '/media/benchmark.mp4?fresh-signature',physicalClip:true,start:0,end:1.53,sourceStart:23.77,sourceEnd:25.3 } }, assetUrl: value => value
  })
  page.data.tasks = [task]
  await page.selectTask({ currentTarget: { dataset: { id: task.id } } })
  assert.equal(page.data.referencePreview.start, 0)
  assert.ok(Math.abs(page.data.referencePreview.end - 1.53) < 1e-8)
  assert.equal(page.data.referenceError, '')
  const cards = await page.loadCardPreviews([task])
  assert.equal(cards[0].cardPreview.start, 0)
  assert.deepEqual(requests, ['studio/shooting-tasks/real-created-task/reference-preview', 'studio/shooting-tasks/real-created-task/reference-preview'])
})

 test('physical clips use their natural end and replay from local zero without a boundary timer', () => {
  const calls=[]; let armed=0;
  const page=pageWith({}, {createVideoContext:()=>({pause:()=>calls.push('pause'),seek:t=>calls.push('seek:'+t)})},
    {setTimeout:()=>{armed++;return 1},clearTimeout(){}});
  page.data.referencePreview={physicalClip:true,start:0,end:0.866667,rangeText:'5.1–6.0 秒'};
  page.referencePlay(); page.referenceTimeUpdate({detail:{currentTime:0.84}});
  assert.equal(armed,0); assert.equal(page.referencePlaying,true);
  page.resetReference(); assert.equal(page.referencePlaying,false); assert.equal(page.referencePosition,0);
  page.referencePlay(); assert.equal(armed,0); assert.equal(page.referencePlaying,true);
  assert.deepEqual(calls,['pause','seek:0']);
  const markup=fs.readFileSync(require.resolve('./packages/operator/shooting/index.wxml'),'utf8');
  assert.match(markup,/bindended="resetReference"/);
});
 test('a full-video or mismatched clip response cannot be played as a physical benchmark', async () => {
  const {task,project}=benchmarkFixture();
  for(const media of [{url:'/whole.mp4'}, {url:'/wrong.mp4',physicalClip:true,start:0,end:3,sourceStart:0,sourceEnd:3}]) {
    const page=pageWith({studioProject:async()=>project,request:async()=>media,assetUrl:v=>v});
    page.data.tasks=[task]; await page.selectTask({currentTarget:{dataset:{id:task.id}}});
    assert.equal(page.data.referencePreview,null); assert.match(page.data.referenceError,/重试/);
  }
});
