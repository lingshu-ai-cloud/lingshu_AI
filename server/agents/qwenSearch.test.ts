import assert from 'node:assert/strict';
import test from 'node:test';
import { callLLM, callLLMChatStream, type StreamEvent } from './llm.js';
import { validatedSearchSources, assertRecentSearchAnswer } from './qwenSearch.js';
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
 const previous=process.env.DASHSCOPE_API_KEY, originalFetch=globalThis.fetch, previousEndpoint=process.env.QWEN_SEARCH_ENDPOINT;
 process.env.DASHSCOPE_API_KEY='fixture-only';process.env.QWEN_SEARCH_ENDPOINT='https://fixture.invalid/api/v1/services/aigc/text-generation/generation';
 let modelCalls=0, originalReads=0, blockOriginal=false;
 const quote='The platform announced a new tool for professional content creators.';
 globalThis.fetch=async(input,init)=>{
  if(String(input).includes('www.tiktok.com')) { originalReads++; if(blockOriginal)return new Response('blocked',{status:403}); return new Response(`<article><h1>Platform creator announcement</h1><p>${quote}${' Original public text.'.repeat(15)}</p></article>`); }
  const body=JSON.parse(String(init?.body));modelCalls++;
  if(body.parameters.enable_search)return Response.json({output:{choices:[{message:{content:'Discovery narrative contains INVENTED_9999; never reuse it.'},finish_reason:'stop'}],search_info:{search_results:[{index:9,title:'Platform creator announcement',url:'https://www.tiktok.com/creator-announcement'}]}}});
  assert.equal(body.parameters.enable_search,false);assert.equal(body.parameters.response_format.type,'json_object');assert.ok(!body.input.messages[1].content.includes('INVENTED_9999'));
  return Response.json({output:{choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[{sourceId:'S1',fact:'平台发布了面向专业内容创作者的新工具。',quoteIds:['S1-Q1'],meaning:'可能为内容生产提供新的工具，效果仍需验证。',action:'建议先核对目标账号的功能开放状态，再做小样本测试。'}],conclusion:'本轮可以确认官方发布的工具信息，无法据此判断账号实际热度或销量。'})}}]}});
 };
 try{
  let answer='';for await(const event of callLLMChatStream([{role:'user',content:'社交媒体资讯，TikTok创作者工具'}],{backend:'qwen',requireSources:true,searchEvidenceFirst:true,searchDomains:['tiktok.com']}))if('text'in event)answer+=event.text;
  assert.equal(modelCalls,2);assert.match(answer,/总体结论/);assert.match(answer,/原文摘录/);assert.ok(!answer.includes('INVENTED_9999'));
  let reused='';for await(const event of callLLMChatStream([{role:'user',content:'社交媒体资讯，TikTok创作者工具'}],{backend:'qwen',requireSources:true,searchEvidenceFirst:true,searchDomains:['tiktok.com']}))if('text'in event)reused+=event.text;
  assert.equal(modelCalls,2,'unchanged originals need no additional model/search requests');
  assert.equal(originalReads,2,'reused response still re-reads the original');
  assert.match(reused,/重新读取全部引用原文/);
  blockOriginal=true;
  await assert.rejects(async()=>{for await(const event of callLLMChatStream([{role:'user',content:'社交媒体资讯，TikTok创作者工具'}],{backend:'qwen',requireSources:true,searchEvidenceFirst:true,searchDomains:['tiktok.com']}))void event;},/未取得可读取/);
  assert.equal(modelCalls,2,'an inaccessible original cannot trigger hidden paid retries or stale delivery');
 }finally{globalThis.fetch=originalFetch;if(previous===undefined)delete process.env.DASHSCOPE_API_KEY;else process.env.DASHSCOPE_API_KEY=previous;if(previousEndpoint===undefined)delete process.env.QWEN_SEARCH_ENDPOINT;else process.env.QWEN_SEARCH_ENDPOINT=previousEndpoint;}
});

test('BASF news discovers real directory links before synthesis without relying on unstable search metadata', async () => {
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
    assert.equal(body.parameters.enable_search, false, 'directory discovery does not spend a search request');
    return Response.json({ output: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      items: [{ sourceId: 'S1', fact: '巴斯夫计划展示个人护理原料，具体应用仍需核对技术资料。', quoteIds: ['S1-Q1'],
        meaning: '可能为研发选题提供线索，不能据此确认销量。', action: '建议先核对原料技术说明和目标市场适用要求。' }],
      conclusion: '本轮只支持官方展示计划，不能证明已销售或适用于本企业。',
    }) } }] } });
  };
  try {
    const query = [{ role: 'user' as const, content: '行业资讯：全球美妆原料，BASF个人护理创新（目录测试）' }];
    const options = { backend: 'qwen' as const, requireSources: true, searchEvidenceFirst: true, searchDomains: ['basf.com'] };
    let answer = '';
    for await (const event of callLLMChatStream(query, options)) if ('text' in event) answer += event.text;
    assert.match(answer, /官方新闻目录/); assert.match(answer, /原文摘录/);
    for await (const event of callLLMChatStream(query, options)) void event;
    assert.equal(modelCalls, 1); assert.equal(articleReads, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = previousKey;
  }
});
