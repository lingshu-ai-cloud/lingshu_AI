const api = require('../../../lib/api')
const films = require('../../../lib/review-films')

Page({
  data: { loading: false, error: '', view: 'queue', items: [], activeIndex: 0 },
  onLoad() {
    if (!api.token()) { wx.reLaunch({ url: '/pages/workbench/index' }); return }
    this.refresh()
  },
  onShow() { if (api.token() && this.loaded) this.refresh() },
  onHide() { this.pauseActive() },
  onUnload() { this.pauseActive() },
  async refresh() {
    if (this.data.loading) return
    this.setData({ loading: true, error: '' })
    try {
      const overview = await api.request('digital-employees/overview')
      const items = films.projectFinishedFilms(overview, api.assetUrl)
      this.loaded = true
      this.setData({ items, activeIndex: Math.min(this.data.activeIndex, Math.max(0, items.length - 1)) })
    } catch (error) {
      if (!api.token()) wx.reLaunch({ url: '/pages/workbench/index' })
      else this.setData({ error: error.message || '成片队列读取失败，请重试' })
    } finally { this.setData({ loading: false }) }
  },
  setView(e) {
    const view = e.currentTarget.dataset.view
    if (!['queue', 'feed'].includes(view) || view === this.data.view) return
    this.pauseActive()
    this.setData({ view, activeIndex: 0 }, () => {
      if (view !== 'feed' || !this.data.items.length) return
      const context = wx.createVideoContext('feed-video-0', this)
      if (context && context.play) context.play()
    })
  },
  feedChange(e) {
    this.pauseActive()
    const activeIndex = Number(e.detail.current || 0)
    this.setData({ activeIndex }, () => {
      const context = wx.createVideoContext('feed-video-' + activeIndex, this)
      if (context && context.play) context.play()
    })
  },
  pauseActive() {
    const context = wx.createVideoContext && wx.createVideoContext('feed-video-' + this.data.activeIndex, this)
    if (context && context.pause) context.pause()
  }
})
