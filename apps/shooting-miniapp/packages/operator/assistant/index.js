const api = require('../../../lib/api')
const assistant = require('../../../lib/assistant')

function sessionTime(value) {
  const date = new Date(value || '')
  return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 16)
}

function contentTaskView(value) {
  const wrapper = value && typeof value === 'object' ? value : null
  const card = wrapper && wrapper.availability === 'available' ? wrapper.card : null
  if (!card) return null
  const states = { needs_input:'待我处理', needs_approval:'待我处理', processing:'灵小枢处理中', paused:'已暂停', failed:'需要处理', completed:'已完成', cancelled:'已取消' }
  const actions = { supply_input:'去补充', review:'去验收', view:'查看详情', download:'查看交付', none:'查看记录' }
  const progress = card.progress?.mode === 'units' ? `${card.progress.completed}/${card.progress.total}` : ''
  const cost = card.cost
  const costLabel = !cost ? '' : cost.status === 'unknown' ? '费用暂时无法核实'
    : cost.actualCny !== null && cost.actualCny !== undefined ? `已结算 ¥${Number(cost.actualCny).toFixed(2)}`
      : cost.upperBoundCny !== null && cost.upperBoundCny !== undefined ? `费用上限 ¥${Number(cost.upperBoundCny).toFixed(2)}（待结算）`
        : cost.expectedCny !== null && cost.expectedCny !== undefined ? `预计费用 ¥${Number(cost.expectedCny).toFixed(2)}（待结算）`
          : cost.status === 'free' ? '费用 ¥0.00' : ''
  return { ...card, blockingItems:(card.blockingItems || []).slice(0,3), knownItems:(card.knownItems || []).slice(0,3), stateLabel:states[card.overallState] || '状态待核实', actionLabel:actions[card.nextAction] || '查看详情', progress, costLabel }
}

Page({
  data: { keyboardHeight: 0, loading: true, sending: false, recording: false, transcribing: false, inputMode: 'text', error: '', messages: [], suggestions: [], showSuggestions: false, input: '', anchor: '', contentTask: null, preview: null, receipts: [], actions: [], confirming: false, statusBarHeight: 24, headerHeight: 48, contentTop: 72, serviceMode: false, agentTitle: '灵小枢', agentNote: '你的 AI 工作伙伴', greeting: '你好', welcomeNote: '从一个想法开始，和灵小枢一起完成。', capabilities: [{ title: '任务与审批', icon: '✓', prompt: '本周任务进展怎么样？' }, { title: '内容生产', icon: '✎', prompt: '制作一条产品内容需要先准备哪些信息？' }, { title: '客户跟进', icon: '◎', prompt: '本周有效询盘有多少？' }, { title: '素材拍摄', icon: '▣', prompt: '待拍素材要先核对哪些要求？' }], showSessions: false, sessionsLoading: false, sessions: [], historySession: null, historyMessages: [], sessionSearch: '', filteredSessions: [], unreadTotal: 0 },
  onLoad() { this.configureHeader() },
  configureHeader() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync ? wx.getSystemInfoSync() : {}
    const statusBarHeight = Number(info.statusBarHeight) || 24
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
    const headerHeight = menu && menu.bottom > statusBarHeight ? menu.bottom - statusBarHeight + Math.max(0, menu.top - statusBarHeight) : 48
    this.setData({ statusBarHeight, headerHeight, contentTop: statusBarHeight + headerHeight })
  },
  onShow() { this.initialize() },
  onHide() { this.resetConversation() },
  onUnload() { this.resetConversation() },
  resetConversation() {
    this.visit = (this.visit || 0) + 1
    if (this.historyTimer) clearTimeout(this.historyTimer)
    this.historyTimer = null
    this.controller?.dispose()
    this.controller = null
    this.cancelRecording()
    this.setData({ loading: false, sending: false, confirming: false, recording: false, transcribing: false,
      messages: [], input: '', error: '', actions: [], receipts: [], contentTask: null, preview: null, anchor: '',
      showSessions: false, historySession: null, historyMessages: [], sessions: [], filteredSessions: [], unreadTotal: 0, sessionSearch: '', historyError: '', sessionsLoading: false, inputMode: 'text', keyboardHeight: 0 })
  },
  async initialize() {
    if (!api.token()) { wx.redirectTo({ url: '/pages/workbench/index' }); return }
    const visit = this.visit = (this.visit || 0) + 1
    this.setData({ loading: true, error: '' })
    try {
      const profile = await api.me()
      if (visit !== this.visit) return
      const user = profile.user || {}
      const hour = new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours()
      const greeting = hour < 6 ? '夜深了' : hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好'
      const name = String(user.name || '').trim().slice(0, 12)
      this.setData({ greeting: name ? `${greeting}，${name}` : greeting })
      this.accountScope = `${user.tenantId || user.tenant_id || ''}:${user.id || user.email || ''}:unified`
      this.readKey = 'mobile-assistant-read:' + this.accountScope
      this.readResults = wx.getStorageSync(this.readKey) || {}
      this.createController(visit)
      await this.controller.restore(this.accountScope)
      if (visit === this.visit) this.pollHistory(visit)
    } catch (error) { if (visit === this.visit) this.setData({ loading: false, error: error.message || '助手暂时无法打开' }) }
  },
  createController(visit = this.visit) {
    this.controller?.dispose()
    this.controller = assistant.createAssistantController({
      request: (path, method, body) => api.request(path, method, body),
      contextMode: 'operator', freshSession: true,
      storage: { get: key => wx.getStorageSync(key), set: (key, value) => wx.setStorageSync(key, value) },
      onChange: state => {
        if (visit !== this.visit) return
        const labels = { accepted:'已接收', queued:'排队中', running:'执行中', waiting_user:'等待你处理', succeeded:'操作已完成', failed:'操作失败', cancelled:'已取消' }
        const messages = (state.messages || []).map(message => ({ ...message, content: message.text || message.content || '' }))
        if (state.sessionId && !state.loading && !this.data.showSessions) {
          const result = [...messages].reverse().find(message => message.role === 'assistant' && !message.commandId)
          if (result) this.markRead(state.sessionId, result.id)
          for (const receipt of state.receipts || []) if (receipt.status === 'succeeded') {
            const command = messages.find(message => message.commandId === receipt.id)
            if (command) this.markRead(state.sessionId, command.id + ':succeeded')
          }
        }
        this.setData({ messages, suggestions:(state.suggestions || []).map(item => typeof item === 'string' ? item : item.label), contentTask:contentTaskView(state.contentTask), loading:state.loading, sending:state.sending || state.processing, input:state.input || '', preview:state.preview, receipts:(state.receipts || []).map(item => ({...item,statusLabel:labels[item.status] || '状态待核实'})), actions:state.actions || [], confirming:state.confirming, anchor:messages.length ? messages[messages.length - 1].id : '', error:state.error || '' })
      }
    })
  },
  newConversation() { this.resetConversation(); return this.initialize() },
  navigateWorkspace(e) {
    const paths = { today: '/packages/operator/home/index', shooting: '/packages/operator/shooting/index', materials: '/packages/operator/materials/index', customers: '/packages/operator/inquiries/index' }
    const url = paths[e.currentTarget.dataset.key]
    if (url) { if (e.currentTarget.dataset.key === 'shooting') wx.navigateTo({ url }); else wx.redirectTo({ url }) }
  },
  stop() {},
  keyboardChanged(e) { this.setData({ keyboardHeight: Math.max(0, Number(e.detail.height) || 0) }) },
  inputText(e) { this.setData({ input: e.detail.value }); this.controller?.setInput(e.detail.value) },
  toggleSuggestions() { this.setData({ showSuggestions: !this.data.showSuggestions }) },
  markRead(id, resultId) {
    if (!resultId || !this.readKey || this.readResults[id] === resultId) return
    this.readResults[id] = resultId
    wx.setStorageSync(this.readKey, this.readResults)
  },
  async refreshHistory() {
    if (!this.controller || this.historyBusy) return
    const visit = this.visit, controller = this.controller
    this.historyBusy = true
    try {
      const sessions = await controller.listSessions()
      if (visit !== this.visit) return
      const labels = { processing: '处理中', completed: '已完成', unconfirmed: '结果待确认', failed: '需要处理', cancelled: '已取消', waiting_user: '待你处理' }
      this.setData({ sessions: sessions.filter(item => item.status !== 'empty').map(item => ({ ...item,
        displayTitle: item.title === '新对话' ? '历史会话' : item.title,
        displayTime: sessionTime(item.updatedAt || item.createdAt),
        statusLabel: labels[item.status] || '', unread: Boolean(item.resultMessageId && this.readResults[item.id] !== item.resultMessageId)
      })) })
      this.filterSessions()
      const current = sessions.find(item => item.id === controller.getState?.().sessionId)
      if (current && !this.data.showSessions && !controller.getState().sending) {
        await controller.refreshSession()
        if (visit !== this.visit) return
        this.setData({ sessions: this.data.sessions.map(item => ({ ...item, unread: Boolean(item.resultMessageId && this.readResults[item.id] !== item.resultMessageId) })) })
        this.filterSessions()
      }
      this.setData({ historyError: '' })
    } catch (error) { if (visit === this.visit) this.setData({ historyError: error.message || '会话暂时无法读取' }) }
    finally { this.historyBusy = false; if (visit === this.visit) this.setData({ sessionsLoading: false }) }
  },
  async pollHistory(visit) {
    await this.refreshHistory()
    if (visit === this.visit) this.historyTimer = setTimeout(() => this.pollHistory(visit), 3000)
  },
  filterSessions() {
    const query = String(this.data.sessionSearch || '').trim().toLowerCase()
    this.setData({ filteredSessions: this.data.sessions.filter(item => !query || String(item.displayTitle || '').toLowerCase().includes(query)), unreadTotal: this.data.sessions.filter(item => item.unread).length })
  },
  searchSessions(e) { this.setData({ sessionSearch: e.detail.value }); this.filterSessions() },
  openAccountSettings() { wx.navigateTo({ url: '/packages/operator/profile/index' }) },
  async openSessions() {
    if (!this.controller) return
    this.setData({ showSessions: true, sessionsLoading: !this.data.sessions.length, sessionSearch: '' })
    this.filterSessions()
    await this.refreshHistory()
  },
  closeSessions() { this.setData({ showSessions: false }); this.controller?.refreshSession().catch(() => {}) },
  async viewSession(e) {
    const visit = this.visit, controller = this.controller
    const session = this.data.sessions.find(item => item.id === e.currentTarget.dataset.id)
    if (!session || !controller) return
    this.setData({ showSessions: false })
    try { await controller.openSession(session.id); if (visit === this.visit) await this.refreshHistory() }
    catch (error) { if (visit === this.visit) this.setData({ error: error.message }) }
  },
  switchInputMode(e) {
    if (this.data.recording) this.cancelRecording()
    const inputMode = e.currentTarget.dataset.mode || 'text'
    const error = /麦克风|录音/.test(this.data.error || '') ? '' : this.data.error
    this.setData({ inputMode, error })
  },
  ask(e) { this.setData({ input: e.currentTarget.dataset.text, showSuggestions: false }); this.send() },
  async send() { const value = this.data.input.trim(); if (!value || this.data.sending) return; const controller = this.controller; if (!controller || this.data.loading) return; try { await controller.send(value) } catch (error) { if (controller === this.controller) this.setData({ error:error.message, input:value }) } },
  openContentTask() {
    const card = this.data.contentTask
    if (!card) return
    wx.navigateTo({ url: `/packages/operator/content-task/index?taskId=${encodeURIComponent(card.contentTaskId)}` })
  },
  async ensureRecordPermission() {
    const setting = await new Promise(resolve => wx.getSetting ? wx.getSetting({ success: resolve, fail: () => resolve({authSetting:{}}) }) : resolve({authSetting:{}}))
    if (setting.authSetting?.['scope.record'] === false) return this.recoverRecordPermission()
    if (setting.authSetting?.['scope.record'] !== true && wx.authorize) try {
      await new Promise((resolve,reject)=>wx.authorize({scope:'scope.record',success:resolve,fail:reject}))
    } catch (_) { return this.recoverRecordPermission() }
    return true
  },
  async recoverRecordPermission() {
    this.setData({ error: '' })
    if (!wx.showModal || !wx.openSetting) return false
    const choice = await new Promise(resolve => wx.showModal({
      title: '开启麦克风权限',
      content: '语音输入需要麦克风权限。请在设置中允许使用麦克风。',
      confirmText: '去设置',
      cancelText: '暂不用',
      success: result => resolve(Boolean(result.confirm)),
      fail: () => resolve(false)
    }))
    if (!choice) { this.setData({ inputMode: 'text' }); return false }
    const result = await new Promise(resolve => wx.openSetting({ success: resolve, fail: () => resolve({authSetting:{}}) }))
    const allowed = result.authSetting?.['scope.record'] === true
    if (!allowed) this.setData({ inputMode: 'text' })
    return allowed
  },
  async toggleVoice() {
    if (this.data.transcribing) return
    if (this.data.recording) { this.recorder.stop(); return }
    const visit = this.visit
    if (!await this.ensureRecordPermission() || visit !== this.visit || !wx.getRecorderManager) return
    if (!this.recorder) {
      this.recorder = wx.getRecorderManager()
      this.recorder.onStart(()=>{ if (this.recordingVisit !== this.visit) return; this.setData({recording:true,error:''}); if (this.stopVoiceAfterStart || !this.voiceHolding) { this.cancelVoice=true; this.recorder.stop() } })
      this.recorder.onError(()=>{
        if (this.recordingVisit !== this.visit) return
        this.setData({recording:false,inputMode:'text',error:''})
        wx.showToast?.({title:'录音未启动，请检查麦克风权限',icon:'none'})
      })
      this.recorder.onStop(async result=>{
        const visit = this.recordingVisit
        if (visit !== this.visit) return
        this.setData({recording:false})
        if (this.cancelVoice) { this.cancelVoice=false; return }
        this.setData({transcribing:true})
        try {
          const audio = await new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:result.tempFilePath,encoding:'base64',success:r=>resolve(r.data),fail:reject}))
          if (visit !== this.visit) return
          const transcript = await api.request('mobile-workbench/transcribe','POST',{audio,audioSeconds:Math.max(1,Math.round(Number(result.duration || 0)/1000))})
          if (visit !== this.visit) return
          const text = String(transcript.text || '').trim()
          this.setData({input:text}); this.controller?.voiceDraft(text)
          if (text) { this.setData({inputMode:'text'}); wx.showToast?.({title:'已转成文字，可修改后发送',icon:'none'}) }
        } catch (error) { if (visit === this.visit) this.setData({error:error.message || '识别失败，请使用文字输入'}) }
        finally { if (visit === this.visit) this.setData({transcribing:false}) }
      })
    }
    this.recordingVisit=this.visit; this.cancelVoice=false; this.recorder.start({duration:20000,format:'mp3',sampleRate:16000,numberOfChannels:1,encodeBitRate:32000})
  },
  holdVoiceStart(e) { if (this.data.transcribing || this.data.sending) return; this.voiceStartY=e.touches?.[0]?.clientY || 0; this.voiceHolding=true; this.stopVoiceAfterStart=false; this.toggleVoice() },
  holdVoiceMove(e) { const y=e.touches?.[0]?.clientY || this.voiceStartY; if (this.voiceHolding && this.voiceStartY-y>60) this.cancelRecording() },
  holdVoiceEnd() { this.voiceHolding=false; if (this.data.recording && this.recorder) this.recorder.stop(); else this.stopVoiceAfterStart=true },
  cancelRecording() { this.voiceHolding=false; this.stopVoiceAfterStart=true; this.cancelVoice=true; this.recorder?.stop() },
  async previewAction(e) { const action = this.data.actions[Number(e.currentTarget.dataset.index)]; if (action) try { await this.controller.preview(action.action || action) } catch (error) { this.setData({error:error.message}) } },
  dismissPreview() { this.controller?.dismissPreview() },
  async confirmAction() { if (!this.data.preview || this.data.confirming) return; try { await this.controller.confirm(this.data.preview.previewId) } catch (error) { this.setData({error:error.message}) } }
})
