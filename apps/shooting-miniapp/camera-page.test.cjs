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

test('camera uses one 9:16 capture stage for camera, guidance and reusable FB/TK safe frame', () => {
  const markup = fs.readFileSync(require.resolve('./packages/operator/camera/index.wxml'), 'utf8')
  const cameraStyles = fs.readFileSync(require.resolve('./packages/operator/camera/index.wxss'), 'utf8')
  const frame = fs.readFileSync(require.resolve('./components/platform-safe-frame/index.wxml'), 'utf8')
  const frameStyles = fs.readFileSync(require.resolve('./components/platform-safe-frame/index.wxss'), 'utf8')
  assert.match(markup, /capture-stage[\s\S]*<camera[\s\S]*platform-safe-frame[\s\S]*requirement-card/)
  assert.match(cameraStyles, /\.capture-stage[^}]*height:\s*177\.7778vw/)
  assert.match(markup, /requirement-card/)
  assert.match(markup, /requirement-recording/)
  const pendingRequirementStyle = cameraStyles.match(/\.requirement-text\s*\{([^}]*)\}/)[1]
  const recordingRequirementStyle = cameraStyles.match(/\.requirement-recording \.requirement-text\s*\{([^}]*)\}/)[1]
  assert.doesNotMatch(pendingRequirementStyle, /max-height|overflow:\s*hidden/)
  assert.match(pendingRequirementStyle, /white-space:\s*normal/)
  assert.match(recordingRequirementStyle, /max-height:\s*60rpx/)
  assert.match(recordingRequirementStyle, /overflow:\s*hidden/)
  assert.match(markup, /platform-safe-frame/)
  assert.match(frame, /主体安全区/)
  assert.match(frame, /交互风险/)
  assert.match(frame, /文案 \/ CTA 风险/)
  assert.match(frame, /关注[\s\S]*推荐/)
  assert.match(frame, /创作者头像[\s\S]*tiktok-heart\.svg[\s\S]*comment-dots\.svg[\s\S]*bookmark\.svg[\s\S]*share-turn\.svg/)
  assert.match(frame, /facebook-like\.svg[\s\S]*comment-outline\.svg[\s\S]*share-turn\.svg[\s\S]*bookmark\.svg/)
  assert.match(frame, /Reels[\s\S]*相机/)
  assert.match(frame, /账号[\s\S]*关注[\s\S]*标题 \/ 配文[\s\S]*音乐/)
  assert.doesNotMatch(frame, /\d+[万千]/)
  assert.match(frameStyles, /\.social-rail[^}]*background:\s*transparent/)
  assert.match(frameStyles, /\.social-rail-tiktok[^}]*top:\s*46%/)
  assert.match(frameStyles, /\.preview-actions-facebook[^}]*top:\s*52%/)
  assert.match(frameStyles, /\.preview-actions[^}]*right:\s*4\.8%/)
  assert.match(frameStyles, /\.social-icon-image[^}]*opacity:\s*\.82/)
  assert.match(frameStyles, /\.profile-follow[^}]*background:\s*rgba\(254,44,85,\.82\)/)
  assert.match(frameStyles, /\.safe-layer-tiktok \.safe-outline[^}]*top:\s*12%[^}]*right:\s*15%[^}]*bottom:\s*22%[^}]*left:\s*6%/)
  assert.match(frameStyles, /\.safe-layer-facebook \.safe-outline[^}]*top:\s*13%[^}]*right:\s*13%[^}]*bottom:\s*22%[^}]*left:\s*6%/)
  assert.match(frameStyles, /\.safe-layer-tiktok[\s\S]*\.risk-right/)
  assert.match(frameStyles, /\.safe-layer-facebook[\s\S]*\.risk-top/)
  assert.match(frameStyles, /\.safe-layer-recording \.publish-preview[^}]*opacity:\s*\.46/)
  assert.match(cameraStyles, /\.round-action[^}]*width:\s*88rpx[^}]*height:\s*88rpx/)
  assert.match(cameraStyles, /\.side-action, \.time[^}]*min-height:\s*88rpx/)
})
