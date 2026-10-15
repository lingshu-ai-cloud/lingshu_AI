const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
function page() { let definition; const source=fs.readFileSync(path.join(__dirname,'packages/management/home/index.js'),'utf8'); vm.runInNewContext(source,{Page(value){definition=value},require(id){if(id.endsWith('/api'))return{};if(id.endsWith('/workbench'))return{week:()=>({start:'2026-10-12',end:'2026-10-18'}),roles:{}};return{project:()=>({agentScheduleGroups:[]})}},wx:{}}); return {...definition,data:structuredClone(definition.data),setData(patch){Object.assign(this.data,patch)}} }
test('management Agent groups start collapsed and toggle one at a time',()=>{const p=page();assert.equal(p.data.expandedAgentRole,'');p.toggleAgent({currentTarget:{dataset:{role:'content'}}});assert.equal(p.data.expandedAgentRole,'content');p.toggleAgent({currentTarget:{dataset:{role:'business'}}});assert.equal(p.data.expandedAgentRole,'business');p.toggleAgent({currentTarget:{dataset:{role:'business'}}});assert.equal(p.data.expandedAgentRole,'')})
test('management Agent task rows only render task titles',()=>{const markup=fs.readFileSync(path.join(__dirname,'packages/management/home/index.wxml'),'utf8');assert.match(markup,/bindtap="toggleAgent"/);assert.match(markup,/expandedAgentRole === item\.role/);assert.match(markup,/task\.title/);assert.doesNotMatch(markup,/task\.(?:stageLabel|statusLabel|timeLabel)/)})
