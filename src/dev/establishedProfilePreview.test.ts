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
    assert.deepEqual(tasks.map(task=>[task.id,task.dependsOn]),agentCalendarEstablishedDemo.map(task=>[task.id,task.dependsOn]));
    if(owned===20){assert.match(text,/自有候选视频 A/);assert.match(text,/外部增量参考 B\/C\/D\/E/);assert.match(text,/缺少证据不填零、不自动改配额/);assert(!text.includes('A/B'));assert(!text.includes('40/60'));}
  }
  assert.equal(JSON.stringify(agentCalendarEstablishedDemo),original);
});

test('preview provides explicit policy switch and query URL without production persistence',()=>{
 const source=readFileSync(new URL('./SmartBusinessPreview.tsx',import.meta.url),'utf8');
 assert.match(source,/get\('ownedPercent'\)==='20'/);
 assert.match(source,/有基础用户来源配额预览/);
 assert.match(source,/仅切换示例，不保存真实配额/);
 assert.match(source,/Agent 的示例工作安排/);
 assert(!source.includes('两项真实素材'));
});
