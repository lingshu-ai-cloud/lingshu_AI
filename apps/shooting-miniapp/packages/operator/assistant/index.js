const api = require('../../../lib/api')
const assistant = require('../../../lib/assistant')

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
  data: { loading: true, sending: false, recording: false, transcribing: false, inputMode: 'voice', error: '', messages: [], suggestions: [], showSuggestions: false, input: '', anchor: '', contentTask: null, preview: null, receipts: [], actions: [], confirming: false, statusBarHeight: 24, headerHeight: 48, contentTop: 72, serviceMode: false, agentTitle: '编导 Agent', agentNote: '内容编导助手', welcomeTitle: '今天想推进什么？', welcomeNote: '可以询问真实任务、询盘与执行状态', showSessions: false, sessionsLoading: false, sessions: [], historySession: null, historyMessages: [] },
  async onLoad(options = {}) {
    const serviceMode = options.edition === 'service'
    if (serviceMode) this.setData({ serviceMode, agentTitle: '客服 Agent', agentNote: '询盘转化助手', welcomeTitle: '今天要回复谁？', welcomeNote: '可以查询真实询盘、生成回复和安排跟进' })
    this.configureHeader()
    if (!api.token()) { wx.redirectTo({ url: '/pages/workbench/index' }); return }
    try {
      const profile = await api.me(); const user = profile.user || {}
      this.scope = String(user.tenantId || user.tenant_id || '') + ':' + String(user.id || user.email || '') + ':' + (serviceMode ? 'service' : 'operator')
      this.createController(); await this.controller.restore(this.scope)
    } catch (error) { this.setData({ loading: false, error: error.message }) }
  },
  configureHeader() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync ? wx.getSystemInfoSync() : {}
    const statusBarHeight = Number(info.statusBarHeight) || 24
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
    const headerHeight = menu && menu.bottom > statusBarHeight ? menu.bottom - statusBarHeight + Math.max(0, menu.top - statusBarHeight) : 48
    this.setData({ statusBarHeight, headerHeight, contentTop: statusBarHeight + headerHeight })
  },
  onShow() { if (this.controller) this.controller.poll() },
  onHide() { if (this.controller) this.controller.pause(); if (this.data.recording && this.recorder) { this.cancelVoice = true; this.recorder.stop() } },
  onUnload() { if (this.controller) { this.controller.archive().catch(() => {}); this.controller.dispose() } if (this.data.recording && this.recorder) { this.cancelVoice = true; this.recorder.stop() } },
  createController() {
    if (this.controller) this.controller.dispose()
    this.controller = assistant.createAssistantController({
      request: (path, method, body) => api.request(path, method, body),
      contextMode: this.data.serviceMode ? 'customer_service' : 'operator',
      storage: { get: key => wx.getStorageSync(key), set: (key, value) => wx.setStorageSync(key, value) },
      onChange: state => {
        const labels = { accepted:'已接收', queued:'排队中', running:'执行中', waiting_user:'等待你处理', succeeded:'操作已完成', failed:'操作失败', cancelled:'已取消' }
        const messages = (state.messages || []).map(message => ({ ...message, content: message.text || message.content || '' }))
        this.setData({ messages, suggestions:(state.suggestions || []).map(item => typeof item === 'string' ? item : item.label), contentTask:contentTaskView(state.contentTask), loading:state.loading, sending:state.sending, input:state.input || '', preview:state.preview, receipts:(state.receipts || []).map(item => ({...item,statusLabel:labels[item.status] || '状态待核实'})), actions:state.actions || [], confirming:state.confirming, anchor:messages.length ? messages[messages.length - 1].id : '', ...(state.error ? {error:state.error} : {}) })
      }
    })
  },
  inputText(e) { this.setData({ input: e.detail.value }); this.controller?.setInput(e.detail.value) },
  toggleSuggestions() { this.setData({ showSuggestions: !this.data.showSuggestions }) },
  async openSessions() {
    this.setData({ showSessions: true, sessionsLoading: true, historySession: null, historyMessages: [] })
    try {
      const sessions = await this.controller.listSessions()
      this.setData({ sessions: sessions.map(item => ({ ...item, displayTitle: item.title === '新对话' ? (item.archivedAt ? '已归档会话' : '当前会话') : item.title, displayTime: String(item.archivedAt || item.updatedAt || item.createdAt || '').replace('T', ' ').slice(0, 16) })) })
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ sessionsLoading: false }) }
  },
  closeSessions() { this.setData({ showSessions: false, historySession: null, historyMessages: [] }) },
  backToSessions() { this.setData({ historySession: null, historyMessages: [] }) },
  async viewSession(e) {
    const session = this.data.sessions.find(item => item.id === e.currentTarget.dataset.id)
    if (!session) return
    this.setData({ sessionsLoading: true })
    try {
      const history = await this.controller.readSession(session.id)
      this.setData({ historySession: session, historyMessages: (history.messages || []).map(message => ({ ...message, content: message.text || message.content || '' })) })
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ sessionsLoading: false }) }
  },
  switchInputMode(e) {
    if (this.data.recording) this.cancelRecording()
    const inputMode = e.currentTarget.dataset.mode || 'text'
    const error = /麦克风|录音/.test(this.data.error || '') ? '' : this.data.error
    this.setData({ inputMode, error })
  },
  ask(e) { this.setData({ input: e.currentTarget.dataset.text, showSuggestions: false }); this.send() },
  async send() { const value = this.data.input.trim(); if (!value || this.data.sending) return; try { await this.controller.send(value) } catch (error) { this.setData({ error:error.message, input:value }) } },
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
    if (!await this.ensureRecordPermission() || !wx.getRecorderManager) return
    if (!this.recorder) {
      this.recorder = wx.getRecorderManager()
      this.recorder.onStart(()=>{ this.setData({recording:true,error:''}); if (this.stopVoiceAfterStart || !this.voiceHolding) { this.cancelVoice=true; this.recorder.stop() } })
      this.recorder.onError(()=>{
        this.setData({recording:false,inputMode:'text',error:''})
        wx.showToast?.({title:'录音未启动，请检查麦克风权限',icon:'none'})
      })
      this.recorder.onStop(async result=>{
        this.setData({recording:false})
        if (this.cancelVoice) { this.cancelVoice=false; return }
        this.setData({transcribing:true})
        try {
          const audio = await new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:result.tempFilePath,encoding:'base64',success:r=>resolve(r.data),fail:reject}))
          const transcript = await api.request('mobile-workbench/transcribe','POST',{audio,audioSeconds:Math.max(1,Math.round(Number(result.duration || 0)/1000))})
          const text = String(transcript.text || '').trim()
          this.setData({input:text}); this.controller?.voiceDraft(text)
          if (text) { this.setData({inputMode:'text'}); wx.showToast?.({title:'已转成文字，可修改后发送',icon:'none'}) }
        } catch (error) { this.setData({error:error.message || '识别失败，请使用文字输入'}) }
        finally { this.setData({transcribing:false}) }
      })
    }
    this.cancelVoice=false; this.recorder.start({duration:20000,format:'mp3',sampleRate:16000,numberOfChannels:1,encodeBitRate:32000})
  },
  holdVoiceStart(e) { if (this.data.transcribing || this.data.sending) return; this.voiceStartY=e.touches?.[0]?.clientY || 0; this.voiceHolding=true; this.stopVoiceAfterStart=false; this.toggleVoice() },
  holdVoiceMove(e) { const y=e.touches?.[0]?.clientY || this.voiceStartY; if (this.voiceHolding && this.voiceStartY-y>60) this.cancelRecording() },
  holdVoiceEnd() { this.voiceHolding=false; if (this.data.recording && this.recorder) this.recorder.stop(); else this.stopVoiceAfterStart=true },
  cancelRecording() { this.voiceHolding=false; this.stopVoiceAfterStart=true; this.cancelVoice=true; this.recorder?.stop() },
  async previewAction(e) { const action = this.data.actions[Number(e.currentTarget.dataset.index)]; if (action) try { await this.controller.preview(action.action || action) } catch (error) { this.setData({error:error.message}) } },
  dismissPreview() { this.controller?.dismissPreview() },
  async confirmAction() { if (!this.data.preview || this.data.confirming) return; try { await this.controller.confirm(this.data.preview.previewId) } catch (error) { this.setData({error:error.message}) } }
})
