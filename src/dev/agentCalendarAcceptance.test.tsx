import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import AgentWeeklyCalendar from '../components/smartBusiness/AgentWeeklyCalendar';
import {agentCalendarDemo as cold} from './agentCalendarDemo';
import {agentCalendarEstablishedDemo as established} from './agentCalendarEstablishedDemo';

function verifyGraph(tasks: typeof cold, prefix:'Z'|'H') {
  const ids=new Set(tasks.map(task=>task.id));
  assert.equal(ids.size,tasks.length);
  assert.equal(new Set(tasks.map(task=>task.date)).size,7);
  for(const family of ['M','S'] as const) for(let index=1;index<=(family==='M'?8:9);index++)
    assert(tasks.some(task=>task.chain===`${prefix}-${family}${index}`),`missing ${prefix}-${family}${index}`);
  for(const task of tasks) for(const dependency of task.dependsOn??[]) {
    assert(ids.has(dependency),`${task.id} references missing ${dependency}`);
    assert(tasks.find(item=>item.id===dependency)!.date<=task.date,`${dependency} is after ${task.id}`);
  }
}

test('Z and H acceptance calendars expose distinct complete seven-day task graphs',()=>{
  verifyGraph(cold,'Z'); verifyGraph(established,'H');
  assert(cold.every(task=>!task.context.includes('自有 40%')));
  assert(established.some(task=>/自有 40% \/ 外部 60%/.test(task.output)));
  assert(established.some(task=>/播放、点赞、转发、评论/.test(task.output)));
});

test('Z/H publication fixtures preserve a full day after both production and review',()=>{
  for(const [tasks,pairs] of [[cold,[['task-14','task-16'],['task-15','task-16'],['task-27','task-36'],['task-28','task-36']]],[established,[['h-task-12','h-task-15'],['h-task-13','h-task-15'],['h-task-16','h-task-20'],['h-task-28','h-task-20']]]] as const){
    const at=(id:string)=>{const task=tasks.find(item=>item.id===id)!;return Date.parse(`${task.date}T${task.time}:00+08:00`);};
    for(const [upstream,publishing] of pairs)assert(at(publishing)-at(upstream)>=86400000,`${publishing} must follow ${upstream} by at least 24h`);
  }
});

test('Z/H fixture deadlines avoid same-agent simultaneous delivery commitments',()=>{
  for(const tasks of [cold,established]) {
    const deadlines=new Map<string,string>();
    for(const task of tasks) {
      const key=`${task.date} ${task.time} ${task.agent}`;
      assert(!deadlines.has(key),`${task.id} conflicts with ${deadlines.get(key)} at ${key}`);
      deadlines.set(key,task.id);
    }
  }
  assert.match(established.find(task=>task.id==='h-task-17')!.context,/按需触发/);
});

test('calendar UI renders horizontal week, owner, overdue upload, channels, publishing and repair entries',()=>{
  for(const [tasks,profile] of [[cold,'B2B 零基础'],[established,'B2B 有基础']] as const){
    const html=renderToStaticMarkup(<AgentWeeklyCalendar startsAt="2026-10-05" tasks={[...tasks]} demo/>);
    assert.match(html,new RegExp(profile));
    for(const day of ['周一','周二','周三','周四','周五','周六','周日'])assert.match(html,new RegExp(`${day}任务`));
    for(const label of ['主负责','WhatsApp','Messenger','Instagram','上传已逾期','发布','创意返工','技术返工'])assert.match(html,new RegExp(label),`${profile} missing ${label}`);
    assert.match(html,/grid-cols-7/);
  }
});
