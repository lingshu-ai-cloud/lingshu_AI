const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const mod = { exports: {} }
vm.runInNewContext(fs.readFileSync(__dirname + '/lib/assistant.js', 'utf8'), { module: mod, setTimeout, clearTimeout, require: id => { assert.equal(id, './request-policy'); const policy = { exports: {} }; vm.runInNewContext(fs.readFileSync(__dirname + '/lib/request-policy.js', 'utf8'), { module: policy }); return policy.exports } })
const { createAssistantController } = mod.exports
function fixture(extra) {
  const calls = [], stored = new Map()
  const request = async (path, method, body) => {
    calls.push({ path, method, body })
    if (extra) { const value = await extra(path, method, body); if (value !== undefined) return value }
    if (path.endsWith('/context')) return { quickQuestions: [{ id: 'risk', text: '哪些任务需要我介入？' }] }
    if (path.endsWith('/sessions')) return { sessions: [{ id: 'session-1' }] }
    if (path.endsWith('/commands')) return { ok: true }
    if (path.endsWith('/messages')) return { messages: [{ id: 'server-message', role: 'assistant', content: '真实会话' }] }
    if (path.endsWith('/query')) return { text: '建议重试', evidence: [{ id: 'task-1' }], links: [{ kind: 'retry_task' }] }
    if (path.endsWith('/preview')) return { previewId: 'preview-1', confirmation: { body: { kind: 'retry_task', targetId: 'task-1', expectedVersion: '7', payload: {} } } }
    if (path.endsWith('/actions')) return { receipt: { id: 'receipt-1', status: 'accepted' } }
    if (path.includes('/actions/')) return { receipt: { id: 'receipt-1', status: 'running' } }
    throw new Error(path)
  }
  const controller = createAssistantController({ request, storage: { get: key => stored.get(key), set: (key, value) => stored.set(key, JSON.parse(JSON.stringify(value))) }, schedule: () => 1, cancel: () => {} })
  return { controller, calls, stored }
}
test('restores server conversation; query never executes a suggested action', async () => {
  const { controller, calls } = fixture()
  await controller.restore('tenant:user')
  await controller.send('重试一下')
  assert.equal(controller.getState().messages[0].id, 'server-message')
  assert.equal(controller.getState().evidence[0].id, 'task-1')
  assert.equal(calls.some(call => call.path.endsWith('/actions')), false)
  controller.dispose()
})
test('requires visible preview; uncertain submission reuses idempotency key', async () => {
  let attempts = 0
  const { controller, calls } = fixture(path => { if (path.endsWith('/actions') && ++attempts === 1) throw new Error('断网') })
  await controller.restore('tenant:user')
  await assert.rejects(controller.confirm('preview-1'), /先查看/)
  await controller.preview({ kind: 'retry_task' })
  await assert.rejects(controller.confirm('preview-1'), /断网/)
  await controller.confirm('preview-1')
  const submissions = calls.filter(call => call.path.endsWith('/actions'))
  assert.equal(submissions[0].body.idempotencyKey, submissions[1].body.idempotencyKey)
  assert.equal(controller.getState().receipts[0].status, 'running')
  assert.equal(controller.getState().preview, null)
  controller.dispose()
})
test('voice is editable draft and failure preserves draft without sending', async () => {
  const { controller, calls } = fixture()
  controller.voiceDraft('帮我查看进度')
  controller.voiceFailure(new Error('麦克风未授权'))
  assert.equal(controller.getState().input, '帮我查看进度')
  assert.equal(calls.length, 0)
})
test('assistant pages use mutually exclusive text and hold-to-talk modes without redundant avatar or sync button', () => {
  const workbench = fs.readFileSync(__dirname + '/pages/workbench/index.wxml', 'utf8')
  const assistant = fs.readFileSync(__dirname + '/packages/operator/assistant/index.wxml', 'utf8')
  for (const markup of [workbench, assistant]) {
    assert.match(markup, /bindtap="switch(?:Input|Composer)Mode"/)
    assert.match(markup, /bindtouchstart="holdVoiceStart"/)
    assert.match(markup, /bindtouchmove="holdVoiceMove"/)
    assert.match(markup, /bindtouchend="holdVoiceEnd"/)
    assert.match(markup, /按住说话|长按问灵小枢/)
    assert.doesNotMatch(markup, /assistant-avatar|class="avatar">枢|同步对话/)
  }
})
test('operator assistant keeps suggested questions collapsed on the empty conversation', () => {
  const markup = fs.readFileSync(__dirname + '/packages/operator/assistant/index.wxml', 'utf8')
  const script = fs.readFileSync(__dirname + '/packages/operator/assistant/index.js', 'utf8')
  const styles = fs.readFileSync(__dirname + '/packages/operator/assistant/index.wxss', 'utf8')
  assert.match(markup, /wx:if="{{showSuggestions}}" class="suggestions"/)
  assert.match(markup, /bindtap="toggleSuggestions"/)
  assert.match(script, /showSuggestions: false/)
  assert.match(styles, /\.voice-prompt\{[^}]*box-shadow:/)
})

test('operator assistant opens in voice mode with the dispatch prompt above two-tab navigation', () => {
  const markup = fs.readFileSync(__dirname + '/packages/operator/assistant/index.wxml', 'utf8')
  const script = fs.readFileSync(__dirname + '/packages/operator/assistant/index.js', 'utf8')
  assert.match(script, /inputMode: 'voice'/)
  assert.match(markup, /长按问灵小枢/)
  assert.match(markup, /可按住提问或者派活/)
})
test('operator assistant recovers denied microphone permission without leaving a page-level error', async () => {
  let definition, modal, opened = 0
  const wx = {
    getSetting: options => options.success({ authSetting: { 'scope.record': false } }),
    showModal: options => { modal = options },
    openSetting: options => { opened++; options.success({ authSetting: { 'scope.record': true } }) }
  }
  vm.runInNewContext(fs.readFileSync(__dirname + '/packages/operator/assistant/index.js', 'utf8'), {
    Page: value => { definition = value },
    require: id => id.endsWith('/api') ? {} : { createAssistantController() {} },
    wx
  })
  const page = { ...definition, data: { ...definition.data, error: '未获得麦克风权限' }, setData(patch) { Object.assign(this.data, patch) } }
  const pending = page.ensureRecordPermission()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(opened, 0)
  modal.success({ confirm: true })
  assert.equal(await pending, true)
  assert.equal(opened, 1)
  assert.equal(page.data.error, '')
})
test('late response cannot contaminate a new account', async () => {
  let finish
  const { controller } = fixture(path => path.endsWith('/query') ? new Promise(resolve => { finish = resolve }) : undefined)
  await controller.restore('tenant-a:user')
  const sending = controller.send('旧企业的问题')
  await controller.restore('tenant-b:user')
  finish({ answer: '旧企业结果', evidence: [{ id: 'secret' }] })
  await sending
  assert.equal(controller.getState().evidence.length, 0)
  assert.equal(controller.getState().sending, false)
  controller.dispose()
})

test('conversation linkage failure preserves accepted receipt without resubmission', async () => {
  const { controller, calls, stored } = fixture(path => { if (path.endsWith('/commands')) throw new Error('同步失败') })
  await controller.restore('tenant:user')
  await controller.preview({ kind: 'retry_task' })
  await controller.confirm('preview-1')
  assert.equal(controller.getState().receipts[0].id, 'receipt-1')
  assert.match(controller.getState().error, /指令已受理/)
  assert.equal(stored.get('mobile-assistant-pending:tenant:user').receiptIds[0], 'receipt-1')
  assert.equal(calls.filter(call => call.path.endsWith('/actions')).length, 1)
  controller.dispose()
})
