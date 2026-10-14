import assert from 'node:assert/strict';
import test from 'node:test';
import {agentCalendarTaskGroup,agentCalendarTaskType,buildAgentCalendarSummaries,taskHasDeliverableOrWorkspace} from './agentCalendarGroups';
import type {AgentCalendarTask} from './AgentWeeklyCalendar';

const dates=['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18'];
const task=(id:string,date:string,executionStep:string,agent:AgentCalendarTask['agent']='business'):AgentCalendarTask=>({id,date,time:'10:00',agent,title:`${id}具体业务`,output:`${id}独立交付物`,context:'真实周包',minutes:30,status:'planned',executionStep});

test('summary cadence follows Monday, six operating days and Sunday without treating summaries as deliverables',()=>{
  const tasks=[
    task('goal',dates[0],'business_outline'), task('director',dates[0],'director_analysis','director'),
    task('video',dates[2],'video_generation','content'), task('publish',dates[3],'publishing'),
    task('inquiry',dates[4],'customer_inquiry_handoff','customer'), task('review',dates[6],'weekly_review'),
  ];
  const summaries=buildAgentCalendarSummaries(tasks,dates);
  assert.deepEqual(summaries.filter(item=>item.group==='foundation').map(item=>item.date),[dates[0]]);
  assert.deepEqual(summaries.filter(item=>item.group==='directing').map(item=>item.date),[dates[0]]);
  for(const group of ['production','publishing','inquiries'] as const)assert.deepEqual(summaries.filter(item=>item.group===group).map(item=>item.date),dates.slice(0,6));
  assert.deepEqual(summaries.filter(item=>item.group==='review').map(item=>item.date),[dates[6]]);
  assert.equal(summaries.filter(item=>item.group==='production'&&item.date===dates[2])[0]?.children[0]?.id,'video');
  assert.equal(summaries.filter(item=>item.group==='production'&&item.date===dates[1])[0]?.progress,'尚未生成独立任务');
});

test('a Wednesday-to-Tuesday operating cycle still places setup on its Monday and review on its Sunday',()=>{
  const cycle=['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18'];
  const summaries=buildAgentCalendarSummaries([],cycle);
  assert.deepEqual(summaries.filter(item=>['foundation','directing'].includes(item.group)).map(item=>item.date),['2026-10-12','2026-10-12']);
  assert.deepEqual(summaries.filter(item=>item.group==='review').map(item=>item.date),['2026-10-18']);
  assert.deepEqual([...new Set(summaries.filter(item=>item.group==='production').map(item=>item.date))],cycle.filter(date=>date!=='2026-10-18'));
});

test('summary cards carry dependency-aware recommended completion windows',()=>{
  const summaries=buildAgentCalendarSummaries([],dates);
  const windows=Object.fromEntries(summaries.filter((item,index,self)=>self.findIndex(candidate=>candidate.group===item.group)===index).map(item=>[item.group,[item.startTime,item.durationMinutes]]));
  assert.deepEqual(windows,{foundation:['09:00',60],directing:['10:00',120],production:['09:00',360],publishing:['17:30',30],inquiries:['18:00',60],review:['16:00',60]});
});

test('independent cards require a deliverable or workspace and use the confirmed task labels',()=>{
  const production=task('video',dates[1],'video_generation','content');
  assert.equal(taskHasDeliverableOrWorkspace(production),true);
  assert.equal(agentCalendarTaskGroup(production),'production');
  assert.equal(agentCalendarTaskType(production),'制片任务');
  assert.equal(agentCalendarTaskType(task('business',dates[0],'business_outline')),'经营任务');
  assert.equal(taskHasDeliverableOrWorkspace({...production,output:'待交付:',calendarSummaryOnly:true}),false);
  assert.equal(taskHasDeliverableOrWorkspace({...production,output:'',productionTaskId:'content-real'}),true);
});
