import assert from 'node:assert/strict';
import test from 'node:test';
import { projectContentWork, projectAdWork, projectCustomerWork, sortBusinessWork } from '../lib/businessWorkProjection';
import type { CreationTaskRow } from '../lib/creationTaskWorkspace';
import type { PlatformAdTask } from '../lib/platformAds';
import type { CustomerProfile } from '../types/customer';
import type { PlanOperatingData } from './useAdPlanOperatingData';
const row = (key: string, patch: Partial<CreationTaskRow> = {}): CreationTaskRow => ({key, title:key, cover:'',category:'creating',statusLabel:'待调度',sourceLabel:'对话创建',product:'产品',publishAt:'',createdAt:'',updatedAt:'',...patch});
const plan = (patch: Partial<PlatformAdTask> = {}): PlatformAdTask => ({id:'ad-original',name:'原计划',video:'原片',market:'US',goal:'获取消息会话',budget:100,currency:'CNY',channels:['Facebook'],creationSource:'manual',managementMode:'manual',status:'active',configuration:{startsAt:'',endsAt:'',dailyBudget:10,audience:'',placements:''},createdAt:'',updatedAt:'',...patch});
const customer = (patch: Partial<CustomerProfile> = {}): CustomerProfile => ({id:'buyer',name:'原买家',source:'whatsapp',stage:'inquiry',handlingMode:'human_needed',isReal:true,orders:[],intentSignals:[],tags:[],timeline:[],countryName:'AE',nextStep:'核对原询价',estimatedValue:'',lastActive:'',localTime:'',...patch} as CustomerProfile);

test('empty sources produce no padded cards; content keeps its own exact row/cover', () => {
  assert.deepEqual(projectContentWork([]), []); assert.deepEqual(projectAdWork([], {}), []); assert.deepEqual(projectCustomerWork([]), []);
  const first = row('first', {cover:'/own-cover'}), second = row('second');
  const result = projectContentWork([first,second,row('done',{category:'completed'})]);
  assert.equal(result.length,2);assert.equal(result[0].kind,'content');
  assert.ok(result.some(item=>item.kind==='content'&&item.row===first&&item.row.cover==='/own-cover'));
  assert.ok(result.some(item=>item.kind==='content'&&item.row===second&&!item.row.cover));
});
test('human action precedes ongoing work and real deadlines determine order', () => {
  const input=[row('running'),row('later',{category:'confirmation',publishAt:'2026-10-29'}),row('earlier',{category:'confirmation',publishAt:'2026-10-27'})];
  assert.deepEqual(projectContentWork(input).map(item=>item.id),['earlier','later','running']);
  assert.deepEqual(sortBusinessWork(projectContentWork(input)).map(item=>item.id),['earlier','later','running']);
});
test('ads cannot imply live delivery from a stored active state or fabricate zero spend', () => {
  const original=plan();const projected=projectAdWork([original],{});
  assert.equal(projected[0].status,'状态待回传');assert.equal(projected[0].id,original.id);
  assert.equal(projected[0].kind==='traffic'&&projected[0].task,original);
  assert.ok(!projected[0].next.includes('0'));
  const failed:PlanOperatingData={errors:['平台状态与预算读取失败','效果读取失败']};
  assert.equal(projectAdWork([original],{[original.id]:failed})[0].status,'平台状态读取失败');
  assert.equal(projectAdWork([original],{[original.id]:failed})[0].needsAction,true);
  assert.equal(projectAdWork([plan({status:'unknown'})],{})[0].needsAction,true);
  assert.ok(!projectAdWork([plan({status:'draft'})],{})[0].next.includes('尚未投放'), 'a stored draft alone is not proof of no platform execution');
});
test('customer cards exclude mock/history/read-only records and preserve exact conversation identity', () => {
  const original=customer({pendingDraft:'原草稿'});
  const result=projectCustomerWork([original,customer({id:'mock',isMock:true}),customer({id:'history',isHistorical:true}),customer({id:'readonly',readOnly:true}),customer({id:'done',todoCompletedAt:'2026-10-26'})]);
  assert.equal(result.length,1);assert.equal(result[0].kind==='customer'&&result[0].customer,original);
  assert.equal(result[0].status,'回复待确认');assert.equal(result[0].action,'查看回复草稿');assert.equal(result[0].next,'核对原询价');
});
