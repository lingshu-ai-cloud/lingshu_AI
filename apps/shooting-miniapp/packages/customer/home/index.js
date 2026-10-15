const api = require('../../../lib/api')
const customerHome = require('../../../lib/customer-service-home')

Page({
  data: {
    organization: '灵枢工作台', edition: '客服版', statusBarHeight: 44,
    activeMetric: 'reply', loading: true, loaded: false, error: '',
    counts: { pendingReply: '—', replied: '—', pendingFollowup: '—', followedUp: '—', highIntent: '—', converted: '—' },
    pendingReply: [], pendingFollowup: [], highIntent: [], visible: []
  },
  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.setData({ statusBarHeight: Number(info.statusBarHeight) || 44 })
    this.restore()
  },
  onShow() { if (this.data.loaded && api.token()) this.refresh() },
  async restore() {
    if (!api.token()) { wx.redirectTo({ url: '/pages/workbench/index' }); return }
    try { await api.me(); await this.refresh() } catch (error) { this.setData({ loading: false, error: error.message }) }
  },
  async refresh() {
    if (this.refreshing) return
    this.refreshing = true; this.setData({ loading: true, error: '' })
    try {
      const result = await api.customers()
      const view = customerHome.project(result.items || [])
      this.setData({ ...view, visible: view.pendingReply, loading: false, loaded: true })
    } catch (error) { this.setData({ loading: false, error: error.message }) }
    finally { this.refreshing = false }
  },
  openEdition() {
    wx.showActionSheet({ itemList: ['运营版', '客服版'], success: result => {
      if (result.tapIndex === 0) wx.redirectTo({ url: '/packages/operator/home/index' })
    } })
  },
  openMetric(event) {
    const activeMetric = event.currentTarget.dataset.key
    const key = activeMetric === 'reply' ? 'pendingReply' : activeMetric === 'followup' ? 'pendingFollowup' : 'highIntent'
    this.setData({ activeMetric, visible: this.data[key] || [] })
  },
  openConversation(event) { wx.navigateTo({ url: '/packages/operator/conversation/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) }) },
  openAll() {
    const tab = this.data.activeMetric === 'followup' ? 'followup' : 'confirm'
    wx.navigateTo({ url: '/packages/operator/inquiries/index?tab=' + tab })
  }
})
