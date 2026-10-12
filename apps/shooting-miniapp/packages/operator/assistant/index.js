const api = require('../../../lib/api')
const assistant = require('../../../lib/assistant')

Page({
  data: { loading: true, sending: false, error: '', messages: [], suggestions: [], input: '', anchor: '', preview: null, receipts: [], actions: [], confirming: false },
  async onLoad() {
    if (!api.token()) { wx.redirectTo({ url: '/pages/workbench/index' }); return }
    try {
      const profile = await api.me(); const user = profile.user || {}
      this.scope = String(user.tenantId || user.tenant_id || '') + ':' + String(user.id || user.email || '')
      this.createController(); await this.controller.restore(this.scope)
    } catch (error) { this.setData({ loading: false, error: error.message }) }
  },
  onShow() { if (this.controller) this.controller.poll() },
  onHide() { if (this.controller) this.controller.pause() },
  onUnload() { if (this.controller) this.controller.dispose() },
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
  async previewAction(e) { const action = this.data.actions[Number(e.currentTarget.dataset.index)]; if (action) try { await this.controller.preview(action.action || action) } catch (error) { this.setData({error:error.message}) } },
  dismissPreview() { this.controller?.dismissPreview() },
  async confirmAction() { if (!this.data.preview || this.data.confirming) return; try { await this.controller.confirm(this.data.preview.previewId) } catch (error) { this.setData({error:error.message}) } }
})
