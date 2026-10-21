const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
function load(file, bindings = {}) {
  const module = { exports:{} }
  vm.runInNewContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), { module, exports:module.exports, require:bindings.require || require, Date })
  return module.exports
}
const generated = load('lib/generated/mobile-domain.js')
const weekly = load('lib/generated/weekly-work-status.js')
const workbench = load('lib/workbench.js', { require:id => id.includes('weekly-work-status') ? weekly : generated })
const schedule = load('lib/agentSchedule.js', { require:() => generated })
const home = load('lib/operator-home.js', { require:id => id.endsWith('workbench') ? workbench : schedule })

test('operator home projects execution counts and only intervention schedule items', () => {
  const result = home.project(
    { user: { tenantName: '测试组织' } },
    {
      agentSchedule: { availability:'available', items:[
        { taskId:'blocked', role:'content', title:'素材卡点', status:'blocked', plannedAt:'2026-10-12T09:00:00+08:00', blockedReason:'缺少实拍素材' },
        { taskId:'running', role:'business', title:'正常任务', status:'running', plannedAt:'2026-10-12T10:00:00+08:00' }
      ] }, agents:{items:[]}, workspace:{}
    },
    {
      matters:[{id:'task:blocked',source:{entityId:'blocked'},type:'approval',interventionType:'decision',title:'确认素材'}],
      shooting:[{id:'s1',title:'待拍',shotBrief:'拍摄产品特写',ratio:'9:16'}, {id:'s2',title:'完成',uploadedMaterialIds:['m1']}]
    },
    '2026-10-12'
  )
  assert.equal(result.organization, '测试组织')
  assert.equal(result.counts.pending, 1)
  assert.equal(result.counts.shooting, 1)
  assert.equal(result.counts.confirmation, 1)
  assert.equal(result.counts.pendingShots, 1)
  assert.equal(result.counts.completedShots, 1)
  assert.equal(result.counts.pendingProduction, 0)
  assert.equal(result.counts.producedFilms, 0)
  assert.equal(result.counts.acceptedFilms, 0)
  assert.equal(result.todayShots.length, 1)
  assert.equal(result.todayShots[0].requirement, '拍摄产品特写')
  assert.equal(result.blockers.length, 1)
  assert.equal(result.blockers[0].title, '素材卡点')
})

test('operator home preserves honest empty and unavailable states', () => {
  const result = home.project({}, { agentSchedule:{availability:'unavailable'}, agents:{items:[]} }, {}, '2026-10-12')
  assert.equal(result.counts.pending, 0)
  assert.equal(result.counts.shooting, 0)
  assert.equal(result.counts.confirmation, 0)
  assert.equal(result.counts.pendingProduction, 0)
  assert.equal(result.counts.completedShots, 0)
  assert.equal(result.scheduleAvailable, false)
  assert.equal(result.blockers.length, 0)
})

test('operator home projects todays acceptance queue and weekly published video cards', () => {
  const result = home.project({}, {
    agentSchedule:{availability:'available',items:[]}, agents:{items:[]},
    deliveries:[
      { id:'delivery-today', kind:'内容成片', title:'今日成片', deliveredAt:'2026-10-12T11:00:00+08:00', artifacts:[{kind:'video',url:'/files/today.mp4'}], contentApproval:{approved:false} },
      { id:'delivery-other', kind:'内容成片', title:'其他日期', deliveredAt:'2026-10-11T11:00:00+08:00', artifacts:[{kind:'video',url:'/files/other.mp4'}], contentApproval:{approved:false} }
    ],
    contentSchedule:{availability:'available',items:[
      { id:'published', title:'秋季新品短片', platform:'tiktok', publishReceipt:'verified', thumbnailUrl:'/files/cover.jpg', views:1280 },
      { id:'scheduled', title:'尚未发布', platform:'youtube', publishReceipt:'pending' }
    ]}
  }, {}, '2026-10-12')
  assert.equal(result.todayAcceptance.length, 2)
  assert.equal(result.todayAcceptance[0].title, '今日成片')
  assert.equal(result.publishedVideos.length, 1)
  assert.deepEqual({ ...result.publishedVideos[0] }, { id:'published', title:'秋季新品短片', platform:'TikTok', thumbnailUrl:'/files/cover.jpg', views:1280, mock:false })
})

test('operator home includes overdue local shooting and database approval records in todays queues', () => {
  const result = home.project({}, { agentSchedule:{availability:'available',items:[]}, agents:{items:[]} }, {
    tasks:[{id:'film-task',title:'新品功能演示成片验收',updated_at:'2026-10-10T14:20:00+08:00'}],
    approvals:[{id:'approval-1',task_id:'film-task',action_summary:'预览新品演示成片和质检结果',created_at:'2026-10-10T14:20:00+08:00'}],
    shooting:[{id:'shot-1',title:'补拍产品接口特写',dueAt:'2026-10-11T12:00:00+08:00'}],
    films:[]
  }, '2026-10-15')
  assert.equal(result.counts.pendingAcceptance, 1)
  assert.equal(result.todayAcceptance.length, 1)
  assert.equal(result.todayAcceptance[0].title, '新品功能演示成片验收')
  assert.equal(result.todayShots.length, 1)
})

test('operator home follows the mobile visual baseline', () => {
  const markup = fs.readFileSync(__dirname + '/packages/operator/home/index.wxml', 'utf8')
  const styles = fs.readFileSync(__dirname + '/packages/operator/home/index.wxss', 'utf8')
  const navMarkup = fs.readFileSync(__dirname + '/components/operator-nav/index.wxml', 'utf8')
  const navStyles = fs.readFileSync(__dirname + '/components/operator-nav/index.wxss', 'utf8')
  assert.doesNotMatch(markup, /class="ambient"/)
  assert.match(styles, /page\{background:#fff\}/)
  assert.match(styles, /\.metric-band\{[^}]*border-top:/)
  assert.match(styles, /\.metric\{[^}]*align-items:flex-start/)
  assert.match(styles, /\.shot-card\{[^}]*border-radius:var\(--ls-radius-panel\)/)
  assert.match(markup, /data-key="production"/)
  assert.match(markup, /data-key="acceptance"/)
  assert.match(markup, /class="video-scroll"/)
  assert.match(markup, /本周发布视频/)
  assert.match(navMarkup, /nav-icon \{\{item\.key\}\}/)
  assert.match(navStyles, /\.nav-item\{[^}]*min-height:72rpx/)
  assert.doesNotMatch(navStyles, /backdrop-filter/)
  assert.doesNotMatch(navMarkup, /liquid-slider/)
  assert.match(navStyles, /grid-template-columns:1fr 1fr/)
})

test('operator calendar is collapsed by default and expands on demand', () => {
  const script = fs.readFileSync(__dirname + '/packages/operator/home/index.js', 'utf8')
  const markup = fs.readFileSync(__dirname + '/packages/operator/home/index.wxml', 'utf8')
  assert.match(script, /calendarExpanded:\s*false/)
  assert.match(script, /toggleCalendar\(\)/)
  assert.match(markup, /bindtap="toggleCalendar"/)
  assert.match(markup, /wx:if="\{\{calendarExpanded\}\}" class="days"/)
  assert.match(markup, /catchtap="changeWeek"/)
})

test('operator workbench keeps queue swipe UI removed and review out of primary navigation', () => {
  const markup = fs.readFileSync(__dirname + '/packages/operator/home/index.wxml', 'utf8')
  const nav = fs.readFileSync(__dirname + '/components/operator-nav/index.js', 'utf8')
  assert.doesNotMatch(markup, /queue-deck|queueTouch|左滑|右滑/)
  assert.doesNotMatch(nav, /key: 'review'/)
  assert.match(nav, /label: '素材整理'/)
  assert.match(nav, /label: '待拍任务'/)
})
