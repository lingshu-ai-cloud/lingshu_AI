Component({
  properties: {
    active: { type: String, value: 'work' },
    mode: { type: String, value: 'operator', observer: 'configure' }
  },
  data: {
    items: [
      { key: 'materials', label: '素材整理', path: '/packages/operator/materials/index' },
      { key: 'shooting', label: '待拍任务', path: '/packages/operator/shooting/index' }
    ]
  },
  lifetimes: { attached() { this.configure(this.properties.mode) } },
  methods: {
    configure(mode) {
      this.setData({ items: mode === 'service' ? [
        { key: 'work', label: '工作', path: '/packages/customer/home/index' },
        { key: 'assistant', label: '客服 Agent', path: '/packages/operator/assistant/index?edition=service' }
      ] : [
        { key: 'materials', label: '素材整理', path: '/packages/operator/materials/index' },
        { key: 'shooting', label: '待拍任务', path: '/packages/operator/shooting/index' }
      ] })
    },
    select(e) {
      const item = this.data.items.find(entry => entry.key === e.currentTarget.dataset.key)
      if (!item || item.key === this.data.active) return
      const servicePaths = { work: '/packages/customer/home/index', assistant: '/packages/operator/assistant/index?edition=service' }
      wx.redirectTo({ url: this.properties.mode === 'service' ? servicePaths[item.key] : item.path })
    }
  }
})
