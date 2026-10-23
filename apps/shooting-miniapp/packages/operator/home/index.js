const api = require('../../../lib/api')
const model = require('../../../lib/workbench')
const operatorHome = require('../../../lib/operator-home')

Page({
  data: {
    loading: true, error: '', organization: '灵枢工作台', edition: '运营版',
    statusBarHeight: 44,
    week: model.week(), selectedDay: model.day(new Date().toISOString()), days: [], calendarExpanded: false,
    counts: { pendingProduction: '—', producedFilms: '—', pendingAcceptance: '—', acceptedFilms: '—', pendingShots: '—', completedShots: '—' },
    blockers: [], todayShots: [], todayAcceptance: [], publishedVideos: [], pendingShots: [], activeMetric: 'shooting', scheduleAvailable: true, loaded: false
  },
  onLoad() {
    const system = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: Number(system.statusBarHeight) || 44 })
    this.updateDays(); this.restore()
  },
  onShow() {
    if (this.loaded && api.token()) this.refresh()
  },
  async restore() {
    if (!api.token()) { wx.redirectTo({ url: '/pages/workbench/index' }); return }
    try { this.profile = await api.me(); await this.refresh() }
    catch (error) { this.setData({ loading: false, error: error.message }) }
  },
  async refresh() {
    if (this.refreshing) return
    this.refreshing = true; this.setData({ loading: true, error: '' })
    try {
      const results = await Promise.allSettled([
        api.request('mobile-workbench/overview?weekStart=' + encodeURIComponent(this.data.week.start)),
        api.request('mobile-workbench/queue'),
        api.request('digital-employees/overview')
      ])
      if (results[0].status !== 'fulfilled') throw results[0].reason
      const overview = { ...results[0].value, deliveries: results[2].status === 'fulfilled' ? results[2].value.deliveries : undefined }
      const queue = results[1].status === 'fulfilled' ? results[1].value : {}
      const view = operatorHome.project(this.profile, overview, queue, this.data.selectedDay)
      view.todayAcceptance = view.todayAcceptance.map(item => ({ ...item, videoUrl: item.videoUrl ? api.assetUrl(item.videoUrl) : '', thumbnailUrl: item.thumbnailUrl ? api.assetUrl(item.thumbnailUrl) : '' }))
      view.publishedVideos = view.publishedVideos.map(item => ({ ...item, thumbnailUrl: item.thumbnailUrl ? api.assetUrl(item.thumbnailUrl) : '' }))
      this.overview = overview; this.queue = queue; this.loaded = true
      this.setData({ ...view, loaded: true, loading: false, error: results[1].status === 'rejected' ? '待办数据暂未同步，请稍后刷新。' : '' })
      this.updateDays()
    } catch (error) { this.setData({ loading: false, error: error.message }) }
    finally { this.refreshing = false }
  },
  updateDays() {
    const shots = this.data.pendingShots || []
    this.setData({ days: this.data.week.days.map(day => ({ ...day, selected: day.date === this.data.selectedDay, count: shots.filter(item => String(item.dueAt || item.plannedAt || item.scheduledAt || item.createdAt || '').startsWith(day.date)).length })) })
  },
  changeWeek(e) {
    this.weekOffset = (this.weekOffset || 0) + Number(e.currentTarget.dataset.offset)
    const week = model.week(Date.now(), this.weekOffset)
    this.setData({ week, selectedDay: week.start, blockers: [] }); this.updateDays(); this.refresh()
  },
  toggleCalendar() { this.setData({ calendarExpanded: !this.data.calendarExpanded }) },
  selectDay(e) {
    const selectedDay = e.currentTarget.dataset.date
    const view = operatorHome.project(this.profile, this.overview || {}, this.queue || {}, selectedDay)
    view.todayAcceptance = view.todayAcceptance.map(item => ({ ...item, videoUrl: item.videoUrl ? api.assetUrl(item.videoUrl) : '', thumbnailUrl: item.thumbnailUrl ? api.assetUrl(item.thumbnailUrl) : '' }))
    this.setData({ selectedDay, blockers: view.blockers, todayShots: view.todayShots, todayAcceptance: view.todayAcceptance }); this.updateDays()
  },
  openEdition() {
    wx.showActionSheet({ itemList: ['运营版', '客服版'], success: result => {
      if (result.tapIndex === 1) wx.redirectTo({ url: '/packages/customer/home/index' })
    } })
  },
  openMetric(e) {
    const key = e.currentTarget.dataset.key
    if (['production', 'acceptance', 'shooting'].includes(key)) this.setData({ activeMetric: key })
  },
  openShooting() { wx.navigateTo({ url: '/packages/operator/shooting/index' }) },
  openMaterials() { wx.navigateTo({ url: '/packages/operator/materials/index' }) },
  openInquiries() { wx.navigateTo({ url: '/packages/operator/inquiries/index' }) },
  openShot(e) {
    this.navigateShot(e)
  },
  openAcceptance(e) {
    const item = this.data.todayAcceptance.find(entry => String(entry.id) === String(e.currentTarget.dataset.id))
    if (!item || !item.videoUrl) { wx.showToast({ title: '成片视频尚未入库', icon: 'none' }); return }
    wx.setStorageSync('operator-review-selected', String(item.id))
    wx.navigateTo({ url: '/packages/operator/review/index?view=feed&id=' + encodeURIComponent(item.id) })
  },
  navigateShot(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: '/packages/operator/shooting/index?taskId=' + encodeURIComponent(id) })
  },
  openBlocker(e) {
    const item = this.data.blockers.find(entry => String(entry.id) === String(e.currentTarget.dataset.id))
    if (!item) return
    if (item.matterId) wx.navigateTo({ url: '/pages/action/index?matterId=' + encodeURIComponent(item.matterId) })
    else wx.navigateTo({ url: '/pages/workbench/index?tab=todo' })
  }
})
