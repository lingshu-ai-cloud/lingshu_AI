const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function load(file,bindings={}){const module={exports:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/'+file,'utf8'),{module,Date,...bindings});return module.exports}
const model=load('lib/workbench.js');
const schedule=load('lib/agentSchedule.js',{require:()=>model});
function page(api={}) {
 let definition;
 vm.runInNewContext(fs.readFileSync(__dirname+'/pages/workbench/index.js','utf8'),{Page:p=>definition=p,require:id=>id.endsWith('agentSchedule')?schedule:id.endsWith('workbench')?model:id.endsWith('starter')?{}:api,wx:{},Date});
 return {...definition,data:structuredClone(definition.data),setData(patch){for(const [key,value]of Object.entries(patch)){const keys=key.split('.');let target=this.data;for(const k of keys.slice(0,-1))target=target[k];target[keys.at(-1)]=value}}};
}
test('schedule resolves real matters and keeps unscheduled tasks unknown',()=>{
 const view=schedule.project({availability:'available',items:[{taskId:'x',role:'content',title:'质检失败',status:'blocked'},{taskId:'normal',role:'business',status:'running'}]},[],[{id:'approval:a',task:{id:'x'}}]);
 assert.equal(view.agentScheduleItems[0].matterId,'approval:a');
 assert.equal(view.agentScheduleItems[0].needsIntervention,true);
 assert.equal(view.agentScheduleItems[1].needsIntervention,false);
 assert.match(view.agentScheduleItems[0].timeLabel,/未提供|未设置|待定/);
});
test('date-only plans do not fabricate appointment times',()=>{assert.doesNotMatch(schedule.timestamp('2026-10-10'),/08:00|00:00/)});
test('ordinary scheduled task opens its authoritative workspace read-only',async()=>{
 let url; const p=page({request:async value=>{url=value;return {task:{status:'running',output:{stage:'整理资料'}},events:[]}}});
 p.data.agentScheduleItems=[{taskId:'t',runId:'r',title:'真实任务',role:'business',status:'running',stage:'当前节点'}];
 await p.openAgentAssignment({currentTarget:{dataset:{id:'t'}}});
 assert.equal(url,'digital-employees/runs/r/tasks/t/workspace');
 assert.equal(p.data.detail.id,'t'); assert.equal(p.data.detail.scheduleReadOnly,true);
});
test('same task routes to queue matter without creating another intervention',async()=>{
 const p=page();p.data.agentScheduleItems=[{taskId:'t',matterId:'approval:a'}];const item={id:'approval:a',task:{id:'t'},type:'approval'};p.data.matters=[item];
 let opened=false;p.processMatter=()=>{opened=true};await p.openAgentAssignment({currentTarget:{dataset:{id:'t'}}});
 assert.equal(p.data.tab,'todo');assert.equal(p.data.activeMatter,item);assert.equal(opened,true);
});
test('snoozed matter is not opened when unsnoozing fails',async()=>{
 const p=page();p.data.agentScheduleItems=[{taskId:'t'}];p.data.snoozed=[{id:'task:t',task:{id:'t'}}];p.snoozes={'task:t':Date.now()+10000};p.saveSnooze=async()=>{};
 let opened=false;p.processMatter=()=>{opened=true};await p.openAgentAssignment({currentTarget:{dataset:{id:'t'}}});assert.equal(opened,false);
});
