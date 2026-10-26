import assert from 'node:assert/strict';
import test from 'node:test';
import {resumeSceneTaskBatch} from './assistantSceneTaskBatch';
import type {AssistantCreationPortal} from '../../shared/contracts/assistantCreationPortal';
import {assistantScenarioIntake} from './assistantScenarioIntake';

test('partial activity failure retries only the unfinished row with the same operation key',async()=>{
  const portal={...assistantScenarioIntake('为活动准备内容')!,selectedProducts:[{id:'a',name:'产品'}],campaign:{name:'活动',type:'展会',objective:'询盘',startsAt:'2099-01-02T12:00',endsAt:'2099-01-03T12:00',items:[{id:'a',title:'预热',phase:'warmup' as const,publishAt:'2099-01-01T12:00'},{id:'b',title:'主推',phase:'launch' as const,publishAt:'2099-01-02T12:00'}]}};
  const rows=[{id:'a',input:{title:'预热',objective:'询盘'}},{id:'b',input:{title:'主推',objective:'询盘'}}],receipts:NonNullable<AssistantCreationPortal['createdTasks']>=[];
  const keys:string[]=[];let fail=true;
  const input={groupId:portal.id,rows,receipts,current:()=>true,onReceipt:(receipt:typeof receipts[number])=>{receipts.push(receipt);},create:async(value:typeof rows[number]['input'],key:string)=>{keys.push(key);if(value.title.includes('主推')&&fail){fail=false;throw Error('网络结果待核验');}return {taskId:value.title.includes('主推')?'task-b':'task-a',brief:{title:value.title}};}};
  await assert.rejects(resumeSceneTaskBatch(input),/待核验/);assert.equal(receipts.length,1);
  await resumeSceneTaskBatch(input);assert.equal(receipts.length,2);
  assert.equal(keys.length,3);assert.equal(keys[1],keys[2]);assert.notEqual(keys[0],keys[1]);
  await resumeSceneTaskBatch(input);assert.equal(keys.length,3);
});
test('a source attachment failure retains the real task and never creates it twice',async()=>{
  let creates=0,attaches=0;const receipts:NonNullable<AssistantCreationPortal['createdTasks']>=[];
  const input={groupId:'scene',rows:[{id:'hook',input:{title:'任务',objective:'目标'}}],receipts,current:()=>true,onReceipt:(receipt:typeof receipts[number])=>{const index=receipts.findIndex(row=>row.itemId===receipt.itemId);if(index<0)receipts.push(receipt);else receipts[index]=receipt;},
    create:async()=>{creates++;return {taskId:'saved',brief:{title:'任务'}};},attach:async()=>{if(++attaches===1)throw Error('关联失败');}};
  await assert.rejects(resumeSceneTaskBatch(input));assert.equal(receipts.length,1);
  await resumeSceneTaskBatch(input);assert.equal(creates,1);assert.equal(receipts[0].sourceAttached,true);
});


test('automatic start follows source attachment and a failed start resumes the original task',async()=>{
  const events:string[]=[],receipts:NonNullable<AssistantCreationPortal['createdTasks']>=[];let attempts=0;
  const input={groupId:'confirmed',rows:[{id:'one',input:{title:'任务',objective:'目标'}}],receipts,current:()=>true,
    onReceipt:(receipt:typeof receipts[number])=>{const index=receipts.findIndex(row=>row.itemId===receipt.itemId);if(index<0)receipts.push(receipt);else receipts[index]=receipt;},
    create:async()=>{events.push('create');return{taskId:'original',brief:{title:'任务'}};},
    attach:async(id:string)=>{assert.equal(id,'original');events.push('attach');},
    start:async(id:string)=>{assert.equal(id,'original');events.push('start');if(++attempts===1)throw Error('start unavailable');return {receipt:{queued:true,started:false}};}};
  await assert.rejects(resumeSceneTaskBatch(input),/start unavailable/);
  assert.equal(receipts[0].sourceAttached,true);assert.equal(receipts[0].startRequested,undefined);
  await resumeSceneTaskBatch(input);await resumeSceneTaskBatch(input);
  assert.deepEqual(events,['create','attach','start','start']);assert.equal(receipts[0].startRequested,true);
});

test('saved or blocked admission is not successful dispatch and preserves the task on retry',async()=>{
  const receipts:NonNullable<AssistantCreationPortal['createdTasks']>=[];let creates=0,starts=0;
  const input={groupId:'blocked',rows:[{id:'one',input:{title:'任务',objective:'目标'}}],receipts,current:()=>true,
    onReceipt:(receipt:typeof receipts[number])=>{receipts.splice(0,receipts.length,receipt);},
    create:async()=>{creates++;return {taskId:'existing',brief:{title:'任务'}};},
    start:async()=>{starts++;return {receipt:{queued:false,started:false,blockedReason:'waiting_for_input'}};}};
  await resumeSceneTaskBatch(input);assert.equal(receipts[0].startRequested,false);assert.equal(receipts[0].executionState,'blocked');
  await resumeSceneTaskBatch(input);assert.equal(creates,1);assert.equal(starts,2);
});
