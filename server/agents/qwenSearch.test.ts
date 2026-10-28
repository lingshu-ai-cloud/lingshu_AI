import assert from 'node:assert/strict';
import test from 'node:test';
import { callLLM, callLLMChatStream, type StreamEvent } from './llm.js';
import { qwenSearchAnswer, validatedSearchSources, assertRecentSearchAnswer } from './qwenSearch.js';
import { withExactQwenScope } from './exactQwenScope.js';

test('Qwen uses native source-capable API once and appends actual sources to every searched answer', async () => {
  const savedFetch = globalThis.fetch;
  const keys = ['QWEN_SEARCH_ENDPOINT', 'DASHSCOPE_API_KEY', 'OVERSEAS_LLM_BACKEND'] as const;
  const saved = keys.map(key => process.env[key]);
  process.env.QWEN_SEARCH_ENDPOINT = 'https://fixture.invalid/api/v1/services/aigc/text-generation/generation';
  process.env.DASHSCOPE_API_KEY = 'fixture-only';
  process.env.OVERSEAS_LLM_BACKEND = 'qwen';
  let calls = 0;
  let sources: unknown[] = [{ index: 1, title: '海关统计公告', url: 'https://www.customs.gov.cn/report' }];
  let finish = 'stop';
  globalThis.fetch = async (input, init) => {
    if (new URL(String(input)).hostname === 'www.customs.gov.cn') return new Response('<h1>海关统计公告</h1><p>核验后的行业结论仅对应本轮公开发布资料。' + '原始公告真实正文。'.repeat(12) + '</p>');
    calls++;
    assert.equal(String(input), process.env.QWEN_SEARCH_ENDPOINT);
    const request = JSON.parse(String(init?.body));
    assert.equal(request.parameters.search_options.enable_source, true);
    assert.equal(request.parameters.search_options.search_strategy, 'turbo');
    assert.deepEqual(request.parameters.search_options.assigned_site_list, ['customs.gov.cn']);
    assert.equal(request.stream, undefined);
    return Response.json({ output: { choices: [{ message: { content: '“核验后的行业结论仅对应本轮公开发布资料”[1]\n\n总体结论：已核对本轮公开资料，不能据此判断企业本身经营表现。' }, finish_reason: finish }], search_info: { search_results: sources } } });
  };
  const messages = [{ role: 'user' as const, content: '查海关资讯' }];
  const collect = async (options = {}) => {
    const events: StreamEvent[] = [];
    for await (const event of callLLMChatStream(messages, { requireSources: true, searchDomains: ['customs.gov.cn'], ...options })) events.push(event);
    return events;
  };
  try {
    const events = await collect();
    assert.equal(events.length, 2);
    assert.ok('sources' in events[0]);
    assert.ok('text' in events[1]);
    const answer = (events[1] as { text: string }).text;
    assert.match(answer, /核验后的行业结论/);
    assert.match(answer, /信息来源（查询时间/);
    assert.ok(answer.endsWith('(https://www.customs.gov.cn/report)'));
    assert.equal(calls, 1);
    const plain = await callLLM('查询资讯', { webSearch: true, searchDomains: ['customs.gov.cn'] });
    assert.match(plain, /信息来源/);
    assert.equal(calls, 2);
    sources = [];
    const leaked: StreamEvent[] = [];
    await assert.rejects(async () => {
      for await (const event of callLLMChatStream(messages, { requireSources: true, searchDomains: ['customs.gov.cn'] })) leaked.push(event);
    }, /可核验来源/);
    assert.deepEqual(leaked, []);
    assert.equal(calls, 3, 'no ungrounded retry');
    sources = [{ title: '伪官方域名', url: 'https://customs.gov.cn.evil.example/report' }];
    await assert.rejects(collect(), /来源要求/);
    sources = [{ index: 1, title: '海关统计公告', url: 'https://customs.gov.cn/report' }]; finish = 'length';
    await assert.rejects(collect(), /完整生成/);
    assert.equal(calls, 5);
    await assert.rejects(withExactQwenScope({ model: 'qwen-plus', configurationHash: 'fixture' }, collect), /受约束执行任务/);
    assert.equal(calls, 5, 'search cannot bypass an exact execution budget/provider binding');
  } finally {
    globalThis.fetch = savedFetch;
    keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
  }
});

test('source links are validated without trusting model-written URL strings', () => {
  assert.throws(() => validatedSearchSources([{ url: 'javascript:alert(1)' }]), /链接无效/);
  assert.throws(() => validatedSearchSources([{ url: 'https://user:pass@example.com/' }]), /链接无效/);
  assert.throws(() => validatedSearchSources([{ url: 'http://127.0.0.1/' }]), /链接无效/);
  assert.equal(validatedSearchSources([{ title: '官方', url: 'https://stats.customs.gov.cn/' }], ['customs.gov.cn']).length, 1);
});
test('recent-news answers reject old/future/absent dates instead of presenting historical releases as upcoming', () => {
  const now = Date.parse('2026-10-25T00:00:00Z');
  assert.doesNotThrow(() => assertRecentSearchAnswer('2026年10月20日发布的官方公告', 30, now));
  for (const text of ['2025年8月29日发布，即将上线', '2026年7月17日发布的最新政策', '近期发布了最新规则', '2026年11月25日已经发布', '2026年2月30日']) assert.throws(() => assertRecentSearchAnswer(text, 30, now));
});

test('unknown compatible endpoint does not silently send credentials to a different native provider', async () => {
  const previousEndpoint = process.env.QWEN_SEARCH_ENDPOINT, previousBase = process.env.DASHSCOPE_BASE_URL;
  const originalFetch = globalThis.fetch;
  delete process.env.QWEN_SEARCH_ENDPOINT;
  process.env.DASHSCOPE_BASE_URL = 'https://custom-provider.invalid/compatible-mode/v1';
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected provider call'); };
  try {
    await assert.rejects(async () => {
      for await (const event of callLLMChatStream([{ role: 'user', content: '最新资讯' }], { backend: 'qwen', requireSources: true })) void event;
    }, /尚未配置/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousEndpoint === undefined) delete process.env.QWEN_SEARCH_ENDPOINT; else process.env.QWEN_SEARCH_ENDPOINT = previousEndpoint;
    if (previousBase === undefined) delete process.env.DASHSCOPE_BASE_URL; else process.env.DASHSCOPE_BASE_URL = previousBase;
  }
});

test('Gemini searched answers also end with sources; internal calls do not enable Google Search', async () => {
  const originalFetch = globalThis.fetch, previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'gemini-fixture-only';
  let searched = true, returnSources = true;
  globalThis.fetch = async (input, init) => {
    if (new URL(String(input)).hostname === 'www.customs.gov.cn') return new Response('<h1>海关公告真实发布</h1><p>Gemini 核验结论仅限本轮原始发布资料。' + '真实正文'.repeat(30) + '</p>');
    const body = input instanceof Request ? await input.clone().json() : JSON.parse(String(init?.body));
    assert.equal(Boolean(body.tools?.some((tool: Record<string, unknown>) => tool.googleSearch)), searched);
    return new Response(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: searched ? '“Gemini 核验结论仅限本轮原始发布资料”\n\n总体结论：这份资料只支持公开发布范围内的判断，不证明企业经营结果。' : 'Gemini 核验结论' }] },
      finishReason: 'STOP', ...(returnSources ? { groundingMetadata: { groundingChunks: [{ web: { title: '海关公告真实发布', uri: 'https://www.customs.gov.cn/fixture' } }] } } : {}) }] })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    let text = '';
    for await (const event of callLLMChatStream([{ role: 'user', content: '海关资讯' }], { backend: 'gemini', requireSources: true, searchDomains: ['customs.gov.cn'] })) if ('text' in event) text += event.text;
    assert.ok(text.endsWith('(https://www.customs.gov.cn/fixture)'));
    returnSources = false;
    const leaked: StreamEvent[] = [];
    await assert.rejects(async () => {
      for await (const event of callLLMChatStream([{ role: 'user', content: '海关资讯' }], { backend: 'gemini', requireSources: true })) leaked.push(event);
    }, /可核验来源/);
    assert.deepEqual(leaked, []);
    searched = false;
    text = '';
    for await (const event of callLLMChatStream([{ role: 'user', content: '任务进度' }], { backend: 'gemini', webSearch: false })) if ('text' in event) text += event.text;
    assert.equal(text, 'Gemini 核验结论');
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('required final conclusion is checked before ordinary chat releases text, without a second model call', async () => {
  const originalFetch = globalThis.fetch, previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'fixture-only';
  let answer = '任务没有开始，没有任何历史进展。', calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] }, finishReason: 'STOP' }] })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const leaked: StreamEvent[] = [];
    await assert.rejects(async () => {
      for await (const event of callLLMChatStream([{ role: 'user', content: '任务进度' }], { backend: 'gemini', requireConclusion: true })) leaked.push(event);
    }, /总体结论：本轮回答未完整/);
    assert.deepEqual(leaked, []); assert.equal(calls, 1);
    answer = '本轮记录显示任务等待处理。\n\n总体结论：当前需先确认记录中的阻塞点，其他历史进度本轮尚未核验。';
    const complete: StreamEvent[] = [];
    for await (const event of callLLMChatStream([{ role: 'user', content: '任务进度' }], { backend: 'gemini', requireConclusion: true })) complete.push(event);
    assert.deepEqual(complete, [{ text: answer }]); assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousKey;
  }
});


test('the configured Qianwen MaaS default resolves source-capable search on the same provider origin', async () => {
  const savedEndpoint=process.env.QWEN_SEARCH_ENDPOINT, savedBase=process.env.DASHSCOPE_BASE_URL, savedKey=process.env.DASHSCOPE_API_KEY;
  const original=globalThis.fetch; delete process.env.QWEN_SEARCH_ENDPOINT; delete process.env.DASHSCOPE_BASE_URL; process.env.DASHSCOPE_API_KEY='fixture-only';
  let called=''; globalThis.fetch=async(input)=>{called=String(input);return Response.json({code:'fixture_stop'});};
  try {
    await assert.rejects(async()=>{for await(const event of callLLMChatStream([{role:'user',content:'最新资讯'}],{backend:'qwen',requireSources:true})) void event;},/未完成请求/);
    assert.equal(called,'https://maas.qianwenaiapi.com/api/v1/services/aigc/text-generation/generation');
  } finally {
    globalThis.fetch=original;
    for(const [key,value] of [['QWEN_SEARCH_ENDPOINT',savedEndpoint],['DASHSCOPE_BASE_URL',savedBase],['DASHSCOPE_API_KEY',savedKey]]) {if(value===undefined)delete process.env[key!];else process.env[key!]=value;}
  }
});

test('news retrieval reads originals before one JSON synthesis and never treats the discovery narrative as evidence',async()=>{
 const previousAnalysisModel=process.env.QWEN_NEWS_ANALYSIS_MODEL;process.env.QWEN_NEWS_ANALYSIS_MODEL='qwen3.8-max';
 const previous=process.env.DASHSCOPE_API_KEY, originalFetch=globalThis.fetch, previousEndpoint=process.env.QWEN_SEARCH_ENDPOINT;
 process.env.DASHSCOPE_API_KEY='fixture-only';process.env.QWEN_SEARCH_ENDPOINT='https://fixture.invalid/api/v1/services/aigc/text-generation/generation';
 let modelCalls=0, originalReads=0, blockOriginal=false;
 const quote='The platform announced a new tool for professional content creators.';
 globalThis.fetch=async(input,init)=>{
  if(String(input).includes('www.tiktok.com')) { originalReads++; if(blockOriginal)return new Response('blocked',{status:403}); return new Response(`<article><h1>Platform creator announcement</h1><p>${quote}${' Original public text.'.repeat(15)}</p></article>`); }
  const body=JSON.parse(String(init?.body));modelCalls++;
  if(body.parameters?.enable_search)return Response.json({output:{choices:[{message:{content:'Discovery narrative contains INVENTED_9999; never reuse it.'},finish_reason:'stop'}],search_info:{search_results:[{index:9,title:'Platform creator announcement',url:'https://www.tiktok.com/creator-announcement'}]}}});
  assert.equal(body.model,'qwen3.8-max');assert.equal(body.enable_search,false);assert.equal(body.response_format.type,'json_object');assert.ok(!body.messages[1].content.includes('INVENTED_9999'));
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[{sourceId:'S1',fact:'平台发布了面向专业内容创作者的新工具。',quoteIds:['S1-Q1'],meaning:'可能为内容生产提供新的工具，效果仍需验证。',action:'建议先核对目标账号的功能开放状态，再做小样本测试。'}],conclusion:'本轮可以确认官方发布的工具信息，无法据此判断账号实际热度或销量。'})}}]});
 };
 try{
  let answer='';for await(const event of callLLMChatStream([{role:'user',content:'社交媒体资讯，TikTok创作者工具'}],{backend:'qwen',requireSources:true,searchEvidenceFirst:true,searchDomains:['tiktok.com']}))if('text'in event)answer+=event.text;
  assert.equal(modelCalls,2);assert.match(answer,/总体结论/);assert.match(answer,/原文摘录/);assert.ok(!answer.includes('INVENTED_9999'));
  let reused='';for await(const event of callLLMChatStream([{role:'user',content:'社交媒体资讯，TikTok创作者工具'}],{backend:'qwen',requireSources:true,searchEvidenceFirst:true,searchDomains:['tiktok.com']}))if('text'in event)reused+=event.text;
  assert.equal(modelCalls,2,'unchanged originals need no additional model/search requests');
  assert.equal(originalReads,2,'reused response still re-reads the original');
  assert.match(reused,/重新读取全部引用原文/);
  blockOriginal=true;
  await assert.rejects(async()=>{for await(const event of callLLMChatStream([{role:'user',content:'社交媒体资讯，TikTok创作者工具'}],{backend:'qwen',requireSources:true,searchEvidenceFirst:true,searchDomains:['tiktok.com']}))void event;}, { code: 'search_originals_unreadable' });
  assert.equal(modelCalls,2,'an inaccessible original cannot trigger hidden paid retries or stale delivery');
 }finally{if(previousAnalysisModel===undefined)delete process.env.QWEN_NEWS_ANALYSIS_MODEL;else process.env.QWEN_NEWS_ANALYSIS_MODEL=previousAnalysisModel;globalThis.fetch=originalFetch;if(previous===undefined)delete process.env.DASHSCOPE_API_KEY;else process.env.DASHSCOPE_API_KEY=previous;if(previousEndpoint===undefined)delete process.env.QWEN_SEARCH_ENDPOINT;else process.env.QWEN_SEARCH_ENDPOINT=previousEndpoint;}
});

test('explicit BASF publisher lookup discovers real directory links before synthesis without relying on unstable search metadata', async () => {
  const originalFetch = globalThis.fetch, previousKey = process.env.DASHSCOPE_API_KEY;
  process.env.DASHSCOPE_API_KEY = 'fixture-only';
  let modelCalls = 0, articleReads = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/tw/zh/media/news-releases') return new Response('<a href="/tw/zh/media/news-releases/asia-pacific/2026/10/fixture">More</a>');
    if (url.hostname === 'www.basf.com') {
      articleReads++;
      return new Response('<h1>BASF personal care innovation</h1><p>BASF plans to present a new personal care ingredient. ' + 'Original technical announcement. '.repeat(12) + '</p>');
    }
    modelCalls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.enable_search, false, 'directory discovery does not spend a search request');
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      items: [{ sourceId: 'S1', fact: '巴斯夫计划展示个人护理原料，具体应用仍需核对技术资料。', quoteIds: ['S1-Q1'],
        meaning: '可能为研发选题提供线索，不能据此确认销量。', action: '建议先核对原料技术说明和目标市场适用要求。' }],
      conclusion: '本轮只支持官方展示计划，不能证明已销售或适用于本企业。',
    }) } }] });
  };
  try {
    const query = [{ role: 'user' as const, content: 'BASF美妆原料个人护理创新公告（目录测试）' }];
    const options = { backend: 'qwen' as const, requireSources: true, searchEvidenceFirst: true, searchDomains: ['basf.com'] };
    let answer = '';
    for await (const event of callLLMChatStream(query, options)) if ('text' in event) answer += event.text;
    assert.match(answer, /官方新闻目录/); assert.match(answer, /分析推断/);
    for await (const event of callLLMChatStream(query, options)) void event;
    assert.equal(modelCalls, 1); assert.equal(articleReads, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = previousKey;
  }
});

test('industry and daily briefs search diverse sources instead of stopping at a publisher directory', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-28T12:00:00Z') });
  const originalFetch=globalThis.fetch, previousKey=process.env.DASHSCOPE_API_KEY, previousEndpoint=process.env.QWEN_SEARCH_ENDPOINT;
  process.env.DASHSCOPE_API_KEY='fixture-only';process.env.QWEN_SEARCH_ENDPOINT='https://fixture.invalid/search';
  let searchCalls=0,directoryCalls=0,analysisCalls=0;
  const quote='A new cosmetics ingredient supports development of personal care formulations.';
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    if(url.includes('/news-releases')||url.includes('/press-releases')){directoryCalls++;throw Error('directory must not replace broad search');}
    if(url.includes('www.basf.com'))throw Error('official site unavailable');
    if(url.includes('cosmeticsdesign-europe.com'))return new Response(`<meta property="article:published_time" content="2026-10-28"><article><h1>Personal care innovation</h1><p>${quote}${' Independent industry reporting.'.repeat(12)}</p></article>`, {headers:{'content-type':'text/html'}});
    const body=JSON.parse(String(init?.body));
    if(body.parameters?.enable_search){assert.equal(body.parameters.search_options.assigned_site_list,undefined);assert.match(body.input.messages[0].content,/可信行业媒体/);assert.match(body.input.messages[0].content,/目标市场常用语言/);searchCalls++;return Response.json({output:{choices:[{message:{content:'Search complete'},finish_reason:'stop'}],search_info:{search_results:[{index:1,title:'Invalid candidate',url:'javascript:alert(1)'},{index:2,title:'Official inaccessible',url:'https://www.basf.com/article'},{index:3,title:'Personal care innovation',url:'https://www.cosmeticsdesign-europe.com/article'}]}}});}
    analysisCalls++;
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[{sourceId:'S2',fact:'行业媒体报道了一项个人护理原料信息。',quoteIds:['S2-Q1'],meaning:'可能为配方研发提供线索，效果仍需验证。',action:'建议核对技术资料和目标市场要求。'}],conclusion:'该信息支持进一步调研，不能代表整体市场。'})}}]});
  };
  try{
    for (const scene of ['行业资讯','今日资讯']) {
      searchCalls=0;directoryCalls=0;analysisCalls=0;
      const answer=await qwenSearchAnswer([{role:'user',content:`${scene}：美妆原料，目标市场：欧洲，关注BASF。`}],{backend:'qwen',requireSources:true,searchEvidenceFirst:true,searchDomains:['basf.com'],searchFreshnessDays:30},{originalFetcher:globalThis.fetch});
      assert.equal(searchCalls,2,'one bounded supplemental search follows sparse readable evidence');assert.equal(directoryCalls,0);assert.equal(analysisCalls,1,'bounded discovery is followed by exactly one synthesis');assert.match(answer.text,/```industry-insight/);
      assert.equal(answer.sources.length,1);assert.match(answer.sources[0].uri,/cosmeticsdesign-europe/);assert.match(answer.text,/行业媒体报道/);
      const report=JSON.parse(answer.text.split('\n')[1]);assert.equal(report.period,scene==='今日资讯'?'2026-10-28（Asia/Shanghai当天）':'最近30天');assert.equal(report.signals[0].publishedAt,'2026-10-28');
    }
  }finally{globalThis.fetch=originalFetch;if(previousKey===undefined)delete process.env.DASHSCOPE_API_KEY;else process.env.DASHSCOPE_API_KEY=previousKey;if(previousEndpoint===undefined)delete process.env.QWEN_SEARCH_ENDPOINT;else process.env.QWEN_SEARCH_ENDPOINT=previousEndpoint;}
});

test('zero industry source metadata triggers only one bounded supplement and no synthesis', async () => {
  const savedFetch = globalThis.fetch, savedKey = process.env.DASHSCOPE_API_KEY, savedEndpoint = process.env.QWEN_SEARCH_ENDPOINT;
  process.env.DASHSCOPE_API_KEY = 'fixture-only'; process.env.QWEN_SEARCH_ENDPOINT = 'https://fixture.invalid/search';
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++; const payload = JSON.parse(String(init?.body));
    assert.equal(payload.parameters.enable_search, true, 'no synthesis with zero verified originals');
    return Response.json({ output: { choices: [{ finish_reason: 'stop', message: { content: 'No metadata candidates' } }], search_info: { search_results: [] } } });
  };
  try {
    await assert.rejects(qwenSearchAnswer([{ role: 'user', content: '行业资讯：空来源联调fixture' }], { searchEvidenceFirst: true }, { publicFeedDiscovery:async()=>[] }), { code: 'search_originals_unavailable' });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = savedKey;
    if (savedEndpoint === undefined) delete process.env.QWEN_SEARCH_ENDPOINT; else process.env.QWEN_SEARCH_ENDPOINT = savedEndpoint;
  }
});

test('discovery-only uses metadata retrieval instructions even with source-first disabled and ignores model-written URLs', async () => {
 const savedFetch = globalThis.fetch;
 const keys = ['QWEN_SEARCH_ENDPOINT', 'DASHSCOPE_API_KEY', 'QWEN_NEWS_SEARCH_STRATEGY'] as const, saved = keys.map(key => process.env[key]);
 process.env.QWEN_SEARCH_ENDPOINT = 'https://fixture.invalid/api/v1/services/aigc/text-generation/generation';
 process.env.DASHSCOPE_API_KEY = 'fixture-only';
 process.env.QWEN_NEWS_SEARCH_STRATEGY = 'max';
 let calls = 0, withMetadata = true;
 globalThis.fetch = async (_input, init) => {
  calls++;
  const request = JSON.parse(String(init?.body));
  assert.equal(request.input.messages.length, 2);
  assert.equal(request.input.messages[0].role, 'system');
  assert.match(request.input.messages[0].content, /公开网页检索器/);
  assert.match(request.input.messages[0].content, /不要撰写经营结论/);
  assert.doesNotMatch(request.input.messages[0].content, /写一份完整报告/);
  assert.equal(request.input.messages[1].content, '珀莱雅 Proya 新品 渠道 2026年8月至10月');
  assert.equal(request.parameters.max_tokens, 512);
  assert.equal(request.parameters.search_options.search_strategy, 'max');
  assert.equal(request.parameters.search_options.forced_search, true);
  return Response.json({ output: { choices: [{ message: { content: '自行生成 https://fabricated.invalid/fake-report 及无依据合规规则' }, finish_reason: 'length' }], search_info: { search_results: withMetadata ? [
   { index: 7, title: '珀莱雅发布新品', url: 'https://publisher.com/news/proya-product' },
   { index: 8, title: '{"code":0,"strategy_result":{', url: 'https://publisher.com/api-result' },
  ] : [] } } });
 };
 try {
  const result = await qwenSearchAnswer([{ role: 'user', content: '珀莱雅 Proya 新品 渠道 2026年8月至10月' }], { searchEvidenceFirst: false, systemPrompt: '写一份完整报告' }, { discoveryOnly: true });
  assert.deepEqual(result, { text: '', sources: [{ title: '珀莱雅发布新品', uri: 'https://publisher.com/news/proya-product', citationIndex: 7 }] });
  withMetadata = false;
  assert.deepEqual(await qwenSearchAnswer([{ role: 'user', content: '珀莱雅 Proya 新品 渠道 2026年8月至10月' }], { searchEvidenceFirst: false }, { discoveryOnly: true }), { text: '', sources: [] });
  assert.equal(calls, 2, 'one HTTP request per deliberate discovery, no hidden retry or synthesis');
 } finally {
  globalThis.fetch = savedFetch;
  keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
 }
});

test('news strategy configuration permits max only for metadata retrieval and leaves ordinary chat turbo', async () => {
 const { qwenNewsSearchStrategy } = await import('./qwenSearch.js');
 const prior = process.env.QWEN_NEWS_SEARCH_STRATEGY;
 try {
  delete process.env.QWEN_NEWS_SEARCH_STRATEGY; assert.equal(qwenNewsSearchStrategy(true), 'turbo');
  process.env.QWEN_NEWS_SEARCH_STRATEGY = 'max'; assert.equal(qwenNewsSearchStrategy(true), 'max'); assert.equal(qwenNewsSearchStrategy(false), 'turbo');
  for (const value of ['pro', 'agent', 'agent_max', 'unknown']) {
   process.env.QWEN_NEWS_SEARCH_STRATEGY = value;
   assert.throws(() => qwenNewsSearchStrategy(true), { code: 'qwen_news_search_strategy_invalid' });
   assert.equal(qwenNewsSearchStrategy(false), 'turbo');
  }
 } finally { if (prior === undefined) delete process.env.QWEN_NEWS_SEARCH_STRATEGY; else process.env.QWEN_NEWS_SEARCH_STRATEGY = prior; }
});

test('documented freshness is applied only to turbo; bounded repair preserves max first discovery and exact reader scope', async()=>{
 const {qwenNewsRetrievalPolicy}=await import('./qwenSearch.js');const prior=process.env.QWEN_NEWS_SEARCH_STRATEGY;
 try{
  process.env.QWEN_NEWS_SEARCH_STRATEGY='max';
  assert.deepEqual(qwenNewsRetrievalPolicy(true,'qwen-plus',30),{model:'qwen-plus',search_strategy:'max'});
  assert.deepEqual(qwenNewsRetrievalPolicy(true,'qwen-plus',30,true),{model:'qwen-plus',search_strategy:'turbo',freshness:30});
  assert.deepEqual(qwenNewsRetrievalPolicy(true,'qwen3.8-max',45,true),{model:'qwen-plus',search_strategy:'turbo',freshness:180});
  assert.deepEqual(qwenNewsRetrievalPolicy(true,'qwen-plus',undefined,true),{model:'qwen-plus',search_strategy:'max'});
  assert.deepEqual(qwenNewsRetrievalPolicy(true,'qwen-plus',366,true),{model:'qwen-plus',search_strategy:'max'});
  assert.deepEqual(qwenNewsRetrievalPolicy(false,'qwen-plus',30),{model:'qwen-plus',search_strategy:'turbo',freshness:30});
  assert.deepEqual(qwenNewsRetrievalPolicy(false,'qwen-max',45),{model:'qwen-max',search_strategy:'turbo',freshness:45});
 }finally{if(prior===undefined)delete process.env.QWEN_NEWS_SEARCH_STRATEGY;else process.env.QWEN_NEWS_SEARCH_STRATEGY=prior;}
});
test('real sparse North America shape uses exactly max then turbo freshness, with no synthesis on empty originals',async()=>{
 const savedFetch=globalThis.fetch;const keys=['QWEN_SEARCH_ENDPOINT','DASHSCOPE_API_KEY','QWEN_NEWS_SEARCH_STRATEGY'] as const,saved=keys.map(key=>process.env[key]);
 process.env.QWEN_SEARCH_ENDPOINT='https://fixture.invalid/search';process.env.DASHSCOPE_API_KEY='fixture-only';process.env.QWEN_NEWS_SEARCH_STRATEGY='max';
 const policies:Array<{search_strategy?:string;freshness?:number}>=[];
 globalThis.fetch=async(_input,init)=>{const body=JSON.parse(String(init?.body));assert.equal(body.parameters.enable_search,true);policies.push(body.parameters.search_options);return Response.json({output:{choices:[{finish_reason:'stop',message:{content:'No tool source metadata'}}],search_info:{search_results:[]}}});};
 try{
  await assert.rejects(qwenSearchAnswer([{role:'user',content:'今日资讯：freshness-repair-regression，目标市场：北美，行业：美妆。'}],{searchEvidenceFirst:true,searchFreshnessDays:30,model:'qwen-plus'},{publicFeedDiscovery:async()=>[]}),{code:'search_originals_unavailable'});
  assert.equal(policies.length,2);assert.equal(policies[0].search_strategy,'max');assert.equal(policies[0].freshness,undefined);
  assert.equal(policies[1].search_strategy,'turbo');assert.equal(policies[1].freshness,7);
 }finally{globalThis.fetch=savedFetch;keys.forEach((key,index)=>{if(saved[index]===undefined)delete process.env[key];else process.env[key]=saved[index];});}
});

test('public RSS candidates enter the same verified-original and single-synthesis flow without another paid call',async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-28T12:00:00Z')});
 const savedFetch=globalThis.fetch;const keys=['QWEN_SEARCH_ENDPOINT','DASHSCOPE_API_KEY'] as const,saved=keys.map(key=>process.env[key]);
 process.env.QWEN_SEARCH_ENDPOINT='https://fixture.invalid/rss-candidate-search';process.env.DASHSCOPE_API_KEY='fixture-only';
 let searches=0,syntheses=0,feedCalls=0,articleReads=0;
 const source={title:'North American skincare production partnership',uri:'https://publisher.com/news/local-production-partnership'};
 globalThis.fetch=async(_input,init)=>{
  const body=JSON.parse(String(init?.body));
  if(body.parameters?.enable_search){searches++;return Response.json({output:{choices:[{finish_reason:'stop',message:{content:'No provider metadata'}}],search_info:{search_results:[]}}});}
  syntheses++;return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[{sourceId:'S25',quoteIds:['S25-Q1'],fact:'原文披露北美护肤产品生产合作安排。',meaning:'可能提供本地生产合作的调研线索。',action:'建议核对合作对象及实际生产能力。'}],conclusion:'该篇公开资料提供本地生产合作的观察线索。'})}}]});
 };
 try{
  const result=await qwenSearchAnswer([{role:'user',content:'今日资讯：RSS-canonical-flow，行业：护肤，目标市场：北美。'}],{searchEvidenceFirst:true,searchFreshnessDays:30},{
   publicFeedDiscovery:async(_queries,options)=>{feedCalls++;assert.equal(options.articleRequestBudget.remaining,24);options.articleRequestBudget.remaining-=2;return [source];},
   originalFetcher:async(input)=>{articleReads++;assert.equal(String(input),source.uri);return new Response(`<meta property="article:published_time" content="2026-10-28"><article><h1>${source.title}</h1><p>${'The company announced a North American skincare production partnership. '.repeat(8)}</p></article>`,{headers:{'content-type':'text/html'}});},
  });
  assert.equal(searches,2);assert.equal(syntheses,1);assert.equal(feedCalls,1);assert.equal(articleReads,1);
  assert.equal(result.sources.length,1);assert.equal(result.sources[0].uri,source.uri);assert.match(result.text,/生产合作/);
 }finally{globalThis.fetch=savedFetch;keys.forEach((key,index)=>{if(saved[index]===undefined)delete process.env[key];else process.env[key]=saved[index];});}
});
