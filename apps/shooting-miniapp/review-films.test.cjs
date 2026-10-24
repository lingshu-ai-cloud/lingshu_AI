const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const moduleBox = { exports: {} }
vm.runInNewContext(fs.readFileSync(__dirname + '/lib/review-films.js', 'utf8'), { module: moduleBox, exports: moduleBox.exports })
const films = moduleBox.exports

test('review queue only projects exported film deliveries and keeps acceptance state', () => {
  const items = films.projectFinishedFilms({ deliveries: [
    { id:'old', kind:'内容成片', title:'旧片', updatedAt:'2026-10-11T09:00:00Z', contentApproval:{approved:true}, artifacts:[{kind:'video',url:'/old.mp4'}] },
    { id:'new', kind:'内容成片', title:'新品', subject:'TK · 产品 A', deliveredAt:'2026-10-12T09:00:00Z', contentApproval:{approved:false}, artifacts:[{kind:'video',url:'/new.mp4'}] },
    { id:'draft', kind:'内容成片', artifacts:[{kind:'text',text:'脚本'}] },
    { id:'reply', kind:'客服草稿', artifacts:[{kind:'video',url:'/reply.mp4'}] },
  ] }, url => 'https://local.test' + url)
  assert.deepEqual(items.map(item => item.id), ['new', 'old'])
  assert.equal(items[0].statusLabel, '待验收')
  assert.equal(items[0].videoUrl, 'https://local.test/new.mp4')
  assert.equal(items[1].statusLabel, '已验收')
})

test('review page exposes queue and full-height vertical feed modes', () => {
  const markup = fs.readFileSync(require.resolve('./packages/operator/review/index.wxml'), 'utf8')
  const styles = fs.readFileSync(require.resolve('./packages/operator/review/index.wxss'), 'utf8')
  const nav = fs.readFileSync(require.resolve('./components/operator-nav/index.js'), 'utf8')
  assert.match(markup, /swiper wx:else vertical/)
  assert.match(markup, /data-view="queue"/)
  assert.match(markup, /data-view="feed"/)
  assert.match(markup, /class="media-frame"/)
  assert.match(styles, /padding-bottom:56\.25%/)
  assert.doesNotMatch(styles, /box-shadow|backdrop-filter/)
  assert.doesNotMatch(nav, /待验收成片/)
  assert.match(nav, /label: '今日待办'/)
  assert.match(nav, /label: '素材拍摄'/)
  assert.match(nav, /label: '素材资产'/)
  assert.doesNotMatch(nav, /label: '待处理'/)
})
