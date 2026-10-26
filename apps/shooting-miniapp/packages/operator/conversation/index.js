const api = require('../../../lib/api')
const { normalizeCustomer, messagesOf } = require('../../../lib/inquiries')
const PANELS = { profile: '客户资料', reply: 'AI 推荐回复', quote: '智能报价', search: '会话搜索' }
function languageTarget(value) { const language = String(value || '').toLowerCase(); if (/中文|chinese|简体/.test(language)) return '简体中文'; if (language.includes('西班牙') || language.includes('spanish')) return '西班牙语'; if (language.includes('阿拉伯') || language.includes('arabic')) return '阿拉伯语'; if (language.includes('葡萄牙') || language.includes('portuguese')) return '葡萄牙语'; return '英语' }
function needsChineseTranslation(message) { return message && message.body && !message.note && !/[\u3400-\u9fff]/.test(message.body) }
function quoteForm(draft) { return { productName: draft.productName || '', sku: draft.sku || '', quantity: draft.quantity == null ? '' : String(draft.quantity), unit: draft.unit || '件', material: draft.material || '', unitPrice: draft.unitPrice == null ? '' : String(draft.unitPrice), currency: draft.currency || 'CNY', leadTime: draft.leadTime || '', deliveryDate: draft.deliveryDate || '', destination: draft.destination || '', incoterm: draft.incoterm || '', packaging: draft.packaging || '', drawingVersion: draft.drawingVersion || '', paymentTerms: draft.paymentTerms || '', validityDays: String(draft.validityDays || 15) } }

Page({
  data: { customerId: '', customer: null, messages: [], draft: '', translatedDraft: '', draftChineseNote: '', targetLanguage: '英语', translating: false, translatedFrom: '', translationError: '', recommendationError: '', recommendations: [], recommending: false, quoteDraft: null, quoteLoading: false, quoteError: '', quoteCatalog: [], quoteForm: {}, quoteEditing: false, quotePreview: '', quoteSending: false, loading: true, sending: false, error: '', plusOpen: false, panel: '', panelTitle: '', search: '', searchResults: [], scrollTo: '', safeBottom: 0, statusBarHeight: 44 },
  onLoad(options) { const system = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); this.setData({ customerId: decodeURIComponent(options.id || ''), statusBarHeight: Number(system.statusBarHeight) || 44, safeBottom: system.safeArea ? Math.max(0, system.screenHeight - system.safeArea.bottom) : 0 }); this.load() },
  async load() { try { const result = await api.customers(); const raw = (result.items || []).find(item => String(item.id) === this.data.customerId); if (!raw) throw new Error('没有找到这个客户会话'); const customer = normalizeCustomer(raw); const messages = messagesOf(raw); const targetLanguage = languageTarget(customer.language); this.setData({ customer, messages, draft: customer.pendingDraft || '', targetLanguage, loading: false, scrollTo: messages.length ? 'message-' + (messages.length - 1) : '' }); this.fillMessageTranslations(messages, targetLanguage, customer.id); if (customer.pendingDraft) this.scheduleTranslation(customer.pendingDraft); wx.setNavigationBarTitle({ title: customer.name }) } catch (error) { this.setData({ error: error.message, loading: false }) } },
  async fillMessageTranslations(messages, sourceLanguage, customerId) { const translated = await Promise.all(messages.map(async message => { if (!needsChineseTranslation(message)) return message; try { const result = await api.translateText(message.body, sourceLanguage, '简体中文', customerId); return { ...message, note: String(result.translatedText || '').trim() } } catch (_) { return message } })); if (!this.disposed && this.data.customerId === customerId) { const byId = new Map(translated.map(message => [message.id, message])); this.setData({ messages: this.data.messages.map(message => byId.get(message.id) || message) }) } },
  onUnload() { this.disposed = true; clearTimeout(this.translationTimer); this.translationEpoch = (this.translationEpoch || 0) + 1; this.recommendationEpoch = (this.recommendationEpoch || 0) + 1 },
  back() { const pages = getCurrentPages(); if (pages.length > 1) wx.navigateBack(); else wx.redirectTo({ url: '/packages/operator/home/index' }) },
  inputDraft(event) { const draft = event.detail.value; this.setData({ draft, translatedDraft: '', draftChineseNote: '' }); this.scheduleTranslation(draft) },
  scheduleTranslation(draft) {
    clearTimeout(this.translationTimer)
    const ticket = this.translationEpoch = (this.translationEpoch || 0) + 1
    const body = String(draft || '').trim()
    const required = /[\u3400-\u9fff]/.test(body) && this.data.targetLanguage !== '简体中文'
    this.setData({ translating: required, translatedDraft: '', translatedFrom: '', translationError: '' })
    if (required) this.translationTimer = setTimeout(() => this.translateDraft(body, ticket), 550)
  },
  async translateDraft(body, ticket = this.translationEpoch || 0) {
    this.setData({ translating: true, translationError: '' })
    try {
      const result = await api.translateCustomerReply(body, this.data.targetLanguage, this.data.customerId)
      const text = String(result.translatedText || '').trim()
      if (!text) throw new Error('翻译没有返回有效译文')
      if (this.disposed || ticket !== (this.translationEpoch || 0) || this.data.draft.trim() !== body) return
      this.setData({ translatedDraft: text, translatedFrom: body, translating: false })
    } catch (error) {
      if (!this.disposed && ticket === (this.translationEpoch || 0) && this.data.draft.trim() === body) this.setData({ translating: false, translatedDraft: '', translatedFrom: '', translationError: error.message || '翻译暂不可用，请重试后再发送' })
    }
  },
  retryTranslation() { if (!this.data.sending) this.scheduleTranslation(this.data.draft) },
  togglePlus() { this.setData({ plusOpen: !this.data.plusOpen, panel: '' }) },
  openPanel(event) { const panel = event.currentTarget.dataset.panel; this.setData({ panel, panelTitle: PANELS[panel], plusOpen: false, search: '', searchResults: [] }); if (panel === 'reply') this.loadRecommendations(); if (panel === 'quote') this.loadQuote() },
  openProfile() { this.setData({ panel: 'profile', panelTitle: PANELS.profile, plusOpen: false }) },
  closePanel() { this.setData({ panel: '' }) },
  useReply(event) { const selected = this.data.recommendations[Number(event.currentTarget.dataset.index)]; const draft = selected ? selected.body : ''; this.setData({ draft, translatedDraft: '', draftChineseNote: selected ? selected.translation : '', panel: '' }); this.scheduleTranslation(draft) },
  async loadRecommendations() {
    if (!this.data.customer || this.data.recommending) return
    const ticket = this.recommendationEpoch = (this.recommendationEpoch || 0) + 1
    this.setData({ recommending: true, recommendations: [], recommendationError: '' })
    const customer = this.data.customer.raw || this.data.customer
    try {
      const results = await Promise.allSettled(['Write a concise, direct and professional reply.', 'Write a warmer, more proactive alternative reply with a clear next step.'].map(style => api.recommendCustomerReply(customer, style)))
      const seen = new Set(), recommendations = []
      for (const result of results) {
        if (result.status !== 'fulfilled') continue
        const value = result.value
        if (value.generationSource === 'degraded' || ['failed', 'blocked', 'pending', 'degraded'].includes(value.status)) continue
        const body = String(value.draft || (Array.isArray(value.messages) ? value.messages.join(' ') : '') || '').trim()
        if (!body || seen.has(body)) continue
        seen.add(body)
        let translation = String(value.translatedDraft || '').trim()
        if (!translation) try { translation = String((await api.translateText(body, this.data.targetLanguage, '简体中文', this.data.customerId)).translatedText || '').trim() } catch (_) { /* The real reply remains available with its missing translation stated. */ }
        recommendations.push({ body, translation })
      }
      if (!recommendations.length) throw new Error('推荐回复暂未生成，请稍后重试；不会使用固定话术代替。')
      if (!this.disposed && ticket === this.recommendationEpoch) this.setData({ recommendations, recommendationError: recommendations.length < 2 ? '本次只生成了一个有效回复。' : '' })
    } catch (error) {
      if (!this.disposed && ticket === this.recommendationEpoch) this.setData({ recommendations: [], recommendationError: error.message || '推荐回复暂不可用，请重试' })
    } finally { if (!this.disposed && ticket === this.recommendationEpoch) this.setData({ recommending: false }) }
  },
  async loadQuote() { if (!this.data.customer || this.data.quoteLoading) return; this.setData({ quoteLoading: true, quoteError: '', quotePreview: '' }); const customer = this.data.customer.raw || this.data.customer; try { const [availability, latest, catalog] = await Promise.all([api.quoteAvailability(), api.latestCustomerQuote(customer.id), api.quoteCatalog()]); if (!availability.enabled) throw new Error('当前账号尚未开放智能报价'); const draft = latest.draft || (await api.createCustomerQuote(customer, false)).draft; this.setData({ quoteDraft: draft, quoteForm: quoteForm(draft), quoteCatalog: catalog.items || [], quoteLoading: false, quoteEditing: false }) } catch (error) { this.setData({ quoteLoading: false, quoteError: error.message || '报价能力暂时不可用' }) } },
  async regenerateQuote(event) { if (!this.data.customer || this.data.quoteLoading) return; this.setData({ quoteLoading: true, quoteError: '', quotePreview: '' }); try { const result = await api.createCustomerQuote(this.data.customer.raw || this.data.customer, Boolean(event && event.currentTarget.dataset.clone)); this.setData({ quoteDraft: result.draft, quoteForm: quoteForm(result.draft), quoteLoading: false, quoteEditing: false }); wx.showToast({ title: '报价草稿已更新', icon: 'success' }) } catch (error) { this.setData({ quoteLoading: false, quoteError: error.message || '报价生成失败' }) } },
  toggleQuoteEdit() { if (!this.data.quoteDraft) return; this.setData({ quoteEditing: !this.data.quoteEditing, quoteForm: quoteForm(this.data.quoteDraft), quotePreview: '' }) },
  inputQuoteField(event) { this.setData({ ['quoteForm.' + event.currentTarget.dataset.field]: event.detail.value }) },
  selectQuoteCatalog(event) { const product = this.data.quoteCatalog[Number(event.detail.value)]; if (!product) return; this.setData({ 'quoteForm.productName': product.name || '', 'quoteForm.sku': product.sku || '', 'quoteForm.material': product.material || '', 'quoteForm.unit': product.unit || '件', 'quoteForm.unitPrice': product.unitPrice == null ? '' : String(product.unitPrice), 'quoteForm.currency': product.currency || 'CNY', 'quoteForm.leadTime': product.leadTime || '' }) },
  async saveQuote() { const draft = this.data.quoteDraft; if (!draft || this.data.quoteLoading) return; const form = this.data.quoteForm; const patch = { ...form, quantity: Number(form.quantity), unitPrice: Number(form.unitPrice), validityDays: Number(form.validityDays) }; this.setData({ quoteLoading: true, quoteError: '' }); try { const result = await api.updateCustomerQuote(draft.id, draft.revision, patch); this.setData({ quoteDraft: result.draft, quoteForm: quoteForm(result.draft), quoteLoading: false, quoteEditing: false }); wx.showToast({ title: '报价已保存', icon: 'success' }) } catch (error) { this.setData({ quoteLoading: false, quoteError: error.message || '报价保存失败' }) } },
  async confirmQuote() { const draft = this.data.quoteDraft; if (!draft || this.data.quoteLoading) return; this.setData({ quoteLoading: true, quoteError: '' }); try { const result = await api.confirmCustomerQuote(draft.id, draft.revision); this.setData({ quoteDraft: result.draft, quoteForm: quoteForm(result.draft), quoteLoading: false }); wx.showToast({ title: '已人工确认', icon: 'success' }) } catch (error) { this.setData({ quoteLoading: false, quoteError: error.message || '报价确认失败' }) } },
  insertQuoteQuestions() { const questions = (this.data.quoteDraft && this.data.quoteDraft.clarificationQuestions || []).join('\n'); if (!questions) return; this.setData({ draft: questions, translatedDraft: '', draftChineseNote: '', panel: '' }); this.scheduleTranslation(questions) },
  async insertQuoteReply() { const quote = this.data.quoteDraft; if (!quote || this.data.quoteLoading) return; this.setData({ quoteLoading: true }); try { const result = await api.customerQuoteReply(quote.id); this.setData({ draft: result.reply || '', translatedDraft: '', draftChineseNote: '', panel: '', quoteLoading: false }); this.scheduleTranslation(result.reply || '') } catch (error) { this.setData({ quoteLoading: false, quoteError: error.message || '报价回复生成失败' }) } },
  async previewQuote() { const quote = this.data.quoteDraft; if (!quote || this.data.quoteLoading) return; this.setData({ quoteLoading: true, quoteError: '' }); try { const filePath = await api.customerQuoteCard(quote.id); this.setData({ quotePreview: filePath, quoteLoading: false }) } catch (error) { this.setData({ quoteLoading: false, quoteError: error.message || '报价卡片生成失败' }) } },
  closeQuotePreview() { this.setData({ quotePreview: '' }) },
  async sendQuoteCard() { const quote = this.data.quoteDraft; if (!quote || this.data.quoteSending) return; this.setData({ quoteSending: true, quoteError: '' }); try { const result = await api.sendCustomerQuoteCard(quote.id); this.setData({ quoteDraft: result.draft, quoteSending: false, quotePreview: '' }); wx.showToast({ title: '报价卡已发送', icon: 'success' }) } catch (error) { this.setData({ quoteSending: false, quoteError: error.message || '报价卡发送失败' }) } },
  inputSearch(event) { const search = event.detail.value; const key = search.trim().toLowerCase(); this.setData({ search, searchResults: key ? this.data.messages.filter(item => item.body.toLowerCase().includes(key)) : [] }) },
  async send() {
    const original = this.data.draft.trim()
    if (!original || this.data.sending || this.data.translating) return
    const requiresTranslation = /[\u3400-\u9fff]/.test(original) && this.data.targetLanguage !== '简体中文'
    if (requiresTranslation && (!this.data.translatedDraft.trim() || this.data.translatedFrom !== original || this.data.translationError)) {
      this.setData({ translationError: '译文尚未确认，请重试翻译后再发送' }); return
    }
    const body = requiresTranslation ? this.data.translatedDraft.trim() : original
    if (this.data.customer?.readOnly) { wx.showModal({ title: '会话只读', content: '这条历史会话不能发送新消息。', showCancel: false }); return }
    const requestId = 'mobile_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9)
    this.setData({ sending: true })
    try {
      let note = requiresTranslation ? original : this.data.draftChineseNote.trim()
      if (!note && !/[\u3400-\u9fff]/.test(body)) try { note = String((await api.translateText(body, this.data.targetLanguage, '简体中文', this.data.customerId)).translatedText || '').trim() } catch (_) { /* A missing Chinese gloss never changes the explicitly composed outgoing body. */ }
      const receipt = await api.sendCustomerMessage(this.data.customerId, body, requestId)
      const messages = this.data.messages.concat({ id: requestId, body, note, mine: true, time: '刚刚', timestamp: Date.now() })
      if (this.disposed) return
      this.setData({ messages, draft: '', translatedDraft: '', translatedFrom: '', translationError: '', draftChineseNote: '', sending: false, scrollTo: 'message-' + (messages.length - 1) })
      wx.showToast({ title: receipt.localPreview ? '已写入本地会话' : '已发送', icon: 'success' })
    } catch (error) { if (!this.disposed) { this.setData({ sending: false }); wx.showModal({ title: '发送未完成', content: error.message || '请稍后重试', showCancel: false }) } }
  }
})
