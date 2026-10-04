const api = require('../../lib/api')
const emptyDraft = () => ({ title: '', shotBrief: '', productIds: [], themeTitle: '', duration: '5', ratioIndex: 0 })

Page({
  data: { products: [], productsLoading: false, productsError: '', productsOpen: false, selectedProductText: '', draft: emptyDraft(), ratios: ['9:16', '16:9', '1:1', '4:5'], creating: false, loggedIn: false, loading: false, email: '', password: '', userName: '', tasks: [], visibleTasks: [], selected: null, filter: 'pending', busy: false, progress: 0, message: '', pendingMaterialId: '' },
  onLoad() { if (api.token()) this.restore() },
  onShow() { if (this.data.loggedIn && !this.data.busy) this.refresh() },
  inputEmail(e) { this.setData({ email: e.detail.value }) },
  inputPassword(e) { this.setData({ password: e.detail.value }) },
  async signIn() {
    if (this.data.loading) return
    this.setData({ loading: true, message: '' })
    try {
      const session = await api.login(this.data.email.trim(), this.data.password)
      this.setData({ loggedIn: true, userName: session.user && (session.user.name || session.user.email) || '' , password: '' })
      await this.refresh()
    } catch (e) { this.setData({ message: e.message }) }
    finally { this.setData({ loading: false }) }
  },
  async restore() {
    try {
      const session = await api.me()
      this.setData({ loggedIn: true, userName: session.user && (session.user.name || session.user.email) || '' })
      await this.refresh()
    } catch (e) {
      if (!api.token()) this.setData({ loggedIn: false })
      else this.setData({ message: e.message })
    }
  },
  signOut() { if (this.data.creating) return; api.clearToken(); this.setData({ products: [], productsOpen: false, productsError: '', selectedProductText: '', draft: emptyDraft(), filter: 'pending', message: '', loggedIn: false, tasks: [], visibleTasks: [], selected: null, userName: '' }) },
  setFilter(e) {
    if (this.data.busy || this.data.creating) return
    const filter = e.currentTarget.dataset.filter
    if (filter === 'create') this.loadProducts()
    this.setData({ filter, selected: null, message: '', pendingMaterialId: '', visibleTasks: this.data.tasks.filter(task => filter === 'all' || (filter === 'pending' && !task.done) || (filter === 'done' && task.done)) })
  },
  async loadProducts() {
    if (this.data.productsLoading) return
    this.setData({ productsLoading: true, productsError: '' })
    try {
      const result = await api.products()
      if (!result || !Array.isArray(result.items)) throw new Error('产品列表格式异常，请稍后重试')
      const ids = this.data.draft.productIds
      const products = result.items.map(item => ({ id: item.id, name: item.name, checked: ids.includes(item.id) }))
      this.setData({ products })
    } catch (e) { this.setData({ productsError: e.message }) }
    finally { this.setData({ productsLoading: false }) }
  },
  toggleProducts() { if (!this.data.creating) this.setData({ productsOpen: !this.data.productsOpen }) },
  selectProducts(e) {
    if (this.data.creating) return
    const ids = e.detail.value
    const products = this.data.products.map(item => ({ ...item, checked: ids.includes(item.id) }))
    this.setData({ 'draft.productIds': ids, products, selectedProductText: products.filter(item => item.checked).map(item => item.name).join('、') })
  },
  inputDraft(e) {
    const field = e.currentTarget.dataset.field
    if (['title', 'shotBrief', 'productLabel', 'themeTitle', 'duration'].includes(field)) this.setData({ ['draft.' + field]: e.detail.value })
  },
  changeRatio(e) { this.setData({ 'draft.ratioIndex': Number(e.detail.value) }) },
  async createTask() {
    if (this.data.creating) return
    const draft = this.data.draft
    const title = draft.title.trim()
    const shotBrief = draft.shotBrief.trim()
    const suggestedDurationSec = Number(draft.duration)
    if (!title || !shotBrief) { this.setData({ message: '请填写任务标题和拍摄要求' }); return }
    if (!Number.isFinite(suggestedDurationSec) || suggestedDurationSec < 0.5 || suggestedDurationSec > 600) { this.setData({ message: '拍摄时长须为 0.5–600 秒' }); return }
    if (draft.productIds.some(id => !this.data.products.some(item => item.id === id))) { this.setData({ message: '已选产品不在当前知识库中，请重新选择' }); return }
    const productLabel = this.data.products.filter(item => draft.productIds.includes(item.id)).map(item => item.name).join('、')
    if (productLabel.length > 300) { this.setData({ message: '所选产品名称合计不能超过 300 字，请减少选择' }); return }
    this.setData({ creating: true, message: '' })
    try {
      const task = await api.createTask({ title, shotBrief, suggestedDurationSec, productLabel: this.data.products.filter(item => draft.productIds.includes(item.id)).map(item => item.name).join('、'), themeTitle: draft.themeTitle.trim(), ratio: this.data.ratios[draft.ratioIndex] })
      const tasks = [this.displayTask(task), ...this.data.tasks.filter(item => item.id !== task.id)]
      this.setData({ draft: emptyDraft(), selectedProductText: '', productsOpen: false, products: this.data.products.map(item => ({ ...item, checked: false })), filter: 'pending', tasks, visibleTasks: tasks.filter(item => !item.done), message: '任务创建成功，可以开始拍摄' })
      wx.showToast({ title: '任务已创建', icon: 'success' })
    } catch (e) { this.setData({ message: e.message }) }
    finally { this.setData({ creating: false }) }
  },
  displayTask(task) {
    return { ...task, done: !!(task.uploadedMaterialIds && task.uploadedMaterialIds.length), durationText: task.suggestedDurationSec ? task.suggestedDurationSec + ' 秒' : '不限', soundText: task.soundMode === 'source' ? '保留原声' : task.soundMode === 'silent' ? '无声画面' : '可后期配音' }
  },
  selectTask(e) {
    const task = this.data.tasks.find(item => item.id === e.currentTarget.dataset.id)
    if (task) this.setData({ selected: task, message: '', pendingMaterialId: '' })
  },
  back() { if (!this.data.busy) this.setData({ selected: null, message: '', pendingMaterialId: '' }) },
  async refresh() {
    this.setData({ loading: true })
    try {
      const tasks = await api.tasks()
      const displayTasks = tasks.map(task => this.displayTask(task))
      const filter = this.data.filter
      this.setData({ tasks: displayTasks, visibleTasks: displayTasks.filter(task => filter === 'all' || (filter === 'pending' && !task.done) || (filter === 'done' && task.done)) })
      if (this.data.selected) this.setData({ selected: this.data.tasks.find(task => task.id === this.data.selected.id) || null })
    } catch (e) { this.setData({ message: e.message }) }
    finally { this.setData({ loading: false }) }
  },
  shoot() { this.choose(['camera']) },
  chooseExisting() { this.choose(['album']) },
  choose(sourceType) {
    if (this.data.busy) return
    wx.chooseMedia({ count: 1, mediaType: ['video'], sourceType, maxDuration: 600,
      success: res => { const file = res.tempFiles && res.tempFiles[0]; if (file) this.submit(file) },
      fail: err => { if (!/cancel/i.test(err.errMsg || '')) this.setData({ message: err.errMsg || '无法选择视频' }) }
    })
  },
  async submit(file) {
    const task = this.data.selected
    if (!task || this.data.busy) return
    const maxBytes = 30 * 1024 * 1024
    if (!file.size || file.size > maxBytes) { this.setData({ message: '首版支持不超过 30 MB 的视频；请缩短拍摄时长或用网页端上传' }); return }
    this.setData({ busy: true, progress: 0, message: '', pendingMaterialId: '' })
    try {
      const material = await api.uploadVideo({ ...file, name: 'shoot-' + task.id + '.mp4', mimeType: 'video/mp4' }, progress => this.setData({ progress }))
      this.setData({ pendingMaterialId: material.id, message: '视频已入库，正在关联拍摄任务…' })
      await api.attach(task.id, material.id)
      this.setData({ pendingMaterialId: '', message: '上传成功，已关联拍摄任务' })
      await this.refresh()
    } catch (e) { this.setData({ message: e.message }) }
    finally { this.setData({ busy: false }) }
  },
  async retryAttach() {
    if (!this.data.selected || !this.data.pendingMaterialId || this.data.busy) return
    this.setData({ busy: true, message: '' })
    try {
      await api.attach(this.data.selected.id, this.data.pendingMaterialId)
      this.setData({ pendingMaterialId: '', message: '已关联拍摄任务' })
      await this.refresh()
    } catch (e) { this.setData({ message: e.message }) }
    finally { this.setData({ busy: false }) }
  }
})
