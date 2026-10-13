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
  assert.equal(result.scheduleAvailable, false)
  assert.equal(result.blockers.length, 0)
})
