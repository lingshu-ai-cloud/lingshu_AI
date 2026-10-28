import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { assistantSearchFailure, AssistantSearchFailure } from './AssistantSearchFailure';
import AgentReply from '../AgentReply';
const legacy = '总体结论：未取得可读取且符合时间范围的原文，暂不能确认近期动态。可补充具体主题，或明确改查历史资料。\n\n信息来源：本轮未取得通过核验的资料。';
const events = [{id:'search',label:'检索并核验公开来源',detail:legacy,status:'failed' as const}];

test('finished zero-source legacy retrieval normalizes to one failure and one specific reason without mutating history', () => {
  const input={content:legacy,sources:[],events}; const snapshot=JSON.stringify(input);
  const failure=assistantSearchFailure(input); assert.ok(failure);
  const html=renderToStaticMarkup(<AssistantSearchFailure failure={failure}/>);
  assert.equal((html.match(/本次检索未完成/gu)??[]).length,1);
  assert.match(html,/没有取得可读取并可核验/);
  assert.doesNotMatch(html,/总体结论|已核验来源|信息来源|分析未完成/);
  assert.equal(JSON.stringify(input),snapshot);
});
test('real provider failure reasons remain specific, with no fabricated success', () => {
  const failure=assistantSearchFailure({content:'搜索服务超时，本次检索失败。',events:[{...events[0],detail:'原文读取超时'}]});
  assert.match(failure!.reason,/超时/); assert.doesNotMatch(failure!.reason,/完成报告|已找到/);
});
test('streaming, successful reports, ordinary questions and company analysis are untouched', () => {
  assert.equal(assistantSearchFailure({content:legacy,events,active:true}),null);
  assert.equal(assistantSearchFailure({content:legacy,events,sources:[{title:'原文',uri:'https://example.com/article'}]}),null);
  for(const content of ['请提供可核验的数据。','本地没有资料，请上传产品手册。','核验后可用分析不足，本次不作为正式报告。','今天欧洲有什么行业动态？']) assert.equal(assistantSearchFailure({content}),null);
});
test('empty structured industry report and unfinished JSON are distinguished', () => {
  const raw='```industry-insight\n'+JSON.stringify({version:1,industry:'美妆原料',signals:[],metrics:[]})+'\n```';
  assert.ok(assistantSearchFailure({content:raw}));
  assert.equal(assistantSearchFailure({content:'```industry-insight\n{'}),null);
});
test('no-source news footer never creates an empty verified-source card', () => {
  const html=renderToStaticMarkup(<AgentReply content={legacy} sources={[]} presentation="news"/>);
  assert.doesNotMatch(html,/aria-label="已核验来源"/);
});

registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'export {};',shortCircuit:true}:next(url,context);}});
const {default: AssistantConversationBubbles}=await import('./AssistantConversationBubbles');
test('actual conversation bubble renders a failed retrieval once and hides both analysis duplication and empty sources', () => {
  const noop=()=>undefined;
  const html=renderToStaticMarkup(<AssistantConversationBubbles inlineHome page="strategy" productionContext={null} decisionFeedRevision={0} decisionFeedKey="test" decisionFeedActive={false} onOpenChat={noop} onOpenFeedDetail={noop} onFeedChange={noop} welcomeBubbleVisible={false} activeAgentLabel="灵小枢" reduceMotion messages={[{role:'assistant',content:legacy,sources:[],analysisWork:events,analysisComplete:false}]} onSuggest={noop} contentIntakeNode={null} loading={false} replyStreaming={false} focusedTaskCard={null} onOpenTaskDetail={noop} weeklyPlanKickoffAvailable={false} onOpenWeeklyPlan={noop} weeklyPlanExperience={{proposal:null,modalOpen:false,busy:false,error:'',celebrating:false,weeklyPlanOperating:false,prepare:async()=>'已打开经营总览中的当前周计划。计划范围、预算、版本和启动确认都在同一处处理。',open:noop,close:noop,confirm:async()=>undefined}}/>);
  assert.equal((html.match(/本次检索未完成/gu)??[]).length,1);
  assert.doesNotMatch(html,/总体结论|已核验来源|信息来源|实际分析过程|检索并核验公开来源/);
});

 test('network failures mentioning time range never masquerade as rejected publication dates',()=>{
 const result=assistantSearchFailure({content:'总体结论：因网络连接或站点访问限制未能读取，暂不能确认近期动态。信息来源：本轮未取得通过核验的资料。'});
 assert.match(result!.reason,/页面访问或读取失败/);
 });

test('real empty North America observation distinguishes readable but irrelevant evidence from access failure',()=>{
 const content='```industry-insight\n'+JSON.stringify({version:1,title:'专题观察',industry:'美妆个护与护肤品',market:'北美 B2B 美妆品牌主与私标采购商',period:'最近30天',generatedAt:'2026-10-28T13:57:16.135Z',summary:'暂无可展示的专题资料。',signals:[],limitations:['AI结论仅供参考']})+'\n```';
 const failure=assistantSearchFailure({content,sources:[]});assert.ok(failure);
 const html=renderToStaticMarkup(<AssistantSearchFailure failure={failure}/>);
 assert.match(html,/暂无符合条件的资讯/);assert.match(html,/已读取候选资料/);assert.match(html,/查询范围相关且证据充分/);
 assert.doesNotMatch(html,/没有取得可读取|本次检索未完成|页面访问或读取失败/);
 const network=assistantSearchFailure({content:'搜索服务读取失败，本次检索失败。',events:[{...events[0],detail:'网络连接导致原文读取失败'}]});
 assert.match(network!.reason,/页面访问或读取失败/);assert.doesNotMatch(network!.reason,/已读取候选资料/);
});
