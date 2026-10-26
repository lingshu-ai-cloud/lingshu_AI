const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const moduleBox = { exports: {} }
vm.runInNewContext(fs.readFileSync(__dirname + '/lib/lingxiaoshu-feed.js', 'utf8'), { module:moduleBox, exports:moduleBox.exports, Date, Number, String, Array, Set })
const feed = moduleBox.exports

test('lingxiaoshu feed combines daily report, urgent work, and approval notices', () => {
  const notices = feed.projectNotices({
    workspace: { name: '美妆工作台' },
    metrics: {
      tasks: { availability:'available', value:6 },
      completed: { availability:'available', value:4 },
      publishedVideos: { availability:'unavailable' },
      qualifiedInquiries: { availability:'available', value:3 },
    },
  }, { matters: [
    { id:'urgent-1', priority:'urgent', title:'补拍产品特写', reason:'今天到期' },
    { id:'approval-1', type:'approval', title:'审核成片', reason:'等待确认' },
  ] }, Date.parse('2026-10-24T08:00:00+08:00'))
  assert.deepEqual(Array.from(notices, item => item.type), ['daily', 'urgent', 'approval'])
  assert.match(notices[0].summary, /本周任务 6/)
  assert.match(notices[0].summary, /已发布视频 —/)
  assert.equal(notices[1].targetId, 'urgent-1')
  assert.equal(notices[2].targetId, 'approval-1')
})

test('daily first-open scope is account-specific and Shanghai-day based', () => {
  assert.equal(feed.shanghaiDay(Date.parse('2026-10-23T16:30:00Z')), '2026-10-24')
  assert.equal(feed.dailyStorageKey('tenant:user:unified'), 'lingxiaoshu:daily-open:tenant:user:unified')
  assert.equal(feed.welcomeStorageKey('tenant:user:unified', 'session-1'), 'lingxiaoshu:welcome:tenant:user:unified:session-1')
})

test('unified home highlighted tasks become urgent notices even when source priority is normal', () => {
  const notices = feed.projectNotices({}, {
    urgentMatters: [
      { id:'shoot:1', type:'shoot', priority:'normal', title:'分镜 1 补拍', reason:'缺少产品特写' },
    ],
    matters: [
      { id:'shoot:1', type:'shoot', priority:'normal', title:'分镜 1 补拍', reason:'缺少产品特写' },
    ],
  })
  assert.deepEqual(Array.from(notices, item => item.type), ['daily', 'urgent'])
  assert.equal(notices[1].targetId, 'shoot:1')
})

test('briefing folds real tasks into one priority item and does not invent an unavailable report', () => {
  const briefing = feed.projectBriefing({ metrics: { tasks: { availability:'available', value:6 } } }, {
    matters: [
      { id:'shoot:1', priority:'urgent', title:'补拍产品特写' },
      { id:'shoot:2', priority:'urgent', title:'补拍包装特写' },
      { id:'approve:1', type:'approval', title:'审核成片' },
    ],
  })
  assert.equal(briefing.total, 3)
  assert.equal(briefing.remaining, 2)
  assert.equal(briefing.primary.targetId, 'shoot:1')
  assert.match(briefing.summary, /2 项紧急任务 · 1 项待审批/)
  assert.match(briefing.report, /本周任务 6/)
  assert.equal(feed.projectBriefing({}, {}).report, '')
  const approvalOnly = feed.projectBriefing({}, { approvals:[{ id:'approve:2', title:'确认发布' }] })
  assert.equal(approvalOnly.total, 1)
  assert.equal(approvalOnly.primary.type, 'approval')
})

test('content supplement card requires an authoritative, current input gap', () => {
  const current = { availability:'available', card: {
    contentTaskId:'content-1', title:'产品短视频', overallState:'needs_input', nextAction:'supply_input',
    blockingItems:[{key:'product',label:'待补充',value:'选择产品'}, {key:'material',label:'待补充',value:'上传素材'}, {key:'platform',label:'待补充',value:'确认平台'}],
    knownItems:[{key:'format',label:'形式',value:'短视频'}],
  } }
  const card = feed.projectContentSupplement(current)
  assert.equal(card.taskId, 'content-1')
  assert.equal(card.required.length, 2)
  assert.equal(card.remaining, 1)
  assert.equal(card.known[0].value, '短视频')
  assert.equal(feed.projectContentSupplement({ ...current, availability:'unavailable' }), null)
  assert.equal(feed.projectContentSupplement({ ...current, card:{ ...current.card, overallState:'completed' } }), null)
  assert.equal(feed.projectContentSupplement({ ...current, card:{ ...current.card, readState:'unavailable' } }), null)
})

test('lingxiaoshu keeps a compact text composer, plus menu and opt-in voice input', () => {
  const markup = fs.readFileSync(__dirname + '/components/lingxiaoshu-sheet/index.wxml', 'utf8')
  const styles = fs.readFileSync(__dirname + '/components/lingxiaoshu-sheet/index.wxss', 'utf8')
  const script = fs.readFileSync(__dirname + '/components/lingxiaoshu-sheet/index.js', 'utf8')
  const actionMenuStyles = fs.readFileSync(__dirname + '/styles/message-action-menu.wxss', 'utf8')
  const home = fs.readFileSync(__dirname + '/packages/operator/home/index.js', 'utf8')
  const nav = fs.readFileSync(__dirname + '/components/operator-nav/index.wxml', 'utf8')
  assert.match(markup, /aria-role="dialog"/)
  assert.doesNotMatch(markup, /class="priority-summary"/)
  assert.doesNotMatch(styles, /\.priority-summary/)
  assert.match(markup, /class="message-action-menu"/)
  assert.doesNotMatch(markup, /scroll-view[^>]*class="message-action-menu"/)
  assert.match(markup, /class="capability-trigger"/)
  assert.match(markup, /bindtap="toggleCapabilities"/)
  assert.match(markup, /class="message-action-option"/)
  assert.match(markup, /class="assistant-empty"/)
  assert.match(markup, /今天想先推进什么/)
  assert.match(markup, /class="quick-prompts"/)
  assert.match(markup, /class="assistant-daily-line"/)
  assert.doesNotMatch(markup, /class="capability-dialog"|class="capability-grid"|class="supplement-card"/)
  assert.match(markup, /bindtap="switchToVoice"/)
  assert.match(markup, /bindtouchstart="holdVoiceStart"/)
  assert.match(markup, /bindtouchmove="holdVoiceMove"/)
  assert.match(markup, /bindtouchend="holdVoiceEnd"/)
  assert.match(markup, /bindtouchcancel="cancelRecording"/)
  assert.match(markup, /bindtap="switchToText"/)
  assert.doesNotMatch(markup, /wx:for="\{\{notices\}\}"/)
  assert.doesNotMatch(markup, /class="notice-card/)
  assert.match(styles, /height:74vh/)
  assert.match(styles, /env\(safe-area-inset-bottom\)/)
  assert.doesNotMatch(styles, /grid-template-columns:repeat\(2/)
  assert.match(styles, /@import "\.\.\/\.\.\/styles\/message-action-menu\.wxss"/)
  assert.match(actionMenuStyles, /\.message-action-menu\{position:absolute/)
  assert.match(actionMenuStyles, /\.message-action-option\{min-height:112rpx/)
  assert.match(actionMenuStyles, /border-radius:50rpx/)
  assert.match(styles, /\.send-hit,\.voice-entry,\.keyboard-entry\{width:88rpx;height:88rpx;min-width:88rpx;max-width:88rpx;flex:0 0 88rpx/)
  assert.match(styles, /\.send-glyph\{width:62rpx;height:62rpx/)
  assert.doesNotMatch(markup, /class="send-button/)
  assert.match(script, /showCapabilities: false, composerMode: 'text'/)
  assert.match(script, /visible: true, showCapabilities: false, composerMode: 'text'/)
  assert.doesNotMatch(script, /messages\.length \? \{ showCapabilities: false/)
  assert.match(script, /await controller\.send\(capability\.prompt\)/)
  assert.match(script, /mobile-workbench\/transcribe/)
  assert.match(script, /this\.controller\?\.voiceDraft\(text\)/)
  assert.match(script, /autoOpenDaily/)
  assert.match(script, /dailyStorageKey/)
  assert.match(script, /freshSession: true/)
  assert.match(script, /workDataChanged/)
  assert.match(script, /feed\.projectBriefing\(this\.properties\.overview/)
  assert.match(script, /urgentMatters: this\.properties\.queue\.urgentMatters/)
  assert.match(script, /contextMode: 'operator'/)
  assert.match(home, /getMenuButtonBoundingClientRect/)
  assert.doesNotMatch(nav, /assistant-trigger/)
  assert.match(nav, /nav-item/)
})

function sheetInstance(api, wx, assistant = {}) {
  let definition
  const source = fs.readFileSync(__dirname + '/components/lingxiaoshu-sheet/index.js', 'utf8')
  vm.runInNewContext(source, {
    Component: value => { definition = value },
    require: name => ({ '../../lib/api': api, '../../lib/assistant': assistant, '../../lib/lingxiaoshu-feed': {}, '../../lib/workbench': {} })[name],
    wx,
  })
  const instance = {
    data: { ...definition.data },
    properties: {},
    triggerEvent() {},
    hidePage() { definition.pageLifetimes.hide.call(this) },
    setData(patch) { Object.assign(this.data, patch) },
    ...definition.methods,
  }
  return instance
}

test('capability selection sends its default question directly and preserves an unsent draft', async () => {
  const sent = []
  const instance = sheetInstance({ token: () => 'current-account' }, {})
  instance.data.input = '我自己的草稿'
  instance.data.showCapabilities = true
  instance.controller = {
    async send(prompt) { sent.push(prompt) },
    setInput(value) { instance.data.input = value },
  }
  await instance.selectCapability({ currentTarget: { dataset: { id: 'tasks' } } })
  assert.deepEqual(sent, ['本周任务进展怎么样？'])
  assert.equal(instance.data.showCapabilities, false)
  assert.equal(instance.data.input, '我自己的草稿')
  assert.equal(instance.capabilitySending, false)
})

test('voice transcription returns an editable draft without sending a chat message', async () => {
  let onStart, onStop, onError, finished
  const recorder = {
    onStart(callback) { onStart = callback },
    onStop(callback) { onStop = callback },
    onError(callback) { onError = callback },
    start() { onStart() },
    stop() { finished = onStop({ tempFilePath: 'local-recording', duration: 1200 }) },
  }
  const drafted = []
  const requests = []
  const wx = {
    getSetting({ success }) { success({ authSetting: { 'scope.record': true } }) },
    getRecorderManager: () => recorder,
    getFileSystemManager: () => ({ readFile({ success }) { success({ data: 'base64-audio' }) } }),
  }
  const instance = sheetInstance({ token: () => 'current-account', async request(...args) { requests.push(args); return { text: '查询本周任务' } } }, wx)
  instance.data.visible = true
  instance.data.composerMode = 'voice'
  instance.controller = { voiceDraft: text => drafted.push(text), send: () => { throw Error('voice must not send') } }
  instance.voiceHolding = true
  await instance.startVoice()
  assert.equal(typeof onError, 'function')
  assert.equal(instance.data.recording, true)
  instance.holdVoiceEnd()
  await finished
  assert.deepEqual(drafted, ['查询本周任务'])
  assert.deepEqual(Array.from(requests[0]).slice(0, 2), ['mobile-workbench/transcribe', 'POST'])
  assert.equal(instance.data.input, '查询本周任务')
  assert.equal(instance.data.composerMode, 'text')
  assert.equal(instance.data.transcribing, false)
})


test('closing or leaving the page clears conversation, draft and feedback and disposes the controller', () => {
  for (const exit of ['close', 'hidePage']) {
    let disposed = 0
    const instance = sheetInstance({}, {})
    Object.assign(instance.data, { visible: true, messages: [{ text: 'old answer' }], input: 'draft', error: 'old error', sending: true, preview: { id: 'old' }, anchor: 'old' })
    instance.controller = { dispose() { disposed++ } }
    instance[exit]()
    assert.equal(disposed, 1)
    assert.equal(instance.controller, null)
    assert.equal(instance.data.messages.length, 0)
    assert.equal(instance.data.input, '')
    assert.equal(instance.data.error, '')
    assert.equal(instance.data.visible, false)
    assert.equal(instance.data.sending, false)
    assert.equal(instance.data.preview, null)
    assert.equal(instance.data.anchor, '')
  }
})

test('closing before profile restoration finishes cannot install a stale conversation', async () => {
  let resolveProfile, created = 0
  const instance = sheetInstance({ token: () => 'account', me: () => new Promise(resolve => { resolveProfile = resolve }) }, {}, {
    createAssistantController() { created++; throw Error('stale bootstrap must not create controller') },
  })
  const opening = instance.bootstrap()
  instance.close()
  resolveProfile({ user: { id: 'user', tenantId: 'tenant' } })
  await opening
  assert.equal(created, 0)
  assert.equal(instance.data.booting, false)
  assert.equal(instance.data.messages.length, 0)
})

test('late controller updates and failed sends cannot repopulate a closed sheet', async () => {
  let emit, rejectSend
  const controller = {
    async restore() {}, dispose() {},
    send() { return new Promise((resolve, reject) => { rejectSend = reject }) },
  }
  const instance = sheetInstance({ token: () => 'account' }, {}, {
    createAssistantController(options) { emit = options.onChange; return controller },
  })
  instance.ensureProfile = async () => 'tenant:user'
  await instance.bootstrap()
  instance.data.input = 'question'
  const sending = instance.send()
  instance.close()
  emit({ messages: [{ text: 'late reply' }], error: 'late error' })
  rejectSend(Error('late failure'))
  await sending
  assert.equal(instance.data.messages.length, 0)
  assert.equal(instance.data.input, '')
  assert.equal(instance.data.error, '')
})
