const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')

function loadPage(api, wx) {
  let page
  const workflow = {}
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/shootingWorkflow'), 'utf8'), { exports: workflow })
  vm.runInNewContext(fs.readFileSync(require.resolve('./packages/operator/camera/index'), 'utf8'), {
    Page(value) { page = value },
    require(name) { return name.endsWith('/api') ? api : workflow },
    wx,
    setInterval,
    clearInterval,
    setTimeout(fn) { fn() }
  })
  page.data = { ...page.data }
  page.setData = values => Object.assign(page.data, values)
  return page
}

test('guided camera loads the selected task and keeps its shooting requirements', async () => {
  const page = loadPage({ tasks: async () => [{ id: 'shot-1', title: '产品近景', requirements: '镜头稳定，产品居中', suggestedDurationSec: 6 }] }, {})
  page.onLoad({ taskId: 'shot-1' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(page.data.task.id, 'shot-1')
  assert.match(page.data.task.shotBrief, /镜头稳定/)
  page.choosePlatform({ currentTarget: { dataset: { platform: 'facebook' } } })
  assert.equal(page.data.platform, 'facebook')
})

test('recorded video uses the existing material upload and task attachment flow', async () => {
  const calls = []
  const wx = {
    getFileInfo({ success }) { success({ size: 1024 }) },
    showToast() {},
    navigateBack() { calls.push('back') }
  }
  const api = {
    tasks: async () => [],
    uploadVideo: async file => { calls.push(file.tempFilePath); return { id: 'material-1' } },
    attach: async (taskId, materialId) => calls.push(taskId + ':' + materialId)
  }
  const page = loadPage(api, wx)
  page.taskId = 'shot-1'
  await page.finishRecord({ tempVideoPath: '/tmp/shot.mp4' })
  assert.deepEqual(calls, ['/tmp/shot.mp4', 'shot-1:material-1', 'back'])
  assert.equal(page.data.busy, false)
})

test('camera markup includes centered guidance and reusable FB/TK safe frame', () => {
  const markup = fs.readFileSync(require.resolve('./packages/operator/camera/index.wxml'), 'utf8')
  const frame = fs.readFileSync(require.resolve('./components/platform-safe-frame/index.wxml'), 'utf8')
  assert.match(markup, /requirement-card/)
  assert.match(markup, /platform-safe-frame/)
  assert.match(frame, /FB/)
  assert.match(frame, /TK/)
})
