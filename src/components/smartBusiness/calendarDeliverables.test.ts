import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectCalendarDeliverables} from './calendarDeliverables';
import type {AgentCalendarTask} from './AgentWeeklyCalendar';
const card=(id:string,step:string,group='tenant:week:videoA'):AgentCalendarTask=>({id,executionStep:step,deliverableGroup:group,date:'2026-10-07',time:step==='quality_check'?'15:00':'10:00',agent:'content',title:'视频 A · 产品 A',output:'实际结果',context:'测试',minutes:20,status:'planned'});
test('one deliverable retains final deadline, real navigation identity and internal nodes',()=>{
 const nodes=[card('script','script'),{...card('video','video_generation'),productionTaskId:'actual-content',productionExecutionTaskId:'video'},card('quality','quality_check')];
 const result=projectCalendarDeliverables(nodes);
 assert.equal(result.length,1);assert.equal(result[0].id,'quality');assert.equal(result[0].time,'15:00');assert.equal(result[0].productionTaskId,'actual-content');assert.equal(result[0].productionExecutionTaskId,'video');assert.equal(result[0].internalNodes?.length,3);
 assert.equal(result[0].title,'完成视频成片');
});
test('another tenant, publication and human exception never collapse into this video',()=>{
 const human={...card('upload','material_readiness'),agent:'human' as const};
 const result=projectCalendarDeliverables([card('v','video_generation'),card('q','quality_check'),card('other','quality_check','other-tenant:week:videoA'),human,card('publish','publishing')]);
 assert.deepEqual(result.map(c=>c.id),['q','other','upload','publish']);
});
test('blocked internal node is visible on deliverable, completed final evidence remains authoritative',()=>{
 const blocked={...card('asset','asset_generation'),status:'blocked' as const,reason:'缺产品证据'};
 assert.equal(projectCalendarDeliverables([blocked,card('q','quality_check')])[0].reason,'缺产品证据');
 assert.equal(projectCalendarDeliverables([blocked,{...card('q','quality_check'),status:'completed'}])[0].status,'completed');
});
test('missing final delivery and unscoped nodes stay visible instead of silently disappearing',()=>{
 const script=card('script','script');const unscoped={...card('legacy','video_generation'),deliverableGroup:undefined};
 assert.deepEqual(projectCalendarDeliverables([script,unscoped]),[{...script,agent:'director'},unscoped]);
});
test('weekly goal summaries expand their Monday business workflow into independent cards',()=>{
 const mondayNodes:AgentCalendarTask[]=[
  {...card('goal','business_outline',undefined),agent:'business',date:'2026-10-12',time:'09:00',title:'拆解本周经营目标'},
  {...card('context','context_readiness',undefined),agent:'business',date:'2026-10-12',time:'10:00',title:'核验企业上下文'},
  {...card('accounts','publishing_calendar',undefined),agent:'business',date:'2026-10-12',time:'11:00',title:'核验发布账号'},
 ];
 const summary:AgentCalendarTask={...mondayNodes[0],id:'goal-week-goal',title:'经营目标与执行准备',calendarSummaryOnly:true,output:'周目标摘要',internalNodes:mondayNodes};
 const result=projectCalendarDeliverables([summary]);
 assert.deepEqual(result.map(task=>task.id),['goal','context','accounts']);
 assert.ok(result.every(task=>task.calendarSummaryOnly!==true));
});

test('a direct persisted task wins over a duplicate node embedded in a weekly summary',()=>{
 const direct={...card('goal','business_outline',undefined),agent:'business' as const,title:'真实执行任务'};
 const summary:AgentCalendarTask={...direct,id:'summary',calendarSummaryOnly:true,internalNodes:[{...direct,title:'旧摘要节点'}]};
 assert.deepEqual(projectCalendarDeliverables([summary,direct]).map(task=>task.title),['真实执行任务']);
});
