const api = require('../../../lib/api')
const films = require('../../../lib/review-films')
const operatorHome = require('../../../lib/operator-home')

Page({
  data: { loading: false, error: '', view: 'queue', items: [], activeIndex: 0 },
  onLoad(options = {}) {
    if (!api.token()) { wx.reLaunch({ url: '/pages/workbench/index' }); return }
    this.selectedId = String(options.id || wx.getStorageSync('operator-review-selected') || '')
    if (options.view === 'feed') this.setData({ view: 'feed' })
    this.refresh()
  },
  onShow() { if (api.token() && this.loaded) this.refresh() },
  onHide() { this.pauseActive() },
  onUnload() { this.pauseActive() },
  async refresh() {
    if (this.data.loading) return
    this.setData({ loading: true, error: '' })
    try {
      const [overviewResult, queueResult] = await Promise.allSettled([api.request('digital-employees/overview'), api.request('mobile-workbench/queue')])
      const overview = overviewResult.status === 'fulfilled' ? overviewResult.value : {}
      const queue = queueResult.status === 'fulfilled' ? queueResult.value : {}
      const deliveryItems = films.projectFinishedFilms(overview, api.assetUrl)
      const queueItems = operatorHome.project({}, {}, queue, '').acceptanceItems.filter(item => item.videoUrl).map(item => ({
        id:item.id,title:item.title,subject:item.subject,videoUrl:api.assetUrl(item.videoUrl),status:'pending',statusLabel:'待验收',
        deliveredAt:item.deliveredAt,deliveredLabel:item.deliveredAt ? item.deliveredAt.slice(0,16).replace('T',' ') : '交付时间待同步',mock:item.mock === true
      }))
      const items = [...queueItems, ...deliveryItems.filter(item => !queueItems.some(entry => entry.id === item.id))]
      const selected = this.selectedId ? items.findIndex(item => String(item.id) === this.selectedId) : -1
      this.loaded = true
      this.setData({ items, activeIndex: selected >= 0 ? selected : Math.min(this.data.activeIndex, Math.max(0, items.length - 1)) }, () => {
        if (this.data.view === 'feed' && items.length) wx.createVideoContext('feed-video-' + this.data.activeIndex, this)?.play?.()
      })
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
  },
  closeFeed() { wx.navigateBack({ delta: 1 }) }
})
