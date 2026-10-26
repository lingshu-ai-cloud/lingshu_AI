const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')

function loadNative(name) {
  const exports = {}
  vm.runInNewContext(fs.readFileSync(require.resolve('./lib/' + name), 'utf8'), { exports })
  return exports
}

function pageWith(api, wx = {}) {
  let page
  const module = { exports: {} }
  const taxonomy = loadNative('materialTaxonomy')
  const source = fs.readFileSync(require.resolve('./packages/operator/materials/index'), 'utf8')
  vm.runInNewContext(source, {
    module, exports: module.exports, Date, wx,
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

test('native miniapp exposes shared work areas and a dedicated assistant page', () => {
  const app = fs.readFileSync(require.resolve('./app.json'), 'utf8')
  const nav = fs.readFileSync(require.resolve('./components/operator-nav/index'), 'utf8')
  const markup = fs.readFileSync(require.resolve('./packages/operator/materials/index.wxml'), 'utf8')
  const styles = fs.readFileSync(require.resolve('./packages/operator/materials/index.wxss'), 'utf8')
  const api = fs.readFileSync(require.resolve('./lib/api'), 'utf8')
  assert.match(app, /materials\/index/)
  assert.match(nav, /Hi 灵小枢/)
  assert.match(nav, /我的素材/)
  assert.match(nav, /我的客户/)
  assert.match(markup, /我的素材/)
  assert.match(markup, /来源文件夹/)
  assert.match(markup, /产品相册/)
  assert.match(markup, /最近素材/)
  assert.match(markup, /library-tools/)
  assert.doesNotMatch(markup, /lingxiaoshu-sheet/)
  assert.match(nav, /Hi 灵小枢/)
  assert.match(markup, /aria-label="上传素材"/)
  assert.match(styles, /\.material-entry-actions\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(markup, /bindtap="openShooting"/)
  assert.match(api, /uploadMaterial/)
  assert.match(api, /studio\/materials\?scope=own&purpose=library/)
})


test('my materials opens shooting as a child and upload keeps the existing album picker', () => {
  const navigation = [], selections = []
  const page = pageWith({}, { navigateTo: value => navigation.push(value.url), chooseMedia: value => { assert.ok(value.maxDuration === undefined || value.maxDuration <= 60, 'native picker rejects excessive maxDuration even for photos'); selections.push(value) } })
  page.openShooting()
  assert.deepEqual(navigation, ['/packages/operator/shooting/index'])
  page.chooseMaterial()
  assert.equal(selections.length, 1)
  assert.deepEqual(Array.from(selections[0].sourceType), ['album'])
  page.data.busy = true
  page.openShooting()
  page.chooseMaterial()
  assert.equal(navigation.length, 1)
  assert.equal(selections.length, 1)
})

test('primary navigation has exactly assistant, materials and customers in order', () => {
  let definition
  vm.runInNewContext(fs.readFileSync(__dirname + '/components/operator-nav/index.js', 'utf8'), { Component: value => { definition = value } })
  assert.deepEqual(Array.from(definition.data.items, item => item.key), ['assistant', 'materials', 'customers'])
  assert.deepEqual(Array.from(definition.data.items, item => item.label), ['Hi 灵小枢', '我的素材', '我的客户'])
  const shooting = fs.readFileSync(__dirname + '/packages/operator/shooting/index.wxml', 'utf8')
  const customers = fs.readFileSync(__dirname + '/packages/operator/inquiries/index.wxml', 'utf8')
  assert.doesNotMatch(shooting, /<operator-nav/)
  assert.match(customers, /<operator-nav active="customers"/)
  const markup = fs.readFileSync(__dirname + '/packages/operator/materials/index.wxml', 'utf8')
  assert.ok(markup.indexOf('我的素材') < markup.indexOf('去拍摄'))
  assert.ok(markup.indexOf('去拍摄') < markup.indexOf('搜索素材'))
  assert.match(markup, /bindtap="chooseMaterial"/)
})

test('private image downloads replace grid, folder and album covers with authenticated local files', async () => {
  let downloads=0
  const page=pageWith({token:()=> 'token',assetUrl:value=>value,materials:async()=>[
    {id:'one',type:'image',name:'产品',productName:'产品',url:'/media/tenants/t/product.png'},
    {id:'two',type:'image',name:'产品副本',productName:'产品',url:'/media/tenants/t/product.png'}
  ],cacheImage:async()=>{downloads++;return 'wxfile://authenticated-image'}})
  await page.refresh()
  assert.equal(downloads,1); assert.equal(page.data.visibleMaterials[0].url,'wxfile://authenticated-image')
  assert.equal(page.data.folders[0].cover,'wxfile://authenticated-image'); assert.equal(page.data.albums[0].cover,'wxfile://authenticated-image')
})

test('failed protected image download keeps an explicit unavailable state without restoring a stale HTTP URL', async () => {
  const page=pageWith({token:()=> 'token',assetUrl:value=>value,materials:async()=>[{id:'one',type:'image',url:'/media/missing.png',imageUrl:'/media/missing.png'}],cacheImage:async()=>{throw Error('404')}})
  await page.refresh()
  assert.equal(page.data.visibleMaterials[0].mediaError,true); assert.equal(page.data.visibleMaterials[0].url,'')
})

test('absolute native image paths survive re-projection without becoming server URLs', async () => {
  const local='/var/mobile/Containers/Data/WeChat/image.png'
  const page=pageWith({token:()=> 'token',assetUrl:value=>value.startsWith('/')?'https://server.invalid'+value:value,
    materials:async()=>[{id:'one',type:'image',productName:'产品',url:'/media/private.png'}],cacheImage:async()=>local})
  await page.refresh()
  assert.equal(page.data.materials[0].url,local)
  assert.equal(page.data.folders[0].cover,local)
  assert.equal(page.data.albums[0].cover,local)
})
