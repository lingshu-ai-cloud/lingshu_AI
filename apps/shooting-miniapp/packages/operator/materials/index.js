const api = require('../../../lib/api')
const { materialSourceCategoryOf, materialThemeTagsOf, MATERIAL_SOURCE_LABELS, MATERIAL_THEME_LABELS } = require('../../../lib/materialTaxonomy')

function materialType(item) {
  return String(item && item.type || '').toLowerCase() === 'image' ? 'image' : 'video'
}

function materialView(item) {
  const type = materialType(item)
  const rawUrl = item.mediaError ? '' : item.url || item.videoUrl || item.imageUrl || item.mediaUrl || ''
  const rawPoster = item.mediaError ? '' : item.poster || item.posterUrl || item.thumbnailUrl || (type === 'image' ? rawUrl : '')
  const status = String(item.segmentAnalysisStatus || item.analysisStatus || '')
  const tags = materialThemeTagsOf(item).map(value => MATERIAL_THEME_LABELS[value]).filter(Boolean).slice(0, 2)
  const analysisReady = ['ready', 'completed', 'complete', 'succeeded'].includes(status)
  const sourceCategory = materialSourceCategoryOf(item)
  return {
    ...item,
    id: String(item.id || ''),
    name: String(item.name || (type === 'image' ? '未命名图片' : '未命名视频')),
    type,
    typeLabel: type === 'image' ? '图片' : '视频',
    url: !item.mediaError && item.localImagePath ? item.localImagePath : rawUrl ? api.assetUrl(rawUrl) : '',
    poster: type === 'image' && !item.mediaError && item.localImagePath ? item.localImagePath : rawPoster ? api.assetUrl(rawPoster) : '',
    productName: String(item.productName || ''),
    sourceCategory,
    sourceLabel: MATERIAL_SOURCE_LABELS[sourceCategory],
    tags,
    analysisLabel: status === 'analyzing' || status === 'pending' ? 'AI 正在整理' : status === 'failed' ? '分析待重试' : analysisReady ? '已自动整理' : '待自动整理',
    analysisTone: status === 'failed' ? 'warning' : status === 'analyzing' || status === 'pending' ? 'running' : analysisReady ? 'ready' : 'pending',
  }
}

function visible(materials, filter, query, source) {
  const keyword = String(query || '').trim().toLowerCase()
  return materials.filter(item => (filter === 'all' || item.type === filter || (filter === 'ready' && item.analysisTone === 'ready'))
    && (!source || item.sourceCategory === source)
    && (!keyword || [item.name, item.productName, item.sourceLabel, ...(item.tags || [])].join(' ').toLowerCase().includes(keyword)))
}

function groupBy(rows, keyOf, labelOf) {
  const groups = new Map()
  rows.forEach(item => {
    const key = String(keyOf(item) || '')
    if (!key) return
    if (!groups.has(key)) groups.set(key, { key, label: labelOf(item), count: 0, cover: item.poster || item.url, type: item.type })
    groups.get(key).count += 1
  })
  return Array.from(groups.values())
}

Page({
  data: {
    loading: false, loaded: false, busy: false, progress: 0, progressStep: '', message: '', messageType: '',
    filter: 'all', source: '', query: '', materials: [], visibleMaterials: [], folders: [], albums: [],
    filters: [{ key: 'all', label: '全部素材', count: 0 }, { key: 'image', label: '图片', count: 0 }, { key: 'video', label: '视频', count: 0 }, { key: 'ready', label: '已整理', count: 0 }],
  },
  onLoad() {
    if (!api.token()) { wx.redirectTo({ url: '/pages/workbench/index' }); return }
    this.refresh()
  },
  onShow() { if (this.data.loaded && api.token() && !this.data.busy) this.refresh() },
  openAssistant() { wx.redirectTo({ url: '/packages/operator/assistant/index' }) },
  project(materials) {
    const rows = (Array.isArray(materials) ? materials : []).map(materialView).sort((a, b) => Number(a.type === 'video') - Number(b.type === 'video'))
    return {
      materials: rows,
      visibleMaterials: visible(rows, this.data.filter, this.data.query, this.data.source),
      folders: groupBy(rows, item => item.sourceCategory, item => item.sourceLabel),
      albums: groupBy(rows, item => item.productName, item => item.productName).slice(0, 6),
      filters: [
        { key: 'all', label: '全部素材', count: rows.length },
        { key: 'image', label: '图片', count: rows.filter(item => item.type === 'image').length },
        { key: 'video', label: '视频', count: rows.filter(item => item.type === 'video').length },
        { key: 'ready', label: '已整理', count: rows.filter(item => item.analysisTone === 'ready').length },
      ],
    }
  },
  async refresh() {
    if (this.data.loading) return
    this.setData({ loading: true, message: '' })
    try {
      const view = this.project(await api.materials())
      const cached = new Map(), failures = []
      const image = url => { if (!url || !api.cacheImage) return Promise.resolve(url); if (!cached.has(url)) cached.set(url, api.cacheImage(url).catch(error => { failures.push(error.message || '图片读取失败'); return '' })); return cached.get(url) }
      let cursor = 0
      const hydrate = async item => {
        if (item.type === 'image') { item.localImagePath = await image(item.url); item.url = item.localImagePath; item.poster = item.localImagePath; item.mediaError = !item.localImagePath }
        else if (item.poster) item.poster = await image(item.poster)
      }
      await Promise.all(Array.from({ length: Math.min(4, view.materials.length) }, async () => { while (cursor < view.materials.length) await hydrate(view.materials[cursor++]) }))
      this.setData({ ...this.project(view.materials), loaded: true, message: failures.length ? `${failures.length} 项图片未能读取：${failures[0]}` : '', messageType: failures.length ? 'error' : '' })
    }
    catch (error) { this.setData({ message: error.message || '素材库读取失败', messageType: 'error' }) }
    finally { this.setData({ loading: false }) }
  },
  selectFilter(event) {
    const filter = event.currentTarget.dataset.filter
    this.setData({ filter, source: '', visibleMaterials: visible(this.data.materials, filter, this.data.query, '') })
  },
  selectFolder(event) {
    const source = event.currentTarget.dataset.source || ''
    this.setData({ filter: 'all', source, visibleMaterials: visible(this.data.materials, 'all', this.data.query, source) })
  },
  selectAlbum(event) {
    const query = event.currentTarget.dataset.album || ''
    this.setData({ filter: 'all', source: '', query, visibleMaterials: visible(this.data.materials, 'all', query, '') })
  },
  search(event) {
    const query = event.detail.value
    this.setData({ query, visibleMaterials: visible(this.data.materials, this.data.filter, query, this.data.source) })
  },
  openShooting() { if (!this.data.busy) wx.navigateTo({ url: '/packages/operator/shooting/index' }) },
  chooseMaterial() {
    if (this.data.busy) return
    wx.chooseMedia({ count: 1, mediaType: ['image', 'video'], sourceType: ['album'],
      success: result => { const file = result.tempFiles && result.tempFiles[0]; if (file) this.upload(file) },
      fail: error => { if (!/cancel/i.test(error.errMsg || '')) this.setData({ message: error.errMsg || '无法选择素材', messageType: 'error' }) },
    })
  },
  async upload(file) {
    if (this.data.busy) return
    const limit = file.fileType === 'image' ? 20 : 30
    if (!file.size || file.size > limit * 1024 * 1024) { this.setData({ message: `当前支持不超过 ${limit} MB 的${file.fileType === 'image' ? '图片' : '视频'}`, messageType: 'error' }); return }
    this.setData({ busy: true, progress: 0, progressStep: '读取素材', message: '', messageType: '' })
    try {
      await api.uploadMaterial({ ...file, name: `mobile-material-${Date.now()}.${file.fileType === 'image' ? 'jpg' : 'mp4'}` }, progress => this.setData({ progress, progressStep: progress < 30 ? '读取素材' : '上传并整理' }))
      this.setData({ progress: 100, message: '素材已上传，AI 正在自动整理', messageType: 'success' })
      await this.refresh()
    } catch (error) { this.setData({ message: error.message || '素材上传失败', messageType: 'error' }) }
    finally { this.setData({ busy: false }) }
  },
})

module.exports = { materialType, materialView, visible, groupBy }
