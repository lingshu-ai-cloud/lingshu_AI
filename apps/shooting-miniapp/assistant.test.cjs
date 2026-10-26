const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const mod = { exports: {} }
vm.runInNewContext(fs.readFileSync(__dirname + '/lib/assistant.js', 'utf8'), { module: mod, setTimeout, clearTimeout, require: id => { assert.equal(id, './request-policy'); const policy = { exports: {} }; vm.runInNewContext(fs.readFileSync(__dirname + '/lib/request-policy.js', 'utf8'), { module: policy }); return policy.exports } })
const { createAssistantController } = mod.exports
function fixture(extra, options = {}) {
  const calls = [], stored = new Map()
  const request = async (path, method, body) => {
    calls.push({ path, method, body })
    if (extra) { const value = await extra(path, method, body); if (value !== undefined) return value }
    if (path.endsWith('/context')) return { quickQuestions: [{ id: 'risk', text: '哪些任务需要我介入？' }] }
    if (path.includes('/sessions?contextMode=')) return { sessions: [{ id: 'session-1' }] }
    if (path.endsWith('/commands')) return { ok: true }
    if (path.endsWith('/archive')) return { session: { id: 'session-1', archivedAt: '2026-10-16T10:00:00Z' } }
    if (path.endsWith('/messages')) return { messages: [{ id: 'server-message', role: 'assistant', content: '真实会话' }] }
    if (path.endsWith('/query')) return { text: '建议重试', evidence: [{ id: 'task-1' }], links: [{ kind: 'retry_task' }] }
    if (path.endsWith('/preview')) return { previewId: 'preview-1', confirmation: { body: { kind: 'retry_task', targetId: 'task-1', expectedVersion: '7', payload: {} } } }
    if (path.endsWith('/actions')) return { receipt: { id: 'receipt-1', status: 'accepted' } }
    if (path.includes('/actions/')) return { receipt: { id: 'receipt-1', status: 'running' } }
    throw new Error(path)
  }
  const controller = createAssistantController({ ...options, request, storage: { get: key => stored.get(key), set: (key, value) => stored.set(key, JSON.parse(JSON.stringify(value))) }, schedule: () => 1, cancel: () => {} })
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
test('restores the same authoritative content task card used by the web assistant', async () => {
  const currentContentTask = { availability:'available', card:{ contentTaskId:'content-1', cardVersion:'7', overallState:'needs_input', title:'单条海报', currentNode:{label:'核对生产条件',userFacingSummary:'任务已建立'}, knownItems:[], defaultedItems:[], blockingItems:[{key:'material',label:'待补充',value:'产品图片'}], progress:{mode:'none'}, nextAction:'supply_input', lastConfirmedAt:'2026-10-24T00:00:00Z' } }
  const { controller } = fixture(path => path.endsWith('/context') ? { quickQuestions:[], currentContentTask } : undefined)
  await controller.restore('tenant:user')
  assert.equal(controller.getState().contentTask.card.contentTaskId, 'content-1')
  assert.equal(controller.getState().contentTask.card.cardVersion, '7')
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
test('assistant sessions are edition scoped and can be archived and inspected', async () => {
  const { controller, calls } = fixture(path => path.includes('archived=all') ? { sessions: [{ id: 'history-1', archivedAt: '2026-10-16T10:00:00Z' }] } : undefined)
  await controller.restore('tenant:user:operator')
  assert.match(calls.find(call => call.path.includes('/sessions?'))?.path || '', /contextMode=operator/)
  assert.equal((await controller.listSessions())[0].id, 'history-1')
  await controller.archive()
  assert.equal(calls.some(call => call.path.endsWith('/session-1/archive')), true)
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
  assert.match(styles, /\.composer\{[^}]*box-shadow:/)
  assert.match(markup, /wx:if="{{contentTask}}" class="content-task-card"/)
  assert.match(script, /contentTaskView\(state\.contentTask\)/)
  assert.match(script, /packages\/operator\/content-task\/index\?taskId=/)
  assert.doesNotMatch(script, /contentTaskId=.*packages\/operator\/(?:shooting|review)/)
  const detail = fs.readFileSync(__dirname + '/packages/operator/content-task/index.js', 'utf8')
  assert.match(detail, /mobile-workbench\/assistant\/content-tasks\//)
  assert.match(detail, /result\.card\.contentTaskId !== this\.taskId/)
  assert.match(detail, /error\.status === 404/)
  assert.match(detail, /error\.status === 503/)
  assert.match(detail, /任务状态暂时无法读取，已保留当前页面/)
})

test('standalone assistant opens in text mode with shortcuts immediately above the composer', () => {
  const markup = fs.readFileSync(__dirname + '/packages/operator/assistant/index.wxml', 'utf8')
  const script = fs.readFileSync(__dirname + '/packages/operator/assistant/index.js', 'utf8')
  assert.match(script, /inputMode: 'text'/)
  assert.match(script, /freshSession: true/)
  assert.match(markup, /Hi 灵小枢/)
  assert.match(markup, /class="quick-cards"/)
  assert.ok(markup.indexOf('class="quick-cards"') < markup.indexOf('class="composer"'))
  assert.match(markup, /按住说话/)
  assert.match(markup, /bindtap="openSessions"/)
  assert.match(markup, /新对话/)
  assert.match(markup, /历史会话/)
  assert.doesNotMatch(script, /home\/index\?assistant=1/)
  assert.match(script, /duration:20000/)
  assert.doesNotMatch(script, /controller\?\.send\(text\)/)
})
test('operator assistant recovers denied microphone permission without leaving a page-level error', async () => {
  let definition, modal, opened = 0
  const wx = {
    getSetting: options => options.success({ authSetting: { 'scope.record': false } }),
    showModal: options => { modal = options },
    openSetting: options => { opened++; options.success({ authSetting: { 'scope.record': true } }) }
  }
  vm.runInNewContext(fs.readFileSync(__dirname + '/packages/operator/assistant/index.js', 'utf8'), {
    setTimeout: () => 1, clearTimeout() {},
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


test('fresh sheet opens without reading history or creating empty server sessions', async () => {
  const { controller, calls, stored } = fixture(undefined, { freshSession: true })
  stored.set('mobile-assistant-pending:tenant:user', { message: { text: 'old question', idempotencyKey: 'old-key' } })
  await controller.restore('tenant:user')
  assert.equal(controller.getState().messages.length, 0)
  assert.equal(controller.getState().sessionId, '')
  assert.equal(calls.some(call => call.path.includes('/sessions')), false)
  assert.equal(stored.get('mobile-assistant-pending:tenant:user').message, undefined)
  controller.dispose()
})

test('fresh sheet creates a new session only for its first send and retains that session within the visit', async () => {
  const { controller, calls } = fixture((path, method) => {
    if (path.endsWith('/sessions') && method === 'POST') return { session: { id: 'new-session' } }
    if (path.endsWith('/messages')) return { messages: [{ id: 'new-answer', text: 'new conversation' }] }
  }, { freshSession: true })
  await controller.restore('tenant:user')
  await controller.send('first question')
  await controller.send('follow-up')
  assert.equal(calls.filter(call => call.path.endsWith('/sessions') && call.method === 'POST').length, 1)
  assert.ok(calls.filter(call => call.path.endsWith('/query')).every(call => call.body.sessionId === 'new-session'))
  assert.equal(controller.getState().messages[0].id, 'new-answer')
  assert.equal(calls.some(call => call.path.includes('/sessions?')), false)
  controller.dispose()
})

test('leaving during session creation still submits the accepted question without updating the closed page', async () => {
  let resolveSession
  const { controller, calls } = fixture((path, method) => {
    if (path.endsWith('/sessions') && method === 'POST') return new Promise(resolve => { resolveSession = resolve })
  }, { freshSession: true })
  await controller.restore('tenant:user')
  const sending = controller.send('question before closing')
  await new Promise(resolve => setImmediate(resolve))
  controller.dispose()
  resolveSession({ session: { id: 'closed-session' } })
  await sending
  assert.equal(calls.filter(call => call.path.endsWith('/query')).length, 1)
  assert.equal(calls.find(call => call.path.endsWith('/query')).body.sessionId, 'closed-session')
})

function standalonePage(api, controllerFactory) {
  let definition
  vm.runInNewContext(fs.readFileSync(__dirname + '/packages/operator/assistant/index.js', 'utf8'), {
    setTimeout: () => 1, clearTimeout() {},
    Page: value => { definition = value },
    require: id => id.endsWith('/api') ? api : { createAssistantController: controllerFactory },
    wx: { getStorageSync() {}, setStorageSync() {} },
  })
  return { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }
}

test('standalone page starts fresh and ignores updates after leaving the page', async () => {
  let options, disposed = 0
  const controller = { async restore(scope) { assert.equal(scope, 'tenant:user:unified') }, dispose() { disposed++ } }
  const page = standalonePage({ token: () => 'token', me: async () => ({ user: { tenantId: 'tenant', id: 'user' } }) }, value => { options = value; return controller })
  await page.initialize()
  assert.equal(options.freshSession, true)
  options.onChange({ messages: [{ id: 'reply', text: 'current reply' }], input: 'draft' })
  assert.equal(page.data.messages[0].content, 'current reply')
  page.onHide()
  options.onChange({ messages: [{ id: 'late', text: 'late reply' }], input: 'old draft' })
  assert.equal(disposed, 1)
  assert.equal(page.data.messages.length, 0)
  assert.equal(page.data.input, '')
  assert.equal(page.controller, null)
})

test('standalone page does not create a controller after a late login response', async () => {
  let finish, created = 0
  const page = standalonePage({ token: () => 'token', me: () => new Promise(resolve => { finish = resolve }) }, () => { created++ })
  const opening = page.initialize()
  page.onHide()
  finish({ user: { tenantId: 'tenant', id: 'user' } })
  await opening
  assert.equal(created, 0)
  assert.equal(page.data.messages.length, 0)
})


test('history selection resumes a processing session without another AI submission', async () => {
  const { controller, calls } = fixture(path => path.endsWith('/messages') ? { session: { status: 'processing' }, messages: [{ id: 'question', role: 'user', text: 'waiting' }] } : undefined, { freshSession: true })
  await controller.restore('tenant:user')
  await controller.openSession('pending-session')
  assert.equal(controller.getState().sessionId, 'pending-session')
  assert.equal(controller.getState().processing, true)
  await controller.send('another question')
  assert.equal(calls.filter(call => call.path.endsWith('/query')).length, 0)
  controller.dispose()
})

test('background result gets one unread badge, clears after reading, and search filters titles', async () => {
  let status = 'processing', resultMessageId = ''
  const controller = { getState: () => ({ sessionId: '' }), listSessions: async () => [{ id: 's1', title: '产品内容策划', status, resultMessageId }], dispose() {} }
  const page = standalonePage({}, () => controller)
  page.controller = controller; page.visit = 1; page.readKey = 'read:tenant:user'; page.readResults = {}
  await page.refreshHistory()
  assert.equal(page.data.sessions[0].unread, false)
  assert.equal(page.data.sessions[0].statusLabel, '处理中')
  status = 'completed'; resultMessageId = 'actual-answer'
  await page.refreshHistory()
  assert.equal(page.data.sessions[0].unread, true)
  assert.equal(page.data.unreadTotal, 1)
  page.markRead('s1', resultMessageId)
  await page.refreshHistory()
  assert.equal(page.data.unreadTotal, 0)
  page.searchSessions({ detail: { value: '客户' } })
  assert.equal(page.data.filteredSessions.length, 0)
  page.searchSessions({ detail: { value: '产品' } })
  assert.equal(page.data.filteredSessions.length, 1)
  page.onHide()
})
