const api = require('../../../lib/api')
const model = require('../../../lib/workbench')
const operatorHome = require('../../../lib/operator-home')

Page({
  data: {
    loading: true, error: '', organization: '灵枢工作台', edition: '运营版', unread: 0,
    week: model.week(), selectedDay: model.day(new Date().toISOString()), days: [],
    counts: { pending: '—', shooting: '—', confirmation: '—' }, blockers: [], scheduleAvailable: true, loaded: false
  },
  onLoad() { this.updateDays(); this.restore() },
  onShow() { if (this.loaded && api.token()) this.refresh() },
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
        api.request('mobile-workbench/queue')
      ])
      if (results[0].status !== 'fulfilled') throw results[0].reason
      const overview = results[0].value
      const queue = results[1].status === 'fulfilled' ? results[1].value : {}
      const view = operatorHome.project(this.profile, overview, queue, this.data.selectedDay)
      this.overview = overview; this.queue = queue; this.loaded = true
      this.setData({ ...view, loaded: true, loading: false, error: results[1].status === 'rejected' ? '待办数据暂未同步，请稍后刷新。' : '' })
      this.updateDays()
    } catch (error) { this.setData({ loading: false, error: error.message }) }
    finally { this.refreshing = false }
  },
  updateDays() {
    const blockers = this.data.blockers || []
    this.setData({ days: this.data.week.days.map(day => ({ ...day, selected: day.date === this.data.selectedDay, count: blockers.filter(item => item.date === day.date).length })) })
  },
  changeWeek(e) {
    this.weekOffset = (this.weekOffset || 0) + Number(e.currentTarget.dataset.offset)
    const week = model.week(Date.now(), this.weekOffset)
    this.setData({ week, selectedDay: week.start, blockers: [] }); this.updateDays(); this.refresh()
  },
  selectDay(e) {
    const selectedDay = e.currentTarget.dataset.date
    const view = operatorHome.project(this.profile, this.overview || {}, this.queue || {}, selectedDay)
    this.setData({ selectedDay, blockers: view.blockers }); this.updateDays()
  },
  openMessages() { wx.navigateTo({ url: '/packages/operator/messages/index' }) },
  openEdition() { wx.navigateTo({ url: '/packages/management/home/index' }) },
  openMetric(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'shooting') this.openShooting()
    else wx.navigateTo({ url: '/pages/workbench/index?tab=todo' })
  },
  openShooting() { wx.navigateTo({ url: '/packages/operator/shooting/index' }) },
  openInquiries() { wx.navigateTo({ url: '/packages/operator/inquiries/index' }) },
  openBlocker(e) {
    const item = this.data.blockers.find(entry => String(entry.id) === String(e.currentTarget.dataset.id))
    if (!item) return
    if (item.matterId) wx.navigateTo({ url: '/pages/action/index?matterId=' + encodeURIComponent(item.matterId) })
    else wx.navigateTo({ url: '/pages/workbench/index?tab=todo' })
  }
})
