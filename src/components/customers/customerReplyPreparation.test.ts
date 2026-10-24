import assert from 'node:assert/strict';
import test from 'node:test';
import type {CustomerProfile} from '../../types/customer';
import {isWaitingForHumanQuote, replyLanguage, requestDraft} from './customerReplyPreparation';

const customer = {
  id: 'customer-1',
  name: 'Buyer',
  language: '英语',
  product: 'Widget',
  outboundProduct: 'Widget',
  stage: 'lead',
  handlingReason: '',
  timeline: [{id: 'buyer-1', type: 'messenger', actor: 'buyer', body: 'What is the unit price?', timestamp: Date.now()}],
} as unknown as CustomerProfile;

test('reply preparation keeps quote questions in the human lane', () => {
  assert.equal(replyLanguage(customer), 'English');
  assert.equal(isWaitingForHumanQuote(customer), true);
  assert.equal(isWaitingForHumanQuote({...customer, timeline: [{...customer.timeline[0], body: 'Hello'}]}), false);
});

test('explicit manual draft preserves its request marker and editable Chinese draft', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let requestBody: Record<string, unknown> | undefined;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {getItem: () => null},
  });
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({draft: 'Please share the quantity.', translatedDraft: '请提供数量。'}), {
      status: 200,
      headers: {'Content-Type': 'application/json'},
    });
  };
  try {
    const result = await requestDraft(customer, '请生成草稿', undefined, 'reply', true);
    assert.equal(requestBody?.manualRequest, true);
    assert.equal(requestBody?.customerId, customer.id);
    assert.equal(result.draft, '请提供数量。');
    assert.equal(result.originalDraft, 'Please share the quantity.');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete (globalThis as {localStorage?: Storage}).localStorage;
  }
});

test('HTTP failure produces an explicit empty result and successful replies retain decisions and fact versions',async()=>{
 const originalFetch=globalThis.fetch,storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>null}});
 try{
  globalThis.fetch=async()=>new Response(JSON.stringify({error:'upstream_unavailable'}),{status:503});
  const unavailable=await requestDraft(customer);assert.equal(unavailable.draft,'');assert.equal(unavailable.code,'upstream_unavailable');assert.equal(unavailable.status,'blocked');
  globalThis.fetch=async()=>new Response(JSON.stringify({draft:'Safe original',translatedDraft:'已核对原文',decision:{execution:'human_required'},verification:{status:'safe_fallback',issues:['model_down']},enterpriseFactVersion:'facts-v3',status:'degraded',generationSource:'degraded'}),{status:200});
  const reply=await requestDraft(customer);assert.equal(reply.enterpriseFactVersion,'facts-v3');assert.equal(reply.decision?.execution,'human_required');assert.equal(reply.verification?.status,'safe_fallback');assert.equal(reply.status,'degraded');
 }finally{globalThis.fetch=originalFetch;if(storage)Object.defineProperty(globalThis,'localStorage',storage);else delete(globalThis as any).localStorage;}
});
