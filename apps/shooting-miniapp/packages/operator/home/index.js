const api = require('../../../lib/api')
const model = require('../../../lib/workbench')
const operatorHome = require('../../../lib/operator-home')
const customerHome = require('../../../lib/customer-service-home')
const unifiedHome = require('../../../lib/unified-home')
const { customerActivityDate } = require('../../../lib/inquiries')

Page({
  data: {
    loading: true, loaded: false, error: '', organization: '灵枢工作台',
    statusBarHeight: 24, navBarHeight: 48, headerRightInset: 190,
    week: model.week(), selectedDay: model.day(new Date().toISOString()), days: [], calendarExpanded: false,
    metrics: [], metricGroups: [], urgentMatters: [], focusMatters: [], customerTodos: [], customerUnreadCount: 0, todayAcceptance: [], todayShots: [], todayGroups: [], todayTotal: 0, expandedGroup: '', assistantOverview: null, assistantQueue: null
  },
  onLoad(options = {}) {
    this.openAssistantOnReady = options.assistant === '1'
    this.configureHeader()
    this.updateDays()
    this.restore()
  },
  onReady() { if (this.openAssistantOnReady) this.openAssistant() },
  onShow() { if (this.data.loaded && api.token()) this.refresh() },
  configureHeader() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = Number(info.statusBarHeight) || 24
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
    const gap = menu ? Math.max(4, Number(menu.top) - statusBarHeight) : 6
    const navBarHeight = menu ? Number(menu.height) + gap * 2 : 48
    const headerRightInset = menu ? Math.max(168, Number(info.windowWidth || 375) - Number(menu.left) + 8) : 190
    this.setData({ statusBarHeight, navBarHeight, headerRightInset })
  },
  async restore() {
    if (!api.token()) { wx.redirectTo({ url: '/pages/workbench/index' }); return }
    try { this.profile = await api.me(); await this.refresh() }
    catch (error) { this.setData({ loading: false, error: error.message }) }
  },
  customerDate(item) { return customerActivityDate(item) },
  project(overview, queue, customers) {
    const operator = operatorHome.project(this.profile, overview, queue, this.data.selectedDay)
    const weekCustomers = (customers || []).filter(item => { const date = this.customerDate(item); return !date || (date >= this.data.week.start && date <= this.data.week.end) })
    const customer = Array.isArray(customers) ? customerHome.project(weekCustomers) : { counts: {} }
    const combined = unifiedHome.project(operator, customer)
    combined.todayAcceptance = operator.todayAcceptance.map(item => ({ ...item, videoUrl: item.videoUrl ? api.assetUrl(item.videoUrl) : '', thumbnailUrl: item.thumbnailUrl ? api.assetUrl(item.thumbnailUrl) : '' }))
    combined.todayShots = operator.todayShots
    const view = { ...operator, ...customer, ...combined }
    const plan = unifiedHome.dailyPlan(view, this.data.selectedDay, model.day(new Date().toISOString()))
    view.focusMatters = plan.matters
    view.todayGroups = plan.groups
    view.todayTotal = plan.total
    return view
  },
  async refresh() {
    if (this.refreshing) return
    this.refreshing = true
    this.setData({ loading: true, error: '' })
    try {
      const results = await Promise.allSettled([
        api.request('mobile-workbench/overview?weekStart=' + encodeURIComponent(this.data.week.start)),
        api.request('mobile-workbench/queue'),
        api.request('digital-employees/overview'),
        api.customers()
      ])
      if (results[0].status !== 'fulfilled') throw results[0].reason
      const overview = { ...results[0].value, deliveries: results[2].status === 'fulfilled' ? results[2].value.deliveries : undefined }
      const queue = results[1].status === 'fulfilled' ? results[1].value : {}
      const customers = results[3].status === 'fulfilled' ? (results[3].value.items || []) : null
      this.overview = overview; this.queue = queue; this.customers = customers || []
      const view = this.project(overview, queue, customers)
      wx.setStorageSync('operator-customer-unread-count', view.customerUnreadCount || 0)
      const warnings = [results[1], results[3]].filter(result => result.status === 'rejected')
      this.setData({
        ...view,
        assistantOverview: overview,
        assistantQueue: { ...queue, matters: view.matters, urgentMatters: view.urgentMatters },
        loaded: true,
        loading: false,
        error: warnings.length ? '部分待办暂未同步，请稍后刷新。' : ''
      })
      this.updateDays()
    } catch (error) { this.setData({ loading: false, error: error.message }) }
    finally { this.refreshing = false }
  },
  updateDays() {
    const shots = this.data.pendingShots || []
    const customers = this.customers || []
    this.setData({ days: this.data.week.days.map(day => ({
      ...day, selected: day.date === this.data.selectedDay,
      count: shots.filter(item => String(item.dueAt || item.plannedAt || item.scheduledAt || item.createdAt || '').startsWith(day.date)).length
        + customers.filter(item => this.customerDate(item) === day.date).length
    })) })
  },
  changeWeek(event) {
    this.weekOffset = (this.weekOffset || 0) + Number(event.currentTarget.dataset.offset)
    const week = model.week(Date.now(), this.weekOffset)
    this.setData({ week, selectedDay: week.start, expandedGroup: '' })
    this.refresh()
  },
  toggleCalendar() { this.setData({ calendarExpanded: !this.data.calendarExpanded }) },
  selectDay(event) {
    this.setData({ selectedDay: event.currentTarget.dataset.date })
    if (this.overview) this.setData(this.project(this.overview, this.queue || {}, this.customers || []))
    this.updateDays()
  },
  openAssistant() { this.selectComponent('#lingxiaoshu-sheet')?.open() },
  openShooting() { wx.redirectTo({ url: '/packages/operator/shooting/index' }) },
  openTodayGroup(event) {
    const key = event.currentTarget.dataset.key
    if (key === 'shooting') { this.openShooting(); return }
    if (key === 'customers') { wx.navigateTo({ url: '/packages/operator/inquiries/index?tab=confirm' }); return }
    this.setData({ expandedGroup: this.data.expandedGroup === key ? '' : key })
  },
  openMatter(event) {
    const item = this.data.urgentMatters.find(entry => String(entry.id) === String(event.currentTarget.dataset.id))
    if (!item) return
    const matterId = item.matterId || item.id
    if (matterId) wx.navigateTo({ url: '/pages/action/index?matterId=' + encodeURIComponent(matterId) })
  },
  openConversation(event) { wx.navigateTo({ url: '/packages/operator/conversation/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) }) },
  openAcceptance(event) {
    const item = this.data.todayAcceptance.find(entry => String(entry.id) === String(event.currentTarget.dataset.id))
    if (!item || !item.videoUrl) { wx.showToast({ title: '成片视频尚未入库', icon: 'none' }); return }
    wx.setStorageSync('operator-review-selected', String(item.id))
    wx.navigateTo({ url: '/packages/operator/review/index?view=feed&id=' + encodeURIComponent(item.id) })
  }
})
