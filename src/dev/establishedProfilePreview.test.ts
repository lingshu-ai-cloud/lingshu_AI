import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {establishedProfilePreviewTasks} from './establishedProfilePreview';
import {agentCalendarEstablishedDemo} from './agentCalendarEstablishedDemo';

test('two H preview policies allocate five mother contents without mutating original fixture',()=>{
  const original=JSON.stringify(agentCalendarEstablishedDemo);
  for(const owned of [20,40] as const){
    const tasks=establishedProfilePreviewTasks(owned),text=JSON.stringify(tasks);
    assert.equal(new Set(tasks.map(task=>task.date)).size,7);
    assert.match(text,new RegExp(`自有 ${owned}% / 外部 ${100-owned}%`));
    assert.match(text,new RegExp(`${owned===20?1:2} 条自有迭代 \\+ ${owned===20?4:3} 条外部探索`));
    assert(!text.includes('真实')); assert(!text.includes('生产实况'));
    assert.deepEqual(tasks.map(task=>task.id),agentCalendarEstablishedDemo.map(task=>task.id));
    if(owned===20){assert.match(text,/自有候选视频 A/);assert.match(text,/外部增量参考 B\/C\/D\/E/);assert.match(text,/缺少证据不填零、不自动改配额/);assert(!text.includes('A/B'));assert(!text.includes('40/60'));}
  }
  assert.equal(JSON.stringify(agentCalendarEstablishedDemo),original);
});

test('preview reads the authenticated real calendar without demo task injection',()=>{
 const source=readFileSync(new URL('./SmartBusinessPreview.tsx',import.meta.url),'utf8');
 assert.match(source,/<SocialProgramProvider scope="smart-business-preview-live" enabled>/);
 assert.match(source,/真实周包、真实视频交付和 Agent 协作节点/);
 assert.doesNotMatch(source,/<SmartBusinessDashboard[^>]*calendarTasks=/);
 assert.doesNotMatch(source,/<SmartBusinessDashboard[^>]*calendarDemo/);
 assert.match(source,/goal: null/);
 assert.doesNotMatch(source,/工业控制器|calendarDemo|calendarTasks=/);
});

test('H individual videos keep source identity, shared barrier and day capacity in both policies',()=>{
 for(const owned of [20,40] as const){
  const tasks=establishedProfilePreviewTasks(owned);
  const publications=tasks.filter(task=>task.chain==='H-M6');
  assert.equal(publications.length,5);
  const instant=(task:typeof tasks[number])=>Date.parse(`${task.date}T${task.time}:00+08:00`);
  for(const publish of publications){
   const review=tasks.find(task=>task.id===publish.dependsOn![0])!;
   const production=tasks.find(task=>task.id===review.dependsOn![0])!;
   assert(instant(publish)-instant(review)>=86400000);
   assert(instant(review)>instant(production));
   assert(production.dependsOn!.includes('h-task-10'));
   const start=instant(production)-(production.minutes??0)*60000;
   for(const id of production.dependsOn!){assert(instant(tasks.find(task=>task.id===id)!)<=start,`${production.id} starts before ${id} finishes`);}
   assert(instant(review)-(review.minutes??0)*60000>=instant(production));
   assert.equal(production.affectedPublicationIds!.length,1);
  }
  assert.equal(publications.filter(task=>task.title.includes('自有迭代')).length,owned===20?1:2);
  assert.equal(tasks.filter(task=>task.id==='h-task-10').length,1);
  for(let day=5;day<=11;day++)for(const agent of ['business','director','content','customer']){
   const items=tasks.filter(task=>task.date===`2026-10-${String(day).padStart(2,'0')}`&&task.agent===agent);
   assert(items.length,`${day} ${agent} has no planned work`);
   assert(items.reduce((sum,task)=>sum+(task.minutes??0),0)<=420,`${day} ${agent} exceeds 7-hour daily capacity`);
  }
  assert(tasks.every(task=>task.status!=='completed'));
 }
});
