const api = require('../../../lib/api')
const { normalizeCustomer, messagesOf } = require('../../../lib/inquiries')
const PANELS = { profile: '客户资料', reply: '回复与报价', media: '文件和媒体', search: '会话搜索' }

Page({
  data: { customerId: '', customer: null, messages: [], draft: '', loading: true, sending: false, error: '', plusOpen: false, panel: '', panelTitle: '', search: '', searchResults: [], scrollTo: '', safeBottom: 0 },
  onLoad(options) { const system = wx.getSystemInfoSync(); this.setData({ customerId: decodeURIComponent(options.id || ''), safeBottom: system.safeArea ? Math.max(0, system.screenHeight - system.safeArea.bottom) : 0 }); this.load() },
  async load() { try { const result = await api.customers(); const raw = (result.items || []).find(item => String(item.id) === this.data.customerId); if (!raw) throw new Error('没有找到这个客户会话'); const customer = normalizeCustomer(raw); const messages = messagesOf(raw); this.setData({ customer, messages, draft: customer.pendingDraft || '', loading: false, scrollTo: messages.length ? 'message-' + (messages.length - 1) : '' }); wx.setNavigationBarTitle({ title: customer.name }) } catch (error) { this.setData({ error: error.message, loading: false }) } },
  back() { wx.navigateBack() },
  inputDraft(event) { this.setData({ draft: event.detail.value }) },
  togglePlus() { this.setData({ plusOpen: !this.data.plusOpen, panel: '' }) },
  openPanel(event) { const panel = event.currentTarget.dataset.panel; this.setData({ panel, panelTitle: PANELS[panel], plusOpen: false, search: '', searchResults: [] }) },
  closePanel() { this.setData({ panel: '' }) },
  useReply(event) { this.setData({ draft: event.currentTarget.dataset.text, panel: '' }) },
  inputSearch(event) { const search = event.detail.value; const key = search.trim().toLowerCase(); this.setData({ search, searchResults: key ? this.data.messages.filter(item => item.body.toLowerCase().includes(key)) : [] }) },
  chooseMedia() { wx.chooseMessageFile({ count: 1, type: 'all', success: result => wx.showToast({ title: result.tempFiles[0].name, icon: 'none' }) }) },
  async send() { const body = this.data.draft.trim(); if (!body || this.data.sending) return; const requestId = 'mobile_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9); this.setData({ sending: true }); try { await api.sendCustomerMessage(this.data.customerId, body, requestId); const messages = this.data.messages.concat({ id: requestId, body, mine: true, time: '刚刚', timestamp: Date.now() }); this.setData({ messages, draft: '', sending: false, scrollTo: 'message-' + (messages.length - 1) }); wx.showToast({ title: '已发送', icon: 'success' }) } catch (error) { this.setData({ sending: false }); wx.showModal({ title: '发送未完成', content: error.message || '请稍后重试', showCancel: false }) } }
})
