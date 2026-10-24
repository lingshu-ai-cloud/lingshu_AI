const api = require('../../lib/api')
const assistant = require('../../lib/assistant')
const feed = require('../../lib/lingxiaoshu-feed')
const workbench = require('../../lib/workbench')

const capabilities = [
  { id: 'tasks', icon: '✓', title: '任务与审批', prompt: '本周任务进展怎么样？' },
  { id: 'content', icon: '✎', title: '内容生产', prompt: '制作一条产品内容需要先准备哪些信息？' },
  { id: 'customers', icon: '◎', title: '客户跟进', prompt: '本周有效询盘有多少？' },
  { id: 'shooting', icon: '▣', title: '素材拍摄', prompt: '待拍素材要先核对哪些要求？' },
]

Component({
  properties: {
    autoOpenDaily: { type: Boolean, value: false, observer: 'autoOpenChanged' },
    overview: { type: Object, value: null, observer: 'workDataChanged' },
    queue: { type: Object, value: null, observer: 'workDataChanged' }
  },
  data: {
    visible: false, booting: false, loading: false, sending: false, confirming: false, showWelcome: false,
    error: '', input: '', messages: [], suggestions: [], briefing: null, briefingLoaded: false,
    capabilities, showCapabilities: false, composerMode: 'text', recording: false, transcribing: false,
    actions: [], preview: null, receipts: [], anchor: ''
  },
  lifetimes: {
    attached() { if (this.properties.autoOpenDaily) this.ensureDailyOpen() },
    detached() { this.invalidateVoice(); this.controller?.dispose() }
  },
  pageLifetimes: {
    show() { if (this.data.visible) { this.controller?.poll(); this.loadNotices() } },
    hide() { this.invalidateVoice(); this.controller?.pause() }
  },
  methods: {
    autoOpenChanged(value) { if (value) this.ensureDailyOpen() },
    workDataChanged() {
      if (this.properties.overview) this.setData({ briefing: feed.projectBriefing(this.properties.overview, this.properties.queue || {}), briefingLoaded: Boolean(this.properties.queue) })
    },
    async ensureProfile() {
      if (this.scope) return this.scope
      if (!api.token()) return ''
      const profile = await api.me()
      const user = profile.user || {}
      this.scope = `${String(user.tenantId || user.tenant_id || '')}:${String(user.id || user.email || '')}:unified`
      return this.scope
    },
    async ensureDailyOpen() {
      try {
        const scope = await this.ensureProfile()
        if (!scope) return
        const key = feed.dailyStorageKey(scope)
        const today = feed.shanghaiDay()
        if (wx.getStorageSync(key) === today) return
        wx.setStorageSync(key, today)
        await this.open()
      } catch (error) { this.setData({ error: error.message || '灵小枢暂时无法打开' }) }
    },
    async bootstrap() {
      if (this.controller || this.data.booting) return
      this.setData({ booting: true, error: '' })
      try {
        const scope = await this.ensureProfile()
        if (!scope) return
        this.controller = assistant.createAssistantController({
          request: (path, method, body) => api.request(path, method, body),
          contextMode: 'operator',
          storage: { get: key => wx.getStorageSync(key), set: (key, value) => wx.setStorageSync(key, value) },
          onChange: state => {
            const messages = (state.messages || []).map(message => ({ ...message, content: message.text || message.content || '' }))
            const welcomeKey = state.sessionId ? feed.welcomeStorageKey(scope, state.sessionId) : ''
            const welcomeRecorded = Boolean(welcomeKey) && wx.getStorageSync(welcomeKey) === true
            const showWelcome = Boolean(welcomeKey) && (welcomeRecorded || !messages.length)
            if (showWelcome && !welcomeRecorded) wx.setStorageSync(welcomeKey, true)
            this.setData({
              messages, showWelcome,
              suggestions: (state.suggestions || []).map(item => typeof item === 'string' ? item : item.label),
              loading: Boolean(state.loading), sending: Boolean(state.sending), confirming: Boolean(state.confirming),
              input: this.capabilitySending ? this.capabilityDraft : state.input || '', actions: state.actions || [], preview: state.preview || null, receipts: state.receipts || [],
              anchor: messages.length ? messages[messages.length - 1].id : '',
              ...(state.error ? { error: state.error } : {})
            })
          }
        })
        await this.controller.restore(scope)
      } finally { this.setData({ booting: false }) }
    },
    async loadNotices() {
      if (!api.token()) return
      try {
        const [overview, queue] = await Promise.all([
          api.request('mobile-workbench/overview?weekStart=' + encodeURIComponent(workbench.week().start)),
          api.request('mobile-workbench/queue').catch(() => ({}))
        ])
        const projectedQueue = this.properties.queue
          ? {
              ...queue,
              matters: [
                ...(Array.isArray(queue.matters) ? queue.matters : []),
                ...(Array.isArray(this.properties.queue.matters) ? this.properties.queue.matters : [])
              ],
              urgentMatters: this.properties.queue.urgentMatters || []
            }
          : queue
        this.setData({ briefing: feed.projectBriefing(overview, projectedQueue), briefingLoaded: true, error: '' })
      } catch (error) {
        this.setData({ briefingLoaded: false, error: error.message || '工作通知暂未同步' })
      }
    },
    async open() {
      if (!api.token()) { wx.redirectTo({ url: '/pages/workbench/index' }); return }
      this.setData({ visible: true, showCapabilities: false, composerMode: 'text' })
      try {
        await Promise.all([this.bootstrap(), this.loadNotices()])
        this.controller?.poll()
      } catch (error) { this.setData({ error: error.message || '助手会话暂时无法恢复' }) }
    },
    close() { this.invalidateVoice(); this.setData({ visible: false, showCapabilities: false, composerMode: 'text' }); this.controller?.pause(); this.triggerEvent('close') },
    stop() {},
    toggleCapabilities() { this.setData({ showCapabilities: !this.data.showCapabilities }) },
    async selectCapability(event) {
      const capability = capabilities.find(item => item.id === event.currentTarget.dataset.id)
      if (!capability || !this.controller || this.data.sending || this.capabilitySending) return
      const controller = this.controller
      this.capabilitySending = true
      this.capabilityDraft = this.data.input || ''
      this.setData({ showCapabilities: false, error: '' })
      try { await controller.send(capability.prompt) }
      catch (error) { if (this.controller === controller) this.setData({ error: error.message || '问题暂时无法发送' }) }
      finally {
        if (this.controller === controller) {
          const draft = this.capabilityDraft || ''
          this.capabilitySending = false
          this.capabilityDraft = ''
          controller.setInput(draft)
        }
      }
    },
    inputText(event) { const input = event.detail.value; if (this.capabilitySending) this.capabilityDraft = input; this.setData({ input, showCapabilities: false }); if (!this.capabilitySending) this.controller?.setInput(input) },
    async send() {
      const input = this.data.input.trim()
      if (!input || this.data.sending || this.capabilitySending) return
      this.setData({ showCapabilities: false })
      try { await this.controller?.send(input) } catch (error) { this.setData({ error: error.message, input }) }
    },
    switchToVoice() { this.setData({ composerMode: 'voice', showCapabilities: false, error: '' }) },
    switchToText() { if (this.data.recording) this.cancelRecording(); this.setData({ composerMode: 'text' }) },
    invalidateVoice() {
      this.voiceTicket = (this.voiceTicket || 0) + 1
      this.voiceHolding = false
      this.stopVoiceAfterStart = true
      this.cancelVoice = true
      if (this.data.recording && this.recorder) this.recorder.stop()
      this.setData({ recording: false, transcribing: false })
    },
    async ensureRecordPermission() {
      const settings = await new Promise(resolve => wx.getSetting ? wx.getSetting({ success: resolve, fail: () => resolve({ authSetting: {} }) }) : resolve({ authSetting: {} }))
      if (settings.authSetting?.['scope.record'] === true) return true
      if (settings.authSetting?.['scope.record'] === false) {
        this.setData({ error: '麦克风权限已关闭，可在小程序设置中开启，或继续使用文字输入。', composerMode: 'text' })
        return false
      }
      if (!wx.authorize) { this.setData({ error: '当前微信版本无法申请麦克风权限，请使用文字输入。', composerMode: 'text' }); return false }
      try { await new Promise((resolve, reject) => wx.authorize({ scope: 'scope.record', success: resolve, fail: reject })); return true }
      catch (_) { this.setData({ error: '未获得麦克风权限，请使用文字输入。', composerMode: 'text' }); return false }
    },
    holdVoiceStart(event) {
      if (this.data.recording || this.data.transcribing || this.data.sending || !this.data.visible) return
      this.voiceStartY = event.touches?.[0]?.clientY || 0
      this.voiceHolding = true
      this.stopVoiceAfterStart = false
      this.startVoice()
    },
    holdVoiceMove(event) {
      const y = event.touches?.[0]?.clientY || this.voiceStartY
      if (this.voiceHolding && this.voiceStartY - y > 60) this.cancelRecording()
    },
    holdVoiceEnd() {
      this.voiceHolding = false
      if (this.data.recording && this.recorder) this.recorder.stop()
      else this.stopVoiceAfterStart = true
    },
    cancelRecording() {
      this.voiceHolding = false
      this.stopVoiceAfterStart = true
      this.cancelVoice = true
      if (this.data.recording && this.recorder) this.recorder.stop()
    },
    async startVoice() {
      const ticket = this.voiceTicket = (this.voiceTicket || 0) + 1
      const accountToken = api.token()
      if (!accountToken) { this.setData({ error: '登录状态已失效，请重新登录后使用语音输入。', composerMode: 'text' }); return }
      if (!await this.ensureRecordPermission() || ticket !== this.voiceTicket || !this.data.visible || api.token() !== accountToken) return
      if (!wx.getRecorderManager) { this.setData({ error: '当前设备不支持录音，请使用文字输入。', composerMode: 'text' }); return }
      if (!this.recorder) {
        this.recorder = wx.getRecorderManager()
        this.recorder.onStart(() => {
          if (this.recordingTicket !== this.voiceTicket || !this.data.visible) return
          this.setData({ recording: true, error: '' })
          if (this.stopVoiceAfterStart || !this.voiceHolding) { this.cancelVoice = true; this.recorder.stop() }
        })
        this.recorder.onError(() => {
          if (this.recordingTicket === this.voiceTicket) this.setData({ recording: false, transcribing: false, composerMode: 'text', error: '无法录音，请检查麦克风权限或使用文字输入。' })
        })
        this.recorder.onStop(async result => {
          const currentTicket = this.recordingTicket
          const currentToken = this.recordingToken
          if (currentTicket !== this.voiceTicket || !this.data.visible || api.token() !== currentToken) return
          this.setData({ recording: false })
          if (this.cancelVoice) { this.cancelVoice = false; return }
          if (!result.tempFilePath) { this.setData({ error: '未取得录音文件，请重试或使用文字输入。' }); return }
          this.setData({ transcribing: true, error: '' })
          try {
            const audio = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: result.tempFilePath, encoding: 'base64', success: res => resolve(res.data), fail: reject }))
            if (currentTicket !== this.voiceTicket || !this.data.visible || api.token() !== currentToken) return
            const transcript = await api.request('mobile-workbench/transcribe', 'POST', { audio, audioSeconds: Math.max(1, Math.round(Number(result.duration || 0) / 1000)) })
            if (currentTicket !== this.voiceTicket || !this.data.visible || api.token() !== currentToken) return
            const text = String(transcript.text || '').trim()
            if (!text) throw new Error('未识别到文字，请重试或使用文字输入。')
            this.controller?.voiceDraft(text)
            this.setData({ input: text, composerMode: 'text' })
          } catch (error) {
            if (currentTicket === this.voiceTicket && this.data.visible) this.setData({ error: error.message || '识别失败，请使用文字输入。', composerMode: 'text' })
          } finally {
            if (currentTicket === this.voiceTicket && this.data.visible) this.setData({ transcribing: false })
          }
        })
      }
      this.recordingTicket = ticket
      this.recordingToken = accountToken
      this.cancelVoice = false
      try { this.recorder.start({ duration: 20000, format: 'mp3', sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 32000 }) }
      catch (error) { this.setData({ error: error.message || '录音未启动，请使用文字输入。', composerMode: 'text' }) }
    },
    async previewAction(event) {
      const action = this.data.actions[Number(event.currentTarget.dataset.index)]
      if (action) try { await this.controller?.preview(action.action || action) } catch (error) { this.setData({ error: error.message }) }
    },
    dismissPreview() { this.controller?.dismissPreview() },
    async confirmAction() { if (this.data.preview && !this.data.confirming) await this.controller?.confirm(this.data.preview.previewId) }
  }
})
