import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSearchOriginals, composeSearchEvidenceAnswer, searchOriginalExcerpts, type SearchOriginal } from './searchEvidenceAnswer.js';
const sentence='Certain small businesses are exempt from facility registration and product listing requirements.';
const html=`<meta property="article:published_time" content="2026-10-20"><article><h1>Cosmetic registration requirements</h1><p>${sentence}</p><p>${'Additional original regulatory conditions. '.repeat(6)}</p></article>`;
const source={title:'Search title differs',uri:'https://www.fda.gov/cosmetics/registration',citationIndex:9};
const original:SearchOriginal={id:'S1',source,text:sentence,published:['2026-10-20']};
const draft={items:[{sourceId:'S1',fact:'部分小企业可能适用设施注册和产品列名豁免，仍需核对具体条件。',quoteIds:['S1-Q1'],meaning:'可能影响企业适用范围，不能把所有主体一概视为强制注册。',action:'建议逐项核对产品及企业是否符合豁免条件。'}],conclusion:'本次原文支持对豁免范围作进一步核对，不能据此判定本企业已经合规。'};
test('source-first reading uses actual original headings and dates, isolates failed candidates and never follows redirects',async()=>{
 const {originals,rejected,rejectionReasons}=await readSearchOriginals([source,{...source,uri:'https://www.fda.gov/unreadable'}],{now:Date.parse('2026-10-26'),freshnessDays:30,fetcher:async(input,init)=>{assert.equal(init?.redirect,'error');if(String(input).endsWith('unreadable'))throw Error('failed');return new Response(html,{headers:{'content-type':'text/html'}});}});
 assert.equal(originals.length,1);assert.equal(rejected,1);assert.equal(originals[0].source.title,'Cosmetic registration requirements');
 assert.equal(rejectionReasons.unreadable,1);
 const old=await readSearchOriginals([source],{now:Date.parse('2027-10-26'),freshnessDays:30,fetcher:async()=>new Response(html)});assert.equal(old.originals.length,0);assert.equal(old.rejectionReasons.date,1);
});
test('closed-book synthesis is bound to actual originals and preserves literal quotes with labelled inference',async()=>{
 let calls=0;const answer=await composeSearchEvidenceAnswer('美国美妆政策',[original],async prompt=>{calls++;assert.ok(prompt.includes(sentence));return JSON.stringify(draft);},{rejected:1});
 assert.equal(calls,1);assert.match(answer.text,/分析推断/);assert.match(answer.text,/总体结论/);assert.equal(answer.sources[0].citationIndex,1);assert.match(answer.text,/另有 1 条候选/);
 for(const modify of [(d:typeof draft)=>d.items[0].sourceId='S99',(d:typeof draft)=>d.items[0].quoteIds=['S1-Q999'],(d:typeof draft)=>d.conclusion='保证所有企业一定可以获批。']){
  const bad=structuredClone(draft);modify(bad);await assert.rejects(composeSearchEvidenceAnswer('政策',[original],async()=>JSON.stringify(bad)));
 }
 const unsupported=structuredClone(draft);unsupported.items[0].fact='营业额增长999.99%。';
 const partial=await composeSearchEvidenceAnswer('政策',[original],async()=>JSON.stringify(unsupported));assert.ok(!partial.text.includes('999.99'));assert.match(partial.text,/仅保留原文/);
 let generated=false;await assert.rejects(composeSearchEvidenceAnswer('近期',[],async()=>{generated=true;return '';}));assert.equal(generated,false);
});


test('date presentation restores only a verbatim month-day fragment and never fills in an unsupported year',async()=>{
 const source={...original,text:'公司将于11月3日至5日展示产品。'+sentence};
 const candidate=structuredClone(draft);candidate.items[0].fact='公司将于2026年11月3日至5日展示产品。';
 const answer=await composeSearchEvidenceAnswer('原料',[source],async()=>JSON.stringify(candidate));
 assert.match(answer.text,/将于11月3日至5日/);assert.ok(!answer.text.includes('将于2026年'));assert.ok(!answer.text.includes('仅保留原文'));
 candidate.items[0].fact='公司将于2026年12月3日展示产品。';
 const unknown=await composeSearchEvidenceAnswer('原料',[source],async()=>JSON.stringify(candidate));assert.match(unknown.text,/仅保留原文/);
});

test('analysis retains evidenced product numbers but still withholds invented numbers', async () => {
 const source={...original,text:'Product S18 is a conditioning ingredient for personal care applications.'};
 const candidate=structuredClone(draft);
 candidate.items[0].fact='原文介绍了一种用于个人护理配方的调理成分，具体效果仍需验证。';
 candidate.items[0].meaning='可能为S18的应用调研提供依据，仍需核对适配配方。';
 candidate.items[0].action='建议先核对S18的技术资料，再开展配方验证。';
 const accepted=await composeSearchEvidenceAnswer('原料',[source],async()=>JSON.stringify(candidate));
 assert.ok(accepted.text.includes(candidate.items[0].meaning));
 candidate.items[0].action='建议按999的新增成本投入生产。';
 const rejected=await composeSearchEvidenceAnswer('原料',[source],async()=>JSON.stringify(candidate));
 assert.ok(!rejected.text.includes('999'));
});

test('literal English excerpts do not break ordinary words at the length boundary', () => {
 const source={...original,text:'Personal care ingredient innovation supports formulation development and further technical verification '.repeat(8)};
 for(const excerpt of searchOriginalExcerpts(source)) {
  const end=source.text.indexOf(excerpt.text)+excerpt.text.length;
  assert.ok(end===source.text.length || /\s/u.test(source.text[end]));
 }
});

test('industry brief emits verified source-backed report and excludes unverified figures', async () => {
 const candidate=structuredClone(draft);
 const answer=await composeSearchEvidenceAnswer('行业资讯：行业：美妆原料，目标市场：美国。',[original],async()=>JSON.stringify(candidate),{freshnessDays:30});
 const match=answer.text.match(/^```industry-insight\n([^\n]+)\n```$/u);
 assert.ok(match);
 const report=JSON.parse(match[1]);
 assert.equal(report.industry,'美妆原料');assert.equal(report.market,'美国');assert.equal(report.period,'最近30天');
 assert.equal(report.signals.length,1);assert.equal(report.signals[0].sourceUrl,source.uri);
 assert.equal(report.signals[0].publishedAt,'2026-10-20');assert.deepEqual(report.limitations,['AI结论仅供参考']);
 candidate.items[0].fact='销售增长999.99%。';
 const invalid=await composeSearchEvidenceAnswer('行业资讯：行业：美妆原料，目标市场：美国。',[original],async()=>JSON.stringify(candidate));
 const invalidReport=JSON.parse(invalid.text.split('\n')[1]);assert.equal(invalidReport.signals.length,0);assert.match(invalidReport.summary,/暂无可展示/);assert.ok(!invalid.text.includes('999.99'));
});

test('broader industry retrieval prioritizes different publishers, bounds reads and deduplicates syndicated copies',async()=>{
 const hosts=['fda.gov','europa.eu','who.int','basf.com','croda.com','seppic.com','loreal.com','un.org'];
 const sources=Array.from({length:30},(_,i)=>({title:`Candidate ${i}`,uri:`https://${i<8?hosts[0]:hosts[(i-7)%hosts.length]}/article-${i}`}));
 const visited:string[]=[];
 const read=await readSearchOriginals(sources,{maxCandidates:24,publicWeb:true,fetcher:async input=>{visited.push(String(input));return new Response(html,{headers:{'content-type':'text/html'}});}});
 assert.equal(visited.length,24);assert.equal(new Set(visited.map(value=>new URL(value).hostname)).size,8);
 const candidates=read.originals.slice(0,8);
 const items=candidates.map(o=>({sourceId:o.id,fact:'部分小企业可能适用设施注册和产品列名豁免，仍需核对具体条件。',quoteIds:[`${o.id}-Q1`],meaning:'可能影响企业适用范围，不能一概视为强制注册。',action:'建议逐项核对企业是否符合豁免条件。'}));
 const result=await composeSearchEvidenceAnswer('行业资讯：行业：美妆原料，目标市场：美国。',candidates,async prompt=>{assert.match(prompt,/至多8条资料/);return JSON.stringify({items,conclusion:'应结合原文核对具体适用条件，不能据此判断本企业合规状态。'});});
 const report=JSON.parse(result.text.split('\n')[1]);assert.equal(report.signals.length,1); // Identical facts from syndicated pages are one event, not eight independent signals.
 assert.equal(new Set(report.signals.map((signal:{sourceUrl:string})=>signal.sourceUrl)).size,1);
 for(const signal of report.signals)assert.ok(result.sources.some(source=>source.uri===signal.sourceUrl));
});

test('readable media headings decode numeric entities and unique article times without weakening recent-original checks', async () => {
 const media = '<header>Site navigation ticker 999999</header><article><header><h1>Beauty &#38; Personal &#67;are</h1><time datetime="2026-10-21T08:00:00+01:00">21 October 2026</time></header><p>'+sentence.repeat(4)+'</p></article>';
 const accepted = await readSearchOriginals([source], { now: Date.parse('2026-10-28'), freshnessDays: 30, fetcher: async () => new Response(media) });
 assert.equal(accepted.originals.length, 1);
 assert.equal(accepted.originals[0].source.title, 'Beauty & Personal Care');
 assert.deepEqual(accepted.originals[0].published, ['2026-10-21']);
 assert.ok(!accepted.originals[0].text.includes('999999'));
 const expired = await readSearchOriginals([source], { now: Date.parse('2027-10-28'), freshnessDays: 30, fetcher: async () => new Response(media) });
 assert.equal(expired.originals.length, 0); assert.equal(expired.rejectionReasons.date, 1);
 const ambiguous = await readSearchOriginals([source], { now: Date.parse('2026-10-28'), freshnessDays: 30,
  fetcher: async () => new Response(media.replace('</article>', '<time datetime="2026-10-22">Other date</time></article>')) });
 assert.equal(ambiguous.originals.length, 0); assert.equal(ambiguous.rejectionReasons.date, 1);
});

test('zero selected industry items still return a version-one report empty state instead of plain text', async () => {
 const answer = await composeSearchEvidenceAnswer('行业资讯：行业：美妆原料，目标市场：欧洲。', [original], async () => JSON.stringify({ items: [], conclusion: '没有形成有足够依据的近期变化判断。' }), { freshnessDays: 30 });
 assert.match(answer.text, /^```industry-insight\n/);
 const report = JSON.parse(answer.text.split('\n')[1]);
 assert.equal(report.version, 1); assert.deepEqual(report.signals, []); assert.deepEqual(answer.sources, []);
});

test('only selected and deduplicated sources may support a comprehensive report introduction', async () => {
 const second: SearchOriginal = { id: 'S2', source: { title: 'Second technical report', uri: 'https://anotherpublisher.com/news/new-research' }, published: ['2026-10-20'], text: 'Another publisher reported a new technical research partnership between companies.' };
 const excluded: SearchOriginal = { ...second, id: 'S3', source: { ...second.source, uri: 'https://thirdpublisher.com/unselected' } };
 const items = [draft.items[0], { ...draft.items[0], sourceId: 'S2', quoteIds: ['S2-Q1'], fact: '企业公布技术研究合作，后续执行情况仍需核对。' }];
 const conclusion = '两篇资料分别反映合规条件与研发合作，商户可结合产品适配开展进一步核对。';
 for (const [ids, adopted] of [[['S1', 'S2'], true], [['S1', 'S3'], false], [undefined, false]] as const) {
  const answer = await composeSearchEvidenceAnswer('行业资讯：行业：美妆原料，目标市场：美国。', [original, second, excluded], async () => JSON.stringify({ items, conclusion, ...(ids ? { conclusionSourceIds: ids } : {}) }));
  const report = JSON.parse(answer.text.split('\n')[1]);
  assert.equal(report.summary === conclusion, adopted);
  assert.equal(report.signals.length, 2);
  assert.deepEqual(answer.sources.map(source => source.uri), [original.source.uri, second.source.uri]);
 }
});

test('a few sources cannot turn a global market claim into a confirmed broad trend', async () => {
 const second: SearchOriginal = { id: 'S2', source: { title: 'Second technical report', uri: 'https://anotherpublisher.com/news/new-research' }, published: ['2026-10-20'], text: 'Another publisher reported a new technical research partnership between companies.' };
 const items = [draft.items[0], { ...draft.items[0], sourceId: 'S2', quoteIds: ['S2-Q1'], fact: '企业公布技术研究合作，后续执行情况仍需核对。' }];
 const conclusion = '综合来看，全球美妆原料市场近期呈现三个明确的研发与竞争动向。';
 const answer = await composeSearchEvidenceAnswer('行业资讯：行业：美妆原料，目标市场：全球。', [original, second], async () => JSON.stringify({ items, conclusion, conclusionSourceIds: ['S1', 'S2'] }));
 const report = JSON.parse(answer.text.split('\n')[1]);
 assert.notEqual(report.summary, conclusion);
 assert.match(report.summary, /专题观察重点/);
 assert.equal(report.signals.length, 2);
});

test('eight genuinely distinct source events remain available after duplicate filtering', async () => {
 const letters = 'ABCDEFGH';
 const originals: SearchOriginal[] = [...letters].map(letter => ({ id: `S${letter}`, source: { title: `Company ${letter} formulation research`, uri: `https://industrypublisher.com/news/company-${letter}` },
  published: ['2026-10-20'], text: `Company ${letter} announced formulation research and requires further application testing before adoption.` }));
 const items = originals.map((item, index) => ({ sourceId: item.id, quoteIds: [`${item.id}-Q1`], fact: `企业${letters[index]}公布配方研究，实际采用效果仍需核对。`, meaning: '可能为配方调研提供方向，实际适配仍需验证。', action: '建议核对对应企业的原文和技术文档。' }));
 const answer = await composeSearchEvidenceAnswer('行业资讯：行业：美妆原料，目标市场：欧洲。', originals, async () => JSON.stringify({ items, conclusion: '不同企业披露具体研究动作，可作为后续调研线索。' }));
 const report = JSON.parse(answer.text.split('\n')[1]);
 assert.equal(report.signals.length, 8); assert.equal(answer.sources.length, 8);
});

test('version-one industry reports carry only source-bound historical and explicitly forecast market metrics', async () => {
 const text = '全球化妆品原料市场在2026年预计继续保持增长态势，市场规模预计达到1020亿美元，相较2025年的940亿美元增长8.5%。';
 const market: SearchOriginal = { id: 'S2', source: { title: '公开市场研究摘要', uri: 'https://researchpublisher.com/report/cosmetics' }, published: ['2026-10-20'], text };
 const output = { items: [{ sourceId: 'S2', quoteIds: ['S2-Q1'], fact: '研究机构发布全球化妆品原料市场规模的历史值和预测。', meaning: '提示原料企业可围绕应用方向开展客户调研。', action: '建议结合客户需求安排原料选型和技术资料。' }], conclusion: '可围绕原料应用开展客户调研。', metrics: [
  { label: '市场规模', period: '2025', value: 940, unit: '亿美元', kind: 'reported', sourceId: 'S2', quoteId: 'S2-Q1' },
  { label: '市场规模', period: '2026', value: 1020, unit: '亿美元', kind: 'forecast', sourceId: 'S2', quoteId: 'S2-Q1' },
  { label: '市场规模', period: '2027', value: 9999, unit: '亿美元', kind: 'forecast', sourceId: 'S2', quoteId: 'S2-Q1' },
 ] };
 const answer = await composeSearchEvidenceAnswer('行业资讯：行业：美妆原料，目标市场：全球。', [market], async () => JSON.stringify(output));
 const report = JSON.parse(answer.text.split('\n')[1]);
 assert.equal(report.version, 1); assert.equal(report.metrics.length, 2);
 assert.deepEqual(report.metrics.map((metric: { period: string; value: number; kind: string }) => [metric.period, metric.value, metric.kind]), [['2025', 940, 'reported'], ['2026', 1020, 'forecast']]);
 assert.ok(report.metrics.every((metric: { sourceUrl: string; quote: string }) => metric.sourceUrl === market.source.uri && metric.quote === text));
 assert.deepEqual(report.limitations, ['AI结论仅供参考']);
});

test('article identity uses the actual scoped headline rather than a preceding site h1', async () => {
 const body = 'The original publisher reports an ingredient partnership for further technical evaluation. '.repeat(8);
 const cases = [
  '<header><h1>Publisher site navigation</h1></header><meta name="publish_date" content="2026-10-20"><article><h1>Actual ingredient partnership report</h1><p>'+body+'</p></article>',
  '<meta name="PubDate" content="2026-10-20"><meta property="og:title" content="Actual ingredient partnership report"><h1>Actual ingredient partnership report</h1><div class="article-content"><p>'+body+'</p></div>',
  '<div role="main"><h1>Actual ingredient partnership report</h1><div>发布时间：2026-10-20</div><div><p>'+body+'</p></div></div>',
 ];
 for (const html of cases) {
  const result = await readSearchOriginals([{ title: 'Search engine abbreviated headline', uri: 'https://www.customs.gov.cn/article/report.html' }], { freshnessDays: 30, now: Date.parse('2026-10-28'), fetcher: async () => new Response(html, { headers: { 'content-type': 'text/html' } }) });
  assert.equal(result.originals.length, 1); assert.equal(result.originals[0].source.title, 'Actual ingredient partnership report');
  assert.deepEqual(result.originals[0].published, ['2026-10-20']); assert.doesNotMatch(result.originals[0].text, /site navigation/);
 }
});

test('original rejection diagnostics preserve one rejected outcome while distinguishing actual transport causes', async () => {
 const cases = [
  ['timeout', 'source_timeout'], ['dns', 'source_dns_not_public'], ['redirect', 'source_redirect_limit'],
  ['request_budget', 'source_read_budget_exhausted'], ['tls', 'CERT_HAS_EXPIRED'], ['network', 'ECONNRESET'], ['unknown', 'fixture-unknown-error'],
 ] as const;
 for (const [kind, message] of cases) {
  const result = await readSearchOriginals([{ title: 'Article diagnostic fixture', uri: 'https://www.customs.gov.cn/article/report.html' }], { publicWeb: true, fetcher: async () => { throw Object.assign(Error(message), { code: message }); } });
  assert.equal(result.rejected, 1); assert.equal(result.rejectionReasons.unreadable, 1); assert.equal(result.rejectionReasons[kind], 1);
  if (kind === 'unknown') assert.equal(result.rejectionReasons.network, undefined);
 }
 const http = await readSearchOriginals([{ title: 'Article diagnostic fixture', uri: 'https://www.customs.gov.cn/article/report.html' }], { publicWeb: true, fetcher: async () => new Response('Missing', { status: 404 }) });
 assert.equal(http.rejected, 1); assert.equal(http.rejectionReasons.http, 1);
});

test('omitted model metrics are recovered from accepted original sentences without a second model call', async () => {
 const text = '全球化妆品原料市场在2026年预计继续保持增长态势，市场规模预计达到1020亿美元，相较2025年的940亿美元增长8.5%。';
 const market: SearchOriginal = { id: 'S2', source: { title: '公开市场研究摘要', uri: 'https://researchpublisher.com/report/cosmetics' }, published: ['2026-10-20'], text };
 const excluded: SearchOriginal = { ...market, id: 'S3', source: { title: '未采用的另一区域研究', uri: 'https://anotherpublisher.com/unused/report' }, text: '其他地区2026年预计市场规模达到9999亿美元。' };
 let calls = 0;
 const answer = await composeSearchEvidenceAnswer('行业资讯：行业：美妆原料，目标市场：全球。', [market, excluded], async () => {
  calls++; return JSON.stringify({ items: [{ sourceId: 'S2', quoteIds: ['S2-Q1'], fact: '研究机构发布全球化妆品原料市场规模的历史值和预测。', meaning: '提示原料企业可围绕应用方向开展客户调研。', action: '建议结合客户需求安排原料选型和技术资料。' }], conclusion: '可围绕原料应用开展客户调研。' });
 });
 const report = JSON.parse(answer.text.split('\n')[1]);
 assert.equal(calls, 1); assert.equal(report.metrics.length, 2);
 assert.ok(report.metrics.every((metric: { sourceUrl: string }) => metric.sourceUrl === market.source.uri));
 assert.deepEqual(report.metrics.map((metric: { value: number }) => metric.value).sort((a: number,b: number) => a-b), [940,1020]);
 assert.ok(!answer.text.includes('9999'));
});

test('daily news reuses structured visual reporting with all grounded items and their original publication dates',async()=>{
 const originals:SearchOriginal[]=['A','B','C','D'].map(letter=>({id:`S${letter}`,source:{title:`Company ${letter} product announcement`,uri:`https://news-${letter.toLowerCase()}.com/product`},published:['2026-10-20'],text:`Company ${letter} announced development of a personal care formulation for further application testing.`}));
 const items=originals.map((item,index)=>({sourceId:item.id,quoteIds:[`${item.id}-Q1`],fact:`企业${'ABCD'[index]}披露个人护理配方研发计划。`,meaning:'可能提供配方调研方向。',action:'建议核对技术资料和实际应用条件。'}));
 const answer=await composeSearchEvidenceAnswer('今日资讯。已明确的查询范围：{"industry":"美妆原料","market":"欧洲"}。',originals,async prompt=>{assert.match(prompt,/至多8条资料/);return JSON.stringify({items,conclusion:'可结合公开研发动作核对原料应用方向。'});},{freshnessDays:30});
 assert.match(answer.text,/^```industry-insight\n/);
 const report=JSON.parse(answer.text.split('\n')[1]);assert.equal(report.period,'最近30天');assert.equal(report.industry,'美妆原料');assert.equal(report.market,'欧洲');assert.equal(report.signals.length,4);assert.equal(answer.sources.length,4);
 assert.ok(report.signals.every((signal:{publishedAt:string})=>signal.publishedAt==='2026-10-20'));
 assert.ok(!report.summary.includes('今天发生'));
 const empty=await composeSearchEvidenceAnswer('今日资讯：行业：美妆原料，目标市场：欧洲。',[original],async()=>JSON.stringify({items:[],conclusion:'暂无符合本次范围的资料条目。'}),{freshnessDays:30});
 assert.match(empty.text,/^```industry-insight\n/);assert.deepEqual(JSON.parse(empty.text.split('\n')[1]).signals,[]);
});

test('real today-news FDA and research excerpts retain specific B2B implications instead of generic fallback', async () => {
 const cases=[{
  text:'出海 FDA 化妆品强制召回终版指南定稿，出海主体责任再升级 10-26 美国 FDA 于 2026 年 10 月 将化妆品强制召回问答指南定稿（公告号 91 FR 66851）。',
  fact:'美国FDA将化妆品强制召回问答指南定稿。',
  meaning:'提示出口美国的卸妆、面膜、护肤喷雾、防晒等品类合规主体责任升级，北美B2B采购商可能要求供应商提供与强制召回标准对齐的质量证据包。',
  action:'建议核对FDA公告号91 FR 66851原文，梳理面向北美客户的面膜、防晒等高风险品类的掺假与误标风险排查清单及召回预案。',
 },{
  text:'研发 水羊首次披露法国、美国、日本三大研发中心与五大实验室 10-24 水羊股份首次系统解读其全球化研发布局：在法国、美国、日本设立三大研发中心，并配套五大实验室，汇聚全球科研资源、主攻肌肤抗衰；',
  fact:'水羊股份披露在法国、美国、日本设立三大研发中心并配套五大实验室，主攻肌肤抗衰。',
  meaning:'提示中国美妆企业正从单纯出口转向在北美等地建立研发据点，北美B2B品牌主与私标采购商可能获得更贴近本地法规与肤感需求的配方开发支持。',
  action:'建议评估具备海外研发中心的代工厂在精华护理、面霜等抗衰品类的技术对接能力，核对其美国研发实体的具体资质与可承接的私标项目范围。',
 }];
 for(const fixture of cases){
  const source={...original,text:fixture.text};
  const candidate={items:[{sourceId:'S1',fact:fixture.fact,quoteIds:[searchOriginalExcerpts(source,4000)[0].id],meaning:fixture.meaning,action:fixture.action}],conclusion:'近期资料披露监管与研发动作。',conclusionSourceIds:['S1']};
  const result=await composeSearchEvidenceAnswer('今日资讯：目标市场：北美',[source],async()=>JSON.stringify(candidate));
  assert.ok(result.text.includes(fixture.meaning));assert.ok(result.text.includes(fixture.action));
  assert.doesNotMatch(result.text,/公开发布提供了进一步核对产品应用与客户需求的线索/);
  candidate.items[0].action+='预计增长999.99%。';
  const invalid=await composeSearchEvidenceAnswer('今日资讯：目标市场：北美',[source],async()=>JSON.stringify(candidate));
  assert.doesNotMatch(invalid.text,/999\.99/);
 }
});

test('real North America synthesis with empty findings and empty conclusion citations returns an honest empty observation',async()=>{
 const receipt=JSON.parse(readFileSync(new URL('./fixtures/daily-empty-north-america-replay.json',import.meta.url),'utf8')) as {raw:string;originals:SearchOriginal[];rejected:number};
 let calls=0;
 const result=await composeSearchEvidenceAnswer('今日资讯：行业：美妆个护与护肤品，目标市场：北美B2B。',receipt.originals,async()=>{calls++;return receipt.raw;},{rejected:receipt.rejected,freshnessDays:30});
 assert.equal(calls,1);assert.deepEqual(result.sources,[]);
 const report=JSON.parse(result.text.match(/```industry-insight\n([^]*?)\n```/u)![1]);
 assert.deepEqual(report.signals,[]);assert.ok(!report.metrics?.length);
 assert.doesNotMatch(result.text,/监管新规|3822亿|527件/);
 const missingCitations=structuredClone(draft);Object.assign(missingCitations,{conclusionSourceIds:[]});
 await assert.rejects(composeSearchEvidenceAnswer('今日资讯',[original],async()=>JSON.stringify(missingCitations)),{code:'search_analysis_invalid'});
 const badSource=structuredClone(draft);badSource.items[0].sourceId='S999';
 await assert.rejects(composeSearchEvidenceAnswer('今日资讯',[original],async()=>JSON.stringify(badSource)),{code:'search_analysis_quote_invalid'});
});

test('today synthesis can include global industry news without relabelling its actual country; industry scene keeps target-only scope',async()=>{
 const global:SearchOriginal={id:'S1',source:{title:'中国美妆企业原料研发合作公告',uri:'https://publisher.com/news/ingredient-partnership'},text:'中国美妆企业披露原料研发合作安排，并发布合作研究范围与产品应用方向。',published:['2026-10-28'],publicationDay:'2026-10-28'};
 const value={items:[{sourceId:'S1',quoteIds:['S1-Q1'],fact:'中国美妆企业披露原料研发合作安排。',meaning:'提示【全球行业参考】可进一步关注原料研发与产品方向。',action:'建议结合本企业产品核对研究范围与原料适配。'}],conclusion:'本次资讯提供全球行业研发合作的观察线索。'};
 const today=await composeSearchEvidenceAnswer('今日资讯，行业：美妆，目标市场：北美。',[global],async prompt=>{
  assert.match(prompt,/全球同行业当天发布/);assert.match(prompt,/【全球行业参考】/);assert.match(prompt,/不把中国或其他地区的新闻改写成北美/);
  assert.doesNotMatch(prompt,/只选与用户指定目标市场直接相关的资料|只选与目标市场相关的原文片段/);return JSON.stringify(value);
 },{freshnessDays:1,dailyWindow:{day:'2026-10-28',cutoff:'2026-10-28T14:00:00Z',timeZone:'Asia/Shanghai'}});
 assert.match(today.text,/中国美妆企业披露原料研发合作/);assert.match(today.text,/【全球行业参考】/);
 await composeSearchEvidenceAnswer('行业资讯，行业：美妆，目标市场：北美。',[global],async prompt=>{assert.match(prompt,/只选与用户指定目标市场直接相关的资料/);assert.doesNotMatch(prompt,/今日资讯取材包括全球同行业/);return JSON.stringify({items:[],conclusion:'没有形成与本次目标市场有关的资讯条目。'});},{freshnessDays:30});
});
