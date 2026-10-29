import assert from 'node:assert/strict';
import test from 'node:test';
import { collectIndustryOriginals, uniqueIndustryOriginals } from './qwenIndustryDiscovery.js';
import { qwenDiscoveryQuery } from './qwenDiscoveryQuery.js';
import type { GroundingSource } from './llm.js';
import type { SearchOriginal } from '../externalInformation/searchEvidenceAnswer.js';
const source = (index: number, host = `publisher${index}.com`): GroundingSource => ({ title: `行业研究主题${index}`, uri: `https://${host}/article-${index}` });
const original = (source: GroundingSource, index: number): SearchOriginal => ({ id: `S${index}`, source, text: `${source.title}：原始研究证据与主题${index}直接相关。`.repeat(20), published: ['2026-10-20'] });
const reads = (sources: GroundingSource[]) => ({ originals: sources.map((item, index) => original(item, index + 1)), rejected: 0, rejectionReasons: {} });

test('affiliate shopping guide does not count toward sufficient sources and triggers the bounded supplement', async () => {
 const guide: GroundingSource = { title: 'Skincare fans are obsessed with this €23 collagen mask', uri: 'https://shopping.example/guide' };
 let discoveries = 0;
 const result = await collectIndustryOriginals([source(1), source(2), guide], {
  discover: async () => { discoveries++; return []; },
  read: async values => ({ originals: values.map((value, index) => ({ ...original(value, index + 1), text: value === guide ? 'This article contains affiliate links.' : original(value, index + 1).text })), rejected: 0, rejectionReasons: {} }),
 });
 assert.equal(discoveries, 1); assert.equal(result.originals.length, 2); assert.equal(result.discovery.supplemented, true);
});

test('zero initial candidates still receives one bounded discovery and empty evidence stays empty', async () => {
  let discoveries = 0, readCalls = 0;
  const result = await collectIndustryOriginals([], { discover: async () => { discoveries++; return []; }, read: async () => { readCalls++; return reads([]); } });
  assert.equal(discoveries, 1); assert.equal(readCalls, 0); assert.deepEqual(result.originals, []);
  assert.equal(result.discovery.reason, 'few-originals');
});
test('sparse first originals trigger one supplement, preserve original IDs and deduplicate repeated stories', async () => {
  const first = source(1), second = source(2); let discoveries = 0, readCalls = 0;
  const result = await collectIndustryOriginals([first], {
    discover: async instruction => { discoveries++; assert.match(instruction, /目标市场常用语言/); return [first, second]; },
    read: async values => { readCalls++; return reads(values); },
  });
  assert.equal(discoveries, 1); assert.equal(readCalls, 2); assert.equal(result.originals.length, 2);
  assert.equal(new Set(result.originals.map(item => item.id)).size, 2);
  assert.equal(result.originals[0].source.uri, first.uri);
});
test('three readable originals from multiple publishers skip supplemental calls', async () => {
  let discoveries = 0;
  const result = await collectIndustryOriginals([source(1), source(2), source(3)], { discover: async () => { discoveries++; return []; }, read: async values => reads(values) });
  assert.equal(discoveries, 0); assert.equal(result.discovery.reason, 'sufficient'); assert.equal(result.originals.length, 3);
});
test('three stories from one publisher still seek independent evidence', async () => {
  let discoveries = 0;
  const result = await collectIndustryOriginals([source(1, 'same.com'), source(2, 'same.com'), source(3, 'same.com')], { discover: async () => { discoveries++; return []; }, read: async values => reads(values) });
  assert.equal(discoveries, 1); assert.equal(result.discovery.reason, 'few-publishers');
});
test('supplemental failure retains verified originals and never retries', async () => {
  let discoveries = 0;
  const result = await collectIndustryOriginals([source(1)], { discover: async () => { discoveries++; throw Error('provider unavailable'); }, read: async values => reads(values) });
  assert.equal(discoveries, 1); assert.equal(result.originals.length, 1); assert.equal(result.discovery.supplementFailed, true);
});
test('original-read budget remains twenty four and failed first URLs never reappear', async () => {
  let readsCount = 0; const seen = new Set<string>();
  const result = await collectIndustryOriginals(Array.from({ length: 24 }, (_, index) => source(index)), {
    discover: async () => Array.from({ length: 30 }, (_, index) => source(index + 6)),
    read: async values => { for (const value of values) { assert.ok(!seen.has(value.uri)); seen.add(value.uri); } readsCount += values.length; return { originals: [], rejected: values.length, rejectionReasons: { unreadable: values.length } }; },
  });
  assert.equal(readsCount, 24); assert.equal(result.discovery.attemptedReads, 24); assert.equal(result.rejected, 24);
});
test('cancellation before and during supplement escapes without a retry or successful fallback', async () => {
  const before = new AbortController(); before.abort(new Error('cancel-before'));
  await assert.rejects(collectIndustryOriginals([source(1)], { signal: before.signal, discover: async () => [], read: async values => reads(values) }), /cancel-before/);
  const during = new AbortController();
  await assert.rejects(collectIndustryOriginals([source(1)], { signal: during.signal, discover: async () => { during.abort(new Error('cancel-during')); return []; }, read: async values => reads(values) }), /cancel-during/);
});
test('unchanged cached evidence avoids hidden supplemental spend', async () => {
  let discoveries = 0;
  const result = await collectIndustryOriginals([source(1)], { shouldSupplement: () => false, discover: async () => { discoveries++; return []; }, read: async values => reads(values) });
  assert.equal(discoveries, 0); assert.equal(result.discovery.reason, 'cache-unchanged');
});

test('republications with different domains and titles do not inflate independent evidence', () => {
  const item = original(source(1), 1);
  assert.equal(uniqueIndustryOriginals([item, { ...item, id: 'S2', source: source(2) }]).length, 1);
});
test('supplemental reader failure preserves first batch as well as discovery failure', async () => {
  let count = 0;
  const result = await collectIndustryOriginals([source(1)], { discover: async () => [source(2)], read: async values => { count++; if (count === 2) throw Error('read unavailable'); return reads(values); } });
  assert.equal(count, 2); assert.equal(result.originals.length, 1); assert.equal(result.discovery.supplementFailed, true);
});

test('publisher diversity is selected before the initial twelve-candidate cap', async () => {
  let discoveries = 0; let batch: GroundingSource[] = [];
  await collectIndustryOriginals([...Array.from({ length: 12 }, (_, index) => source(index, 'same.com')), source(21), source(22)], {
    discover: async () => { discoveries++; return []; },
    read: async values => { batch = values; return reads(values); },
  });
  assert.equal(batch.length, 12); assert.equal(discoveries, 0);
  assert.ok(batch.some(item => item.uri.includes('publisher21.com')));
  assert.ok(batch.some(item => item.uri.includes('publisher22.com')));
});


test('public commercial research and AI commentary are retained for topic observations', async () => {
 const initial = [source(1), source(2), source(3)];
 let discoveries = 0, readCount = 0;
 const result = await collectIndustryOriginals(initial, {
  discover: async () => { discoveries++; return [source(4)]; },
  read: async values => {
   readCount++;
   return { originals: values.map((value, index) => ({ ...original(value, index + 1), text: readCount === 1
    ? index === 0 ? '文章由AI基于公开信息生成。' : index === 1 ? '报告摘要介绍增长预测。报告目录列出章节。信息以最终报告为准，欢迎订购报告。' : original(value, index + 1).text
    : original(value, index + 1).text })), rejected: 0, rejectionReasons: {} };
  },
 });
 assert.equal(discoveries, 0); assert.equal(readCount, 1);
 assert.equal(result.discovery.reason, 'sufficient');
 assert.equal(result.originals.length, 3);
 assert.deepEqual(result.originals.map(value => value.source.uri), initial.map(value => value.uri));
 assert.equal(result.rejected, 0); assert.equal(result.rejectionReasons.quality, undefined);
});

test('supplemental public commentary is retained without content-type rejection counts', async () => {
 let readCount = 0;
 const result = await collectIndustryOriginals([source(1)], {
  discover: async () => [source(2)],
  read: async values => { readCount++; const result = reads(values); if (readCount === 2) result.originals[0].text = 'This article was generated by AI based on public information.'; return result; },
 });
 assert.equal(result.originals.length, 2); assert.equal(result.rejected, 0); assert.equal(result.rejectionReasons.quality, undefined);
});

test('real reporting and research remain eligible regardless of publisher identity', () => {
 const values = [original(source(1), 1), original(source(2), 2), original(source(3), 3)];
 values[0].text = '官网公告：公司披露原料研究合作及拟开展的测试，最终结果以后续公告为准。';
 values[1].text = '行业媒体独立采访：合作已经签约，尚未披露量产结果。';
 values[2].text = '研究摘要：方法包括公开样本和对照试验，结果报告实际观察，并讨论预测的不确定性。';
 assert.equal(uniqueIndustryOriginals(values).length, 3);
});

test('redirect request budget is shared across rounds and exhaustion skips a pointless paid supplement', async()=>{
 let discovered=0;
 const result=await collectIndustryOriginals([source(1)],{discover:async()=>{discovered++;return [source(2)];},read:async(_values,options)=>{assert.equal(options?.articleRequestBudget?.remaining,24);options!.articleRequestBudget!.remaining=0;return {originals:[],rejected:1,rejectionReasons:{unreadable:1,request_budget:1}};}});
 assert.equal(discovered,0);assert.equal(result.discovery.reason,'request-budget');
 let budget:object|undefined,reads=0;
 await collectIndustryOriginals([source(1)],{discover:async()=>[source(2)],read:async(values,options)=>{reads++;if(reads===1){budget=options!.articleRequestBudget;options!.articleRequestBudget!.remaining=12;}else{assert.equal(options!.articleRequestBudget,budget);assert.equal(options!.articleRequestBudget!.remaining,12);}return {originals:[],rejected:values.length,rejectionReasons:{unreadable:values.length}};}});
 assert.equal(reads,2);
});

test('coupon acquisition articles never consume read budget while genuine price and supply news remain eligible', async () => {
 const coupon = { ...source(1), title: '双十一大牌美妆护肤降价来了！唯品会搜【大牌666】抢双11红包优惠券，抄底价最低1折_即时新闻_大众网' };
 const price = { ...source(2), title: '原料价格上涨促使北美化妆品工厂调整采购计划' };
 const supply = { ...source(3), title: '北美美妆包装供应链降价及产能变化' };
 let readCount = 0;
 const result = await collectIndustryOriginals([coupon, price, supply], {
  discover: async () => [{ ...source(4), title: '领取优惠码获得专属护肤折扣' }],
  read: async values => { readCount += values.length; assert.ok(!values.some(value => value.uri === coupon.uri)); return reads(values); },
 });
 assert.equal(readCount, 2); assert.deepEqual(result.originals.map(value => value.source.title), [price.title, supply.title]);
 assert.deepEqual(uniqueIndustryOriginals([original(coupon, 1)]), [], 'cached or merged coupon originals cannot bypass candidate filtering');
});


test('encyclopedia-only initial metadata carries its actual failure and missing themes into bounded regional supplement', async () => {
 const initial:GroundingSource={title:'DCL',uri:'https://baike.baidu.com/item/DCL/56507853'};
 // Same source shape as the real daily run: three lv-1 articles among ten metadata candidates.
 const urls=['https://www.lv-1.cn/BeautyNews/article/2026-10-27-daily','https://www.lv-1.cn/BeautyNews/article/2026-10-26-daily','http://news.10jqka.com.cn/m680949669/','https://weibo.com/2/detail/5357139348688669','https://finance.sina.com.cn/roll/2026-10-10/doc-iniutyyz6019269.shtml','https://www.zmuni.com/zh-hans/news/canada/','https://www.fortunebusinessinsights.com/zh/cosmetics-market-102614','https://www.xhby.net/content/article.html','https://www.fortunebusinessinsights.com/zh/u-s-cosmetics-market-108012','https://www.lv-1.cn/BeautyNews/article/2026-10-24-daily'];
 const question='今日资讯。\n已明确的查询范围：'+JSON.stringify({industry:'美妆个护与护肤品',products:'护肤品、洗发水',market:'北美 B2B品牌主'});
 let readCount=0,discoveries=0;let query='';
 const result=await collectIndustryOriginals([initial],{
  discover:async instruction=>{discoveries++;query=qwenDiscoveryQuery(question,30,instruction);return urls.map((uri,index)=>({title:`候选原文${index}`,uri}));},
  read:async values=>{readCount++;if(readCount===1)return {originals:[],rejected:1,rejectionReasons:{unreadable:1}};
   assert.equal(values.length,10);assert.equal(new Set(values.map(value=>new URL(value.uri).hostname)).size,7);
   assert.equal(values.filter(value=>value.uri.includes('lv-1.cn')).length,3);
   assert.ok(values.every(value=>value.uri!==initial.uri));return reads(values);},
 });
 assert.equal(discoveries,1);assert.equal(readCount,2);assert.equal(result.discovery.attemptedReads,11);
 assert.match(query,/本轮未读成或日期不合格的域名：baike\.baidu\.com/);
 assert.match(query,/监管与行业标准、市场与竞争动作、技术与研究、供应链与生产/);
 assert.match(query,/必须直接支持North America \(US, Canada\)/);
 assert.match(query,/United States skincare regulation standards/);
 assert.match(query,/Canada haircare manufacturing supply chain partnerships/);
 assert.match(query,/回避重复失败候选.*其他可读发布者/);
 assert.doesNotMatch(query,/site:|assigned_site_list/);
});

test('single publisher can follow explicit outbound citations without another discovery or exceeding shared budget', async () => {
 const start=source(1,'digest.com'), linked=source(9,'original.com');let calls=0,discoveries=0;let budget:object|undefined;
 const result=await collectIndustryOriginals([start],{discover:async()=>{discoveries++;return [];},read:async(values,options)=>{
  calls++;budget??=options!.articleRequestBudget;assert.equal(options!.articleRequestBudget,budget);
  const result=reads(values);if(calls===1)result.originals[0].relatedSources=[linked,linked,start];return result;
 }});
 assert.equal(discoveries,1);assert.equal(calls,2);assert.equal(result.discovery.attemptedReads,2);
 assert.deepEqual(result.originals.map(value=>value.source.uri),[start.uri,linked.uri]);
 assert.equal(new Set(result.originals.map(value=>value.id)).size,2);
});
test('outbound citation follow preserves first evidence on failure and obeys cancellation and remaining transport budget', async()=>{
 const start=source(1,'digest.com');let calls=0;
 const result=await collectIndustryOriginals([start],{discover:async()=>[],read:async(values,options)=>{
  calls++;if(calls>1)throw Error('read-failed');const result=reads(values);result.originals[0].relatedSources=[source(2)];options!.articleRequestBudget!.remaining=0;return result;
 }});assert.equal(calls,1);assert.equal(result.originals.length,1);
 const controller=new AbortController();
 await assert.rejects(collectIndustryOriginals([start],{signal:controller.signal,discover:async()=>[],read:async values=>{
  const result=reads(values);if(values[0].uri===start.uri)result.originals[0].relatedSources=[source(2)];else controller.abort(Error('cancel-links'));return result;
 }}),/cancel-links/);
});

test('failed outbound original never discards digest evidence and no unverified link becomes a citation',async()=>{
 const start=source(1,'digest.com');let calls=0;
 const result=await collectIndustryOriginals([start],{discover:async()=>[],read:async values=>{
  calls++;if(calls===2)throw Error('linked-read-failed');const result=reads(values);result.originals[0].relatedSources=[source(2)];return result;
 }});assert.equal(calls,2);assert.deepEqual(result.originals.map(value=>value.source.uri),[start.uri]);
});

test('public discovery reads consume the same twenty-four transport budget before supplemental articles',async()=>{
 let calls=0;
 const result=await collectIndustryOriginals(Array.from({length:12},(_,index)=>source(index)),{discover:async(_instruction,budget)=>{assert.equal(budget.remaining,12);budget.remaining-=2;return Array.from({length:20},(_,index)=>source(index+20));},read:async(values,options)=>{
  calls++;if(calls===1){assert.equal(values.length,12);options!.articleRequestBudget!.remaining-=12;return {originals:[],rejected:12,rejectionReasons:{unreadable:12}};}
  assert.equal(values.length,10);assert.equal(options!.articleRequestBudget!.remaining,10);options!.articleRequestBudget!.remaining-=10;return reads(values);
 }});assert.equal(calls,2);assert.equal(result.discovery.attemptedReads,22);
});
