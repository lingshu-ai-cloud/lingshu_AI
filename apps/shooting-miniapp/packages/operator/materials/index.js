const api = require('../../../lib/api')
const { materialThemeTagsOf, MATERIAL_THEME_LABELS } = require('../../../lib/materialTaxonomy')

function materialType(item) {
  return String(item && item.type || '').toLowerCase() === 'image' ? 'image' : 'video'
}

function materialView(item) {
  const type = materialType(item)
  const rawUrl = item.url || item.videoUrl || item.imageUrl || item.mediaUrl || ''
  const rawPoster = item.poster || item.posterUrl || item.thumbnailUrl || (type === 'image' ? rawUrl : '')
  const status = String(item.segmentAnalysisStatus || item.analysisStatus || '')
  const tags = materialThemeTagsOf(item).map(value => MATERIAL_THEME_LABELS[value]).filter(Boolean).slice(0, 2)
  const analysisReady = ['ready', 'completed', 'complete', 'succeeded'].includes(status)
  return {
    ...item,
    id: String(item.id || ''),
    name: String(item.name || (type === 'image' ? '未命名图片' : '未命名视频')),
    type,
    typeLabel: type === 'image' ? '图片' : '视频',
    url: rawUrl ? api.assetUrl(rawUrl) : '',
    poster: rawPoster ? api.assetUrl(rawPoster) : '',
    productName: String(item.productName || ''),
    tags,
    analysisLabel: status === 'analyzing' || status === 'pending' ? 'AI 正在整理' : status === 'failed' ? '分析待重试' : analysisReady ? '已自动整理' : '待自动整理',
    analysisTone: status === 'failed' ? 'warning' : status === 'analyzing' || status === 'pending' ? 'running' : analysisReady ? 'ready' : 'pending',
  }
}

function visible(materials, filter, query) {
  const keyword = String(query || '').trim().toLowerCase()
  return materials.filter(item => (filter === 'all' || item.type === filter) && (!keyword || [item.name, item.productName, ...(item.tags || [])].join(' ').toLowerCase().includes(keyword)))
}

Page({
  data: {
    loading: false, loaded: false, busy: false, progress: 0, progressStep: '', message: '', messageType: '',
    filter: 'all', query: '', materials: [], visibleMaterials: [],
    filters: [{ key: 'all', label: '全部', count: 0 }, { key: 'video', label: '视频', count: 0 }, { key: 'image', label: '图片', count: 0 }],
  },
  onLoad() {
    if (!api.token()) { wx.redirectTo({ url: '/pages/workbench/index' }); return }
    this.refresh()
  },
  onShow() { if (this.data.loaded && api.token() && !this.data.busy) this.refresh() },
  project(materials) {
    const rows = (Array.isArray(materials) ? materials : []).map(materialView)
    return {
      materials: rows,
      visibleMaterials: visible(rows, this.data.filter, this.data.query),
      filters: [
        { key: 'all', label: '全部', count: rows.length },
        { key: 'video', label: '视频', count: rows.filter(item => item.type === 'video').length },
        { key: 'image', label: '图片', count: rows.filter(item => item.type === 'image').length },
      ],
    }
  },
  async refresh() {
    if (this.data.loading) return
    this.setData({ loading: true, message: '' })
    try { this.setData({ ...this.project(await api.materials()), loaded: true }) }
    catch (error) { this.setData({ message: error.message || '素材库读取失败', messageType: 'error' }) }
    finally { this.setData({ loading: false }) }
  },
  selectFilter(event) {
    const filter = event.currentTarget.dataset.filter
    this.setData({ filter, visibleMaterials: visible(this.data.materials, filter, this.data.query) })
  },
  search(event) {
    const query = event.detail.value
    this.setData({ query, visibleMaterials: visible(this.data.materials, this.data.filter, query) })
  },
  chooseMaterial() {
    if (this.data.busy) return
    wx.chooseMedia({ count: 1, mediaType: ['image', 'video'], sourceType: ['album'], maxDuration: 600,
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

module.exports = { materialType, materialView, visible }
