const api = require('../../../lib/api')
const assistant = require('../../../lib/assistant')

Page({
  data: { loading: true, sending: false, recording: false, transcribing: false, inputMode: 'voice', error: '', messages: [], suggestions: [], showSuggestions: false, input: '', anchor: '', preview: null, receipts: [], actions: [], confirming: false, statusBarHeight: 24, headerHeight: 48, contentTop: 72, serviceMode: false, agentTitle: '编导 Agent', agentNote: '内容编导助手', welcomeTitle: '今天想推进什么？', welcomeNote: '可以询问真实任务、询盘与执行状态' },
  async onLoad(options = {}) {
    const serviceMode = options.edition === 'service'
    if (serviceMode) this.setData({ serviceMode, agentTitle: '客服 Agent', agentNote: '询盘转化助手', welcomeTitle: '今天要回复谁？', welcomeNote: '可以查询真实询盘、生成回复和安排跟进' })
    this.configureHeader()
    if (!api.token()) { wx.redirectTo({ url: '/pages/workbench/index' }); return }
    try {
      const profile = await api.me(); const user = profile.user || {}
      this.scope = String(user.tenantId || user.tenant_id || '') + ':' + String(user.id || user.email || '')
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
  onUnload() { if (this.controller) this.controller.dispose(); if (this.data.recording && this.recorder) { this.cancelVoice = true; this.recorder.stop() } },
  createController() {
    if (this.controller) this.controller.dispose()
    this.controller = assistant.createAssistantController({
      request: (path, method, body) => api.request(path, method, body),
      contextMode: this.data.serviceMode ? 'customer_service' : 'operator',
      storage: { get: key => wx.getStorageSync(key), set: (key, value) => wx.setStorageSync(key, value) },
      onChange: state => {
        const labels = { accepted:'已接收', queued:'排队中', running:'执行中', waiting_user:'等待你处理', succeeded:'操作已完成', failed:'操作失败', cancelled:'已取消' }
        const messages = (state.messages || []).map(message => ({ ...message, content: message.text || message.content || '' }))
        this.setData({ messages, suggestions:(state.suggestions || []).map(item => typeof item === 'string' ? item : item.label), loading:state.loading, sending:state.sending, input:state.input || '', preview:state.preview, receipts:(state.receipts || []).map(item => ({...item,statusLabel:labels[item.status] || '状态待核实'})), actions:state.actions || [], confirming:state.confirming, anchor:messages.length ? messages[messages.length - 1].id : '', ...(state.error ? {error:state.error} : {}) })
      }
    })
  },
  inputText(e) { this.setData({ input: e.detail.value }); this.controller?.setInput(e.detail.value) },
  toggleSuggestions() { this.setData({ showSuggestions: !this.data.showSuggestions }) },
  switchInputMode(e) {
    if (this.data.recording) this.cancelRecording()
    const inputMode = e.currentTarget.dataset.mode || 'text'
    const error = /麦克风|录音/.test(this.data.error || '') ? '' : this.data.error
    this.setData({ inputMode, error })
  },
  ask(e) { this.setData({ input: e.currentTarget.dataset.text, showSuggestions: false }); this.send() },
  async send() { const value = this.data.input.trim(); if (!value || this.data.sending) return; try { await this.controller.send(value) } catch (error) { this.setData({ error:error.message, input:value }) } },
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
          const transcript = await api.request('mobile-workbench/transcribe','POST',{audio})
          const text = String(transcript.text || '').trim()
          this.setData({input:text}); this.controller?.voiceDraft(text)
          if (text) await this.controller?.send(text)
        } catch (error) { this.setData({error:error.message || '识别失败，请使用文字输入'}) }
        finally { this.setData({transcribing:false}) }
      })
    }
    this.cancelVoice=false; this.recorder.start({duration:60000,format:'mp3',sampleRate:16000,numberOfChannels:1,encodeBitRate:48000})
  },
  holdVoiceStart(e) { if (this.data.transcribing || this.data.sending) return; this.voiceStartY=e.touches?.[0]?.clientY || 0; this.voiceHolding=true; this.stopVoiceAfterStart=false; this.toggleVoice() },
  holdVoiceMove(e) { const y=e.touches?.[0]?.clientY || this.voiceStartY; if (this.voiceHolding && this.voiceStartY-y>60) this.cancelRecording() },
  holdVoiceEnd() { this.voiceHolding=false; if (this.data.recording && this.recorder) this.recorder.stop(); else this.stopVoiceAfterStart=true },
  cancelRecording() { this.voiceHolding=false; this.stopVoiceAfterStart=true; this.cancelVoice=true; this.recorder?.stop() },
  async previewAction(e) { const action = this.data.actions[Number(e.currentTarget.dataset.index)]; if (action) try { await this.controller.preview(action.action || action) } catch (error) { this.setData({error:error.message}) } },
  dismissPreview() { this.controller?.dismissPreview() },
  async confirmAction() { if (!this.data.preview || this.data.confirming) return; try { await this.controller.confirm(this.data.preview.previewId) } catch (error) { this.setData({error:error.message}) } }
})
