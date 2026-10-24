import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CustomerInfoRail} from './ConversionCustomerRail';
import {createQuoteMockCustomers} from '../../mocks/quoteCustomerProfiles';
const priorWindow=Reflect.get(globalThis,'window'),priorStorage=Reflect.get(globalThis,'localStorage');
test.before(()=>{Object.assign(globalThis,{window:{},localStorage:{getItem:()=>null}});});
test.after(()=>{for(const [key,value] of [['window',priorWindow],['localStorage',priorStorage]] as const){if(value===undefined)Reflect.deleteProperty(globalThis,key);else Reflect.set(globalThis,key,value);}});
const noop=()=>{};
const props={onCustomerPatch:noop,onGenerateDraft:noop,onHandlingModeChange:noop,onToast:noop,onFocusReply:noop,onViewDraft:noop,onCompleteTodo:noop,customerServiceEnabled:false,autoReplyReady:false,hasReplyReady:false};
const customer=createQuoteMockCustomers()[0]!;
test('first failed analysis is unassessed and its failure stays traceable in existing disclosure',()=>{
 const html=renderToStaticMarkup(<CustomerInfoRail {...props} customer={{...customer,profileAnalysisStatus:'failed',profileAnalysisHasResult:false,intentScore:0,profileAnalysisErrorCode:'preview_profile_analysis_failed'}}/>);
 assert.match(html,/意向待评估/);assert.doesNotMatch(html,/意向 0/);assert.match(html,/画像分析：更新失败/);
 assert.match(html,/title="preview_profile_analysis_failed"/);assert.match(html,/<details[^>]*><summary[^>]*>客户画像与跟进依据/);
});
test('background refresh keeps prior valid score and explains freshness only inside existing disclosure',()=>{
 const html=renderToStaticMarkup(<CustomerInfoRail {...props} customer={{...customer,profileAnalysisStatus:'analyzing',profileAnalysisHasResult:true,profileAnalysisBuyerFingerprint:'current',profileAnalysisResultFingerprint:'previous',profileAnalysisUpdatedAt:'2026-10-24T10:00:00.000Z',intentScore:68}}/>);
 assert.match(html,/意向 68/);assert.match(html,/画像分析：后台更新中/);assert.match(html,/保留上次结果/);
 assert.doesNotMatch(html,/意向待评估/);assert.doesNotMatch(html,/<details[^>]* open/);
});
