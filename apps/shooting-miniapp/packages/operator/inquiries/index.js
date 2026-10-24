const api = require('../../../lib/api')
const { normalizeCustomer, filterInquiries } = require('../../../lib/inquiries')

Page({
  data: { active: 'all', query: '', unreadOnly: false, channel: '', customers: [], visible: [], counts: { confirm: 0, followup: 0, unread: 0, all: 0 }, loading: true, error: '', filterOpen: false },
  onLoad(options) { if (options && ['confirm', 'followup', 'all'].includes(options.tab)) this.setData({ active: options.tab }); this.load() },
  onShow() { if (this.data.customers.length) this.apply() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const result = await api.customers()
      const customers = (result.items || []).map(normalizeCustomer)
      this.setData({ customers, counts: { confirm: customers.filter(item => item.status === 'confirm').length, followup: customers.filter(item => item.status === 'followup').length, unread: customers.filter(item => item.unread).length, all: customers.length }, loading: false })
      this.apply()
    }
    catch (error) { this.setData({ loading: false, error: error.message || '询盘加载失败' }) }
  },
  apply() { this.setData({ visible: filterInquiries(this.data.customers, { status: this.data.active === 'all' ? '' : this.data.active, query: this.data.query, unreadOnly: this.data.unreadOnly, channel: this.data.channel }) }) },
  switchTab(event) { this.setData({ active: event.currentTarget.dataset.tab }); this.apply() },
  inputQuery(event) { this.setData({ query: event.detail.value }); this.apply() },
  toggleFilters() { this.setData({ filterOpen: !this.data.filterOpen }) },
  toggleUnread() { this.setData({ unreadOnly: !this.data.unreadOnly }); this.apply() },
  setChannel(event) { this.setData({ channel: event.currentTarget.dataset.channel || '' }); this.apply() },
  openConversation(event) { wx.navigateTo({ url: '/packages/operator/conversation/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) }) }
})
