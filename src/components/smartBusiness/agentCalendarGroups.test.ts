import assert from 'node:assert/strict';
import test from 'node:test';
import {agentCalendarResponsibleAgent,agentCalendarTaskGroup,agentCalendarTaskType,buildAgentCalendarSummaries,calendarDisplayPlaceholders,taskHasDeliverableOrWorkspace} from './agentCalendarGroups';
import type {AgentCalendarTask} from './AgentWeeklyCalendar';

const dates=['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18'];
const task=(id:string,date:string,executionStep:string,agent:AgentCalendarTask['agent']='business'):AgentCalendarTask=>({id,date,time:'10:00',agent,title:`${id}具体业务`,output:`${id}独立交付物`,context:'真实周包',minutes:30,status:'planned',executionStep});

test('summary cadence follows daily rolling collection and production without treating summaries as deliverables',()=>{
  const tasks=[
    task('goal',dates[0],'business_outline'), task('director',dates[0],'director_analysis','director'),
    task('video',dates[2],'video_generation','content'), task('publish',dates[3],'publishing'),
    task('inquiry',dates[4],'customer_inquiry_handoff','customer'), task('review',dates[6],'weekly_review'),
  ];
  const summaries=buildAgentCalendarSummaries(tasks,dates);
  assert.deepEqual(summaries.filter(item=>item.group==='foundation').map(item=>item.date),[dates[0]]);
  for(const group of ['directing','production','quality','publishing','inquiries'] as const)assert.deepEqual(summaries.filter(item=>item.group===group).map(item=>item.date),dates);
  assert.deepEqual(summaries.filter(item=>item.group==='review').map(item=>item.date),[dates[6]]);
  assert.equal(summaries.filter(item=>item.group==='production'&&item.date===dates[2])[0]?.children[0]?.id,'video');
  assert.equal(summaries.filter(item=>item.group==='production'&&item.date===dates[2])[0]?.title,'video具体业务');
  assert.equal(summaries.filter(item=>item.group==='production'&&item.date===dates[1])[0]?.progress,'等待真实任务');
});

test('a Wednesday-to-Tuesday operating cycle still places setup on its Monday and review on its Sunday',()=>{
  const cycle=['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18'];
  const summaries=buildAgentCalendarSummaries([],cycle);
  assert.deepEqual(summaries.filter(item=>item.group==='foundation').map(item=>item.date),['2026-10-12']);
  assert.deepEqual(summaries.filter(item=>item.group==='directing').map(item=>item.date),cycle);
  assert.deepEqual(summaries.filter(item=>item.group==='review').map(item=>item.date),['2026-10-18']);
  assert.deepEqual([...new Set(summaries.filter(item=>item.group==='production').map(item=>item.date))],cycle);
});

test('summary cards carry dependency-aware recommended completion windows',()=>{
  const summaries=buildAgentCalendarSummaries([],dates);
  const windows=Object.fromEntries(summaries.filter((item,index,self)=>self.findIndex(candidate=>candidate.group===item.group)===index).map(item=>[item.group,[item.startTime,item.durationMinutes]]));
  assert.deepEqual(windows,{foundation:['08:00',30],directing:['08:30',75],production:['10:15',45],quality:['11:15',30],publishing:['17:30',30],inquiries:['18:15',45],review:['16:00',60]});
});

test('daily execution windows are short and staggered, including tasks owned by the same Agent',()=>{
  const summaries=buildAgentCalendarSummaries([],dates).filter(item=>item.date===dates[0]);
  const owner={foundation:'business',directing:'director',production:'content',quality:'content',publishing:'business',inquiries:'customer',review:'business'} as const;
  const minute=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3));
  for(const item of summaries)assert.ok(item.durationMinutes<=75,`${item.group} should be a short execution window`);
  for(const left of summaries)for(const right of summaries){
    if(left.key>=right.key||owner[left.group]!==owner[right.group])continue;
    const [first,second]=[left,right].sort((a,b)=>minute(a.startTime)-minute(b.startTime));
    assert.ok(minute(first!.startTime)+first!.durationMinutes<=minute(second!.startTime),`${first!.group} overlaps ${second!.group}`);
  }
});

test('film summary uses the real task title and does not invent a content topic for an empty window',()=>{
  const actual={...task('film',dates[2],'video_generation','content'),title:'真实 ProductionPlan 标题'};
  const summaries=buildAgentCalendarSummaries([actual],dates);
  assert.equal(summaries.find(item=>item.group==='production'&&item.date===dates[2])?.title,'真实 ProductionPlan 标题');
  assert.equal(summaries.find(item=>item.group==='production'&&item.date===dates[3])?.title,'影片生产');
});

test('independent cards require a deliverable or workspace and use the confirmed task labels',()=>{
  const production=task('video',dates[1],'video_generation','content');
  assert.equal(taskHasDeliverableOrWorkspace(production),true);
  assert.equal(agentCalendarTaskGroup(production),'production');
  assert.equal(agentCalendarTaskType(production),'制片任务');
  assert.equal(agentCalendarTaskType(task('quality',dates[1],'quality_check','content')),'验收任务');
  assert.equal(agentCalendarTaskType(task('business',dates[0],'business_outline')),'经营任务');
  assert.equal(taskHasDeliverableOrWorkspace({...production,output:'待交付:',calendarSummaryOnly:true}),false);
  assert.equal(taskHasDeliverableOrWorkspace({...production,output:'',productionTaskId:'content-real'}),true);
});

test('display placeholders never duplicate real task groups and repeat at most once per empty group',()=>{
  const realProduction=task('video',dates[2],'video_generation','content');
  const summaries=buildAgentCalendarSummaries([realProduction],dates);
  const placeholders=calendarDisplayPlaceholders(summaries,dates[2]);
  assert.equal(placeholders.some(item=>item.group==='production'),false);
  assert.equal(placeholders.filter(item=>item.group==='directing').length,1);
  assert.equal(placeholders.find(item=>item.group==='directing')?.date,dates[2]);
  assert.ok(placeholders.every(item=>item.children.length===0));
});

test('workflow responsibility corrects legacy generic business ownership',()=>{
  assert.equal(agentCalendarResponsibleAgent('director_analysis','business'),'director');
  assert.equal(agentCalendarResponsibleAgent('video_generation','business'),'content');
  assert.equal(agentCalendarResponsibleAgent('customer_inquiry_handoff','business'),'customer');
  assert.equal(agentCalendarResponsibleAgent('publishing','business'),'content');
  assert.equal(agentCalendarResponsibleAgent('user_approval','business'),'human');
  assert.equal(agentCalendarResponsibleAgent(undefined,'director'),'director');
});
