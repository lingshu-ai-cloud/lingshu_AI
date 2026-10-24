const api = require('../../../lib/api')
const customerHome = require('../../../lib/customer-service-home')
const model = require('../../../lib/workbench')

Page({
  data: {
    organization: '灵枢工作台', edition: '客服版', statusBarHeight: 44,
    activeMetric: 'reply', loading: true, loaded: false, error: '',
    week: model.week(), selectedDay: model.day(new Date().toISOString()), days: [], calendarExpanded: false,
    counts: { pendingReply: '—', replied: '—', pendingFollowup: '—', followedUp: '—', highIntent: '—', converted: '—' },
    pendingReply: [], pendingFollowup: [], highIntent: [], visible: []
  },
  onLoad() {
    wx.redirectTo({ url: '/packages/operator/home/index' })
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
      this.customers = result.items || []
      this.applyWeekView()
      this.setData({ loading: false, loaded: true })
    } catch (error) { this.setData({ loading: false, error: error.message }) }
    finally { this.refreshing = false }
  },
  customerDate(item) { return String(item.lastActiveAt || item.updatedAt || item.updated_at || item.createdAt || item.created_at || '').slice(0, 10) },
  applyWeekView() {
    const weekItems = (this.customers || []).filter(item => { const date = this.customerDate(item); return !date || (date >= this.data.week.start && date <= this.data.week.end) })
    const view = customerHome.project(weekItems)
    const key = this.data.activeMetric === 'reply' ? 'pendingReply' : this.data.activeMetric === 'followup' ? 'pendingFollowup' : 'highIntent'
    this.weekView = view
    this.setData({ ...view, visible: view[key] || [] }); this.updateDays()
  },
  updateDays() {
    const customers = this.customers || []
    this.setData({ days: this.data.week.days.map(day => ({ ...day, selected: day.date === this.data.selectedDay, count: customers.filter(item => this.customerDate(item) === day.date).length })) })
  },
  changeWeek(e) {
    this.weekOffset = (this.weekOffset || 0) + Number(e.currentTarget.dataset.offset)
    const week = model.week(Date.now(), this.weekOffset)
    this.setData({ week, selectedDay: week.start }); this.applyWeekView()
  },
  toggleCalendar() { this.setData({ calendarExpanded: !this.data.calendarExpanded }) },
  selectDay(e) { this.setData({ selectedDay: e.currentTarget.dataset.date }); this.updateDays() },
  openEdition() {
    wx.showActionSheet({ itemList: ['运营版', '客服版'], success: result => {
      if (result.tapIndex === 0) wx.redirectTo({ url: '/packages/operator/home/index' })
    } })
  },
  openMetric(event) {
    const activeMetric = event.currentTarget.dataset.key
    const key = activeMetric === 'reply' ? 'pendingReply' : activeMetric === 'followup' ? 'pendingFollowup' : 'highIntent'
    this.setData({ activeMetric, visible: (this.weekView && this.weekView[key]) || this.data[key] || [] })
  },
  openConversation(event) { wx.navigateTo({ url: '/packages/operator/conversation/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) }) },
  openAll() {
    const tab = this.data.activeMetric === 'followup' ? 'followup' : 'confirm'
    wx.navigateTo({ url: '/packages/operator/inquiries/index?tab=' + tab })
  }
})
