const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')

function loadNative(name) {
  const exports = {}
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/' + name), 'utf8'), { exports })
  return exports
}

function pageWith(api) {
  let page
  const module = { exports: {} }
  const taxonomy = loadNative('materialTaxonomy')
  const source = fs.readFileSync(require.resolve('./packages/operator/materials/index'), 'utf8')
  vm.runInNewContext(source, {
    module, exports: module.exports, Date,
    Page(value) { page = value },
    require(name) {
      if (name.endsWith('/api')) return api
      if (name.endsWith('/materialTaxonomy')) return taxonomy
      throw new Error(name)
    },
  })
  page.data = { ...page.data }
  page.setData = values => Object.assign(page.data, values)
  return page
}

test('material workspace organizes uploaded images and videos without inventing analysis', () => {
  const page = pageWith({ assetUrl: value => 'https://local.test' + value })
  const state = page.project([
    { id: 'video', type: 'video', name: '工厂灌装', url: '/video.mp4', poster: '/poster.jpg', primaryTheme: 'factory', segmentAnalysisStatus: 'ready' },
    { id: 'image', type: 'image', name: '产品正面', url: '/image.jpg', productName: '卸妆蜜', segmentAnalysisStatus: 'analyzing' },
    { id: 'unknown', type: 'image', name: '未分析素材', url: '/unknown.jpg' },
  ])
  assert.equal(state.materials.length, 3)
  assert.equal(state.filters.find(item => item.key === 'video').count, 1)
  assert.equal(state.filters.find(item => item.key === 'image').count, 2)
  assert.equal(state.materials[0].type, 'image')
  assert.equal(state.materials[0].analysisLabel, 'AI 正在整理')
  assert.equal(state.materials[1].analysisLabel, '待自动整理')
  assert.equal(state.materials[2].url, 'https://local.test/video.mp4')
  assert.equal(state.folders.reduce((sum, item) => sum + item.count, 0), 3)
  assert.equal(state.albums[0].label, '卸妆蜜')
  page.data.materials = state.materials
  page.selectFilter({ currentTarget: { dataset: { filter: 'image' } } })
  assert.equal(page.data.visibleMaterials[0].id, 'image')
})

test('native miniapp exposes the unified three-column work areas and assistant sheet', () => {
  const app = fs.readFileSync(require.resolve('./app.json'), 'utf8')
  const nav = fs.readFileSync(require.resolve('./components/operator-nav/index'), 'utf8')
  const markup = fs.readFileSync(require.resolve('./packages/operator/materials/index.wxml'), 'utf8')
  const styles = fs.readFileSync(require.resolve('./packages/operator/materials/index.wxss'), 'utf8')
  const api = fs.readFileSync(require.resolve('./lib/api'), 'utf8')
  assert.match(app, /materials\/index/)
  assert.match(nav, /今日待办/)
  assert.match(nav, /素材拍摄/)
  assert.match(nav, /素材资产/)
  assert.match(markup, /素材资产/)
  assert.match(markup, /来源文件夹/)
  assert.match(markup, /产品相册/)
  assert.match(markup, /最近素材/)
  assert.match(markup, /library-tools/)
  assert.match(markup, /lingxiaoshu-sheet/)
  assert.match(markup, /aria-label="上传素材"/)
  assert.match(styles, /\.add-button\{[^}]*max-width:88rpx/)
  assert.match(styles, /\.add-button\{[^}]*flex:0 0 88rpx/)
  assert.match(api, /uploadMaterial/)
  assert.match(api, /studio\/materials\?scope=own&purpose=library/)
})
