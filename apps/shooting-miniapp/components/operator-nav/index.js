Component({
  properties: { active: { type: String, value: 'work' } },
  data: {
    items: [
      { key: 'work', label: '工作', path: '/packages/operator/home/index' },
      { key: 'todo', label: '待处理', path: '/pages/workbench/index?tab=todo' },
      { key: 'assistant', label: '经营 Agent', path: '/packages/operator/assistant/index' }
    ]
  },
  methods: {
    select(e) {
      const item = this.data.items.find(entry => entry.key === e.currentTarget.dataset.key)
      if (!item || item.key === this.data.active) return
      wx.redirectTo({ url: item.path })
    }
  }
})
