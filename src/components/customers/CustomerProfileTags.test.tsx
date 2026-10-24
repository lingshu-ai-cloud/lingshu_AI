import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createQuoteMockCustomers } from '../../mocks/quoteCustomerProfiles';
import { customerProfileTags, customerFollowupStatus } from './customerTagPresentation';
import { CustomerProfileTags } from './CustomerProfileTags';
import { ChatThread } from './ConversionChatThread';
import { correctCustomerTag, applyTagCorrections, customerTagCorrectionInput } from '../../../shared/contracts/customerTags';
import { projectCustomerBusinessProfile, buyerConversationFingerprint } from '../../../server/customerService/businessProfile';
import { saveCustomerTagCorrection } from '../../lib/customerTagCorrection';

const buyer = createQuoteMockCustomers()[0]!;
const at = '2026-10-24T07:00:00.000Z';
test('state and attribution stay outside dimensional tags; only four tags render until expanded', () => {
  const customer = { ...buyer, tags: [...buyer.tags, '询价中', 'WhatsApp'] };
  const tags = customerProfileTags(customer);
  assert.equal(customerFollowupStatus(customer), '待报价');
  assert.ok(tags.every(t => !['询价中', 'WhatsApp'].includes(t.label)));
  assert.equal(tags.find(t => t.label === '明确交期')?.source, 'ai');
  const html = renderToStaticMarkup(<CustomerProfileTags customer={customer} onUpdated={() => {}} />);
  assert.match(html, /客户属性/); assert.match(html, /产品需求/); assert.match(html, /采购信号/);
  assert.match(html, /明确交期 · AI/); assert.doesNotMatch(html, />图纸 B2</);
  assert.match(html, /查看全部标签与纠正记录/);
});
test('human correction preserves original evidence, survives future classification, and rejects stale edits', () => {
  const input = { tag: '明确交期', replacement: '交期待再次确认', dimension: 'risk' as const, reason: '客户尚未确认产能排期', expectedUpdatedAt: null };
  const corrected = correctCustomerTag(buyer.tags, [], input, at, buyer.contextTagEvidence);
  assert.ok(!corrected.tags.includes('明确交期')); assert.ok(corrected.tags.includes('交期待再次确认'));
  assert.deepEqual(applyTagCorrections(['明确交期'], corrected.contextTagCorrections), ['交期待再次确认']);
  const projected = customerProfileTags({ ...buyer, ...corrected });
  const tag = projected.find(t => t.label === '交期待再次确认')!;
  assert.equal(customerProfileTags({ ...buyer, ...corrected, contextTagEvidence: [] }).find(t=>t.key==='明确交期')?.evidence?.[0]?.excerpt, 'within 30 days');
  assert.equal(tag.source, 'human'); assert.equal(tag.dimension, 'risk'); assert.equal(tag.evidence?.[0]?.excerpt, 'within 30 days');
  assert.throws(() => correctCustomerTag(corrected.tags, corrected.contextTagCorrections, input, at), /conflict/);
  const removed = correctCustomerTag(corrected.tags, corrected.contextTagCorrections, { ...input, replacement: null, expectedUpdatedAt: at }, '2026-10-24T07:01:00.000Z');
  assert.deepEqual(applyTagCorrections(['明确交期'], removed.contextTagCorrections), []);
  const timeline = buyer.timeline.map(t => ({ ...t }));
  const profile = projectCustomerBusinessProfile({ id: buyer.id, timeline }, { contextTagsAnalysisVersion: 5, contextTagsBuyerFingerprint: buyerConversationFingerprint(timeline), contextTagEvidence: buyer.contextTagEvidence, contextTagCorrections: corrected.contextTagCorrections });
  assert.deepEqual(profile.tags, ['交期待再次确认']);
  assert.deepEqual(profile.contextTagEvidence, buyer.contextTagEvidence);
});
test('permission restrictions cannot be removed through tag correction; input stays bounded', async () => {
  assert.throws(() => correctCustomerTag(['退订'], [], { tag: '退订', replacement: null, dimension: 'risk', reason: '错误', expectedUpdatedAt: null }, at), /permission_separate/);
  assert.equal(customerTagCorrectionInput.safeParse({ tag: '明确交期', replacement: '', dimension: 'unknown', reason: '', expectedUpdatedAt: null }).success, false);
  await assert.rejects(saveCustomerTagCorrection({ ...buyer, readOnly: true }, {tag:'明确交期',replacement:null,dimension:'signal',reason:'纠正',expectedUpdatedAt:null}), /只读/);
});
test('an unconfirmed HTTP save cannot clear customer tags or masquerade as a successful correction', async () => {
  const original = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable:true, value:{getItem:()=>null} });
  let calls=0;
  try {
    globalThis.fetch=async()=>{calls++;return Response.json({ok:true});};
    await assert.rejects(saveCustomerTagCorrection({...buyer,isMock:false}, {tag:'明确交期',replacement:null,dimension:'signal',reason:'原文不足',expectedUpdatedAt:null}), /未确认/);
    assert.equal(calls,1); assert.ok(buyer.tags.includes('明确交期'));
  } finally { globalThis.fetch=original;if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else Reflect.deleteProperty(globalThis,'localStorage'); }
});
test('quote stays in composer without AI identity; actual AI suggestion never silently truncates paragraphs', () => {
  const quote = ['Hi Alex,', '500 pcs at USD 12.50', 'Total USD 6250', 'FOB Los Angeles', 'Payment: 30% deposit', 'Valid 15 days'].join('\n\n');
  const noop = () => {};
  const props = { customer: buyer, input: quote, translatedInput:'', onInputChange:noop,onDraftChange:noop,onTranslatedInputChange:noop,onSend:noop,onSaveDraft:noop,savingDraft:false,onSendDraft:noop,onDismissDraft:noop,onRegenerateDraft:noop,onSceneDraft:noop,onPreviewTranslate:async()=>{},templates:[],onManualActive:noop,priceRulesReady:true,draftMeta:null,onToast:noop,onInsertQuoteReply:noop,onQuoteCardSent:noop };
  const composer = renderToStaticMarkup(<ChatThread {...props} draftSuggestion={null} />);
  assert.match(composer, /Valid 15 days/); assert.doesNotMatch(composer, /data-draft-suggestion/);
  const ai = renderToStaticMarkup(<ChatThread {...props} draftSuggestion={quote} />);
  assert.match(ai, /编辑第 6 条短消息/); assert.match(ai, /Valid 15 days/);
});
