import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialOperatingPlanFingerprint, recommendFocusProducts, initialPlanVideoPlans, validateInitialPlan, validInitialPlanDeliveryDate, type InitialOperatingPlan } from './initialOperatingPlan';
import type { DigitalEmployeeConfig } from './digitalEmployees';
const config={companyName:'工厂',focusProducts:'',publishingTargets:[],customerProfile:'采购商',videoDefaults:{language:'en'}} as unknown as DigitalEmployeeConfig;
const plan:InitialOperatingPlan={stage:'b2b_launch',products:['产品A','产品B'],market:'北美',language:'en',platforms:['youtube','tiktok'],count:5,budgetCapCny:500,deliveryDate:'2026-10-20'};
test('five mother videos retain unique identity across two planned accounts without claiming connection',()=>{const videos=initialPlanVideoPlans(plan,config);assert.equal(videos.length,10);assert.equal(videos.filter(v=>v.productionRole==='master').length,5);assert.equal(new Set(videos.map(v=>v.contentFamilyId)).size,5);assert(videos.every(v=>v.matrix?.accountId.startsWith('planned:')));assert.equal(new Set(videos.map(v=>v.contentId)).size,10);});
test('focus recommendation prioritizes concrete product evidence without inventing products',()=>{assert.deepEqual(recommendFocusProducts([{name:'空白'},{name:'有图片',images:[{}]},{name:'完整',description:'事实',sku:'x',images:[{}]}]),['完整','有图片']);assert.deepEqual(recommendFocusProducts([]),[]);});
test('missing product and invalid budget cannot confirm a plan',()=>{assert.deepEqual(validateInitialPlan(plan,new Date('2026-10-10T12:00:00+08:00')),[]);assert.equal(validateInitialPlan({...plan,products:[],budgetCapCny:0},new Date('2026-10-10T12:00:00+08:00')).length,2);});
test('delivery date rejects impossible and past local calendar days',()=>{
  assert.equal(validInitialPlanDeliveryDate('2026-02-31'),false);
  assert.equal(validInitialPlanDeliveryDate('2026-02-28'),true);
  assert(validateInitialPlan({...plan,deliveryDate:'2026-02-31'},new Date('2026-02-01T12:00:00+08:00')).includes('请设置有效交付日期'));
  assert(validateInitialPlan({...plan,deliveryDate:'2026-10-09'},new Date('2026-10-10T12:00:00+08:00')).includes('交付日期不能早于今天'));
  assert.equal(validateInitialPlan({...plan,deliveryDate:'2026-10-10'},new Date('2026-10-10T23:59:00+08:00')).length,0);
});
test('plan fingerprint changes for operating edits but not a renewed collection request id',()=>{
  const fingerprint=initialOperatingPlanFingerprint(plan);
  assert.equal(initialOperatingPlanFingerprint({...plan,historyCollectionRequestId:'another-browser-session'}),fingerprint);
  assert.notEqual(initialOperatingPlanFingerprint({...plan,count:6}),fingerprint);
  assert.notEqual(initialOperatingPlanFingerprint({...plan,platforms:['youtube']}),fingerprint);
  assert.notEqual(initialOperatingPlanFingerprint({...plan,stage:'b2b_growth'}),fingerprint);
});
test('explicit account selection does not silently use the first connected account',()=>{const connected={...config,publishingTargets:[{platform:'youtube',accountId:'first',accountLabel:'一号'},{platform:'youtube',accountId:'second',accountLabel:'二号'}]} as DigitalEmployeeConfig;const videos=initialPlanVideoPlans({...plan,platforms:['youtube'],accountIds:{youtube:'second'}},connected);assert.equal(videos.length,5);assert(videos.every(v=>v.matrix?.accountId==='second'));});
