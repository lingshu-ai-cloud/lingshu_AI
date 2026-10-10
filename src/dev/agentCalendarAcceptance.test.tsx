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

test('calendar UI renders horizontal week, owner, overdue upload, channels, publishing and repair entries',()=>{
  for(const [tasks,profile] of [[cold,'B2B 零基础'],[established,'B2B 有基础']] as const){
    const html=renderToStaticMarkup(<AgentWeeklyCalendar startsAt="2026-10-05" tasks={[...tasks]} demo/>);
    assert.match(html,new RegExp(profile));
    for(const day of ['周一','周二','周三','周四','周五','周六','周日'])assert.match(html,new RegExp(`${day}任务`));
    for(const label of ['主负责','WhatsApp','Messenger','Instagram','上传已逾期','发布','创意返工','技术返工'])assert.match(html,new RegExp(label),`${profile} missing ${label}`);
    assert.match(html,/grid-cols-7/);
  }
});
