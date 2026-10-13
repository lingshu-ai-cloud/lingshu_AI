const api = require('../../../lib/api')
const assistant = require('../../../lib/assistant')

Page({
  data: { loading: true, sending: false, recording: false, transcribing: false, error: '', messages: [], suggestions: [], input: '', anchor: '', preview: null, receipts: [], actions: [], confirming: false },
  async onLoad() {
    if (!api.token()) { wx.redirectTo({ url: '/pages/workbench/index' }); return }
    try {
      const profile = await api.me(); const user = profile.user || {}
      this.scope = String(user.tenantId || user.tenant_id || '') + ':' + String(user.id || user.email || '')
      this.createController(); await this.controller.restore(this.scope)
    } catch (error) { this.setData({ loading: false, error: error.message }) }
  },
  onShow() { if (this.controller) this.controller.poll() },
  onHide() { if (this.controller) this.controller.pause(); if (this.data.recording && this.recorder) { this.cancelVoice = true; this.recorder.stop() } },
  onUnload() { if (this.controller) this.controller.dispose(); if (this.data.recording && this.recorder) { this.cancelVoice = true; this.recorder.stop() } },
  createController() {
    if (this.controller) this.controller.dispose()
    this.controller = assistant.createAssistantController({
      request: (path, method, body) => api.request(path, method, body),
      storage: { get: key => wx.getStorageSync(key), set: (key, value) => wx.setStorageSync(key, value) },
      onChange: state => {
        const labels = { accepted:'已接收', queued:'排队中', running:'执行中', waiting_user:'等待你处理', succeeded:'操作已完成', failed:'操作失败', cancelled:'已取消' }
        const messages = (state.messages || []).map(message => ({ ...message, content: message.text || message.content || '' }))
        this.setData({ messages, suggestions:(state.suggestions || []).map(item => typeof item === 'string' ? item : item.label), loading:state.loading, sending:state.sending, input:state.input || '', preview:state.preview, receipts:(state.receipts || []).map(item => ({...item,statusLabel:labels[item.status] || '状态待核实'})), actions:state.actions || [], confirming:state.confirming, anchor:messages.length ? messages[messages.length - 1].id : '', ...(state.error ? {error:state.error} : {}) })
      }
    })
  },
  inputText(e) { this.setData({ input: e.detail.value }); this.controller?.setInput(e.detail.value) },
  ask(e) { this.setData({ input: e.currentTarget.dataset.text }); this.send() },
  async send() { const value = this.data.input.trim(); if (!value || this.data.sending) return; try { await this.controller.send(value) } catch (error) { this.setData({ error:error.message, input:value }) } },
  async ensureRecordPermission() {
    const setting = await new Promise(resolve => wx.getSetting ? wx.getSetting({ success: resolve, fail: () => resolve({authSetting:{}}) }) : resolve({authSetting:{}}))
    if (setting.authSetting?.['scope.record'] === false) { this.setData({error:'未获得麦克风权限，可以继续使用文字输入。'}); return false }
    if (setting.authSetting?.['scope.record'] !== true && wx.authorize) try { await new Promise((resolve,reject)=>wx.authorize({scope:'scope.record',success:resolve,fail:reject})) } catch (_) { this.setData({error:'未获得麦克风权限，可以继续使用文字输入。'}); return false }
    return true
  },
  async toggleVoice() {
    if (this.data.transcribing) return
    if (this.data.recording) { this.recorder.stop(); return }
    if (!await this.ensureRecordPermission() || !wx.getRecorderManager) return
    if (!this.recorder) {
      this.recorder = wx.getRecorderManager()
      this.recorder.onStart(()=>this.setData({recording:true,error:''}))
      this.recorder.onError(()=>this.setData({recording:false,error:'无法录音，请允许麦克风权限或使用文字输入'}))
      this.recorder.onStop(async result=>{
        this.setData({recording:false})
        if (this.cancelVoice) { this.cancelVoice=false; return }
        this.setData({transcribing:true})
        try {
          const audio = await new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:result.tempFilePath,encoding:'base64',success:r=>resolve(r.data),fail:reject}))
          const transcript = await api.request('mobile-workbench/transcribe','POST',{audio})
          this.setData({input:transcript.text || ''}); this.controller?.voiceDraft(transcript.text || '')
        } catch (error) { this.setData({error:error.message || '识别失败，请使用文字输入'}) }
        finally { this.setData({transcribing:false}) }
      })
    }
    this.cancelVoice=false; this.recorder.start({duration:60000,format:'mp3',sampleRate:16000,numberOfChannels:1,encodeBitRate:48000})
  },
  cancelRecording() { this.cancelVoice=true; this.recorder?.stop() },
  async previewAction(e) { const action = this.data.actions[Number(e.currentTarget.dataset.index)]; if (action) try { await this.controller.preview(action.action || action) } catch (error) { this.setData({error:error.message}) } },
  dismissPreview() { this.controller?.dismissPreview() },
  async confirmAction() { if (!this.data.preview || this.data.confirming) return; try { await this.controller.confirm(this.data.preview.previewId) } catch (error) { this.setData({error:error.message}) } }
})
