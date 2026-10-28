import { sourceArticleLinks } from './sourceVerification.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSourceUrl, extractSourceArticle, assertSourceSupport, verifySearchAnswer } from './sourceVerification.js';
import { hasOverallConclusion, appendInformationSources } from './sourceFooter.js';

const quote = '本次公告的统计口径仍以原始发布记录为准';
const date = '2026-10-20';
const html = `<html><head><meta content="${date}" property="article:published_time"><title>海关统计公告</title></head><body><article><h1>海关统计公告</h1><p>${quote}。贸易金额为18.8亿美元，增长2.5%。${'真实公开信息正文用于核验。'.repeat(10)}</p></article><script>恶意脚本2026-10-25，9999</script><footer>发布时间：2026-10-25</footer></body></html>`;
const sources = [{ title: '海关统计公告', uri: 'https://www.customs.gov.cn/article/report.html', citationIndex: 8 }];
const text = `${date}发布：贸易金额18.8亿美元，增长2.5%。“${quote}”[8]\n\n总体结论：本次资料可以确认公告中的统计口径，但不能据此判断企业自身经营表现。`;

test('original-page verification is bounded, credential-free and checks cited originals before release', async () => {
  let calls = 0;
  const verified = await verifySearchAnswer(text, sources, { freshnessDays: 30, fetcher: async (_input, init) => {
    calls++; assert.equal(init?.redirect, 'error'); assert.equal(init?.method, undefined);
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return new Response(html);
  } });
  assert.equal(calls, 1); assert.deepEqual(verified, sources);
  assert.ok(hasOverallConclusion(text));
  const final = appendInformationSources(text, verified);
  assert.ok(final.indexOf('总体结论') < final.indexOf('信息来源'));
  assert.match(final, /\[8\] \[海关统计公告\]/);
});

test('public source policy rejects private/user/redirect targets, credentials, homepages and fake official domains', () => {
  for (const url of ['http://www.customs.gov.cn/report', 'https://customs.gov.cn.evil.example/report', 'https://127.0.0.1/report', 'https://user:secret@customs.gov.cn/report', 'https://customs.gov.cn:444/report', 'https://customs.gov.cn/', 'https://customs.gov.cn/index.html', 'https://customs.gov.cn/report?token=secret']) assert.throws(() => publicSourceUrl(url), url);
});

test('publication date must be explicitly labelled; URL, footer and scripts are not evidence', () => {
  const extracted = extractSourceArticle(html);
  assert.deepEqual(extracted.published, [date]);
  assert.ok(!extracted.text.includes('9999'));
  assert.deepEqual(extractSourceArticle('<p>2026-10-25 这是一个年份，非发布日期</p>').published, []);
  assert.throws(() => assertSourceSupport(text, [{ ...extracted, published: ['2025-10-20'] }], 30));
  assert.throws(() => assertSourceSupport(text, [{ ...extracted, published: ['2026-02-30'] }], 30));
  assert.throws(() => assertSourceSupport(text.replace('18.8', '8.8'), [extracted]));
  assert.throws(() => assertSourceSupport(text.replace(quote, '原文中从来没有出现过的编造摘录内容'), [extracted]));
});

test('failed TLS, invented facts/index/quotes, missing conclusion and old pages expose only labelled leads', async () => {
  const cases = [text.replace('18.8', '118.8'), text.replace('[8]', '[1]'), text.replace('总体结论：', '结尾：'), text.replace(quote, '根本不存在于原始公告中的虚假摘录内容')];
  for (const answer of cases) await assert.rejects(verifySearchAnswer(answer, sources, { fetcher: async () => new Response(html) }), error => {
    assert.ok(error instanceof Error); assert.match(error.message, /总体结论：本轮检索找到了线索/);
    assert.match(error.message, /检索线索，原文未核验/); assert.ok(!error.message.includes('118.8')); return true;
  });
  await assert.rejects(verifySearchAnswer(text, sources, { fetcher: async () => { throw Error('TLS_PRIVATE_DETAIL'); } }), error => {
    assert.ok(error instanceof Error); assert.ok(!error.message.includes('TLS_PRIVATE_DETAIL')); return true;
  });
  const controller = new AbortController(); controller.abort(Error('cancelled'));
  await assert.rejects(verifySearchAnswer(text, sources, { signal: controller.signal }), /cancelled/);
});

test('one publisher cannot support a claim attributed to another, and duplicate indexes are rejected', async () => {
  const other = { title: '另一份海关统计', uri: 'https://www.customs.gov.cn/other.html', citationIndex: 2 };
  const answer = text.replace('[8]', '[2]') + `\n\n“${quote}”[8]`;
  await assert.rejects(verifySearchAnswer(answer, [other, ...sources], { fetcher: async input => new Response(String(input).includes('other') ? '<h1>另一份海关统计</h1>' + '无关内容'.repeat(40) : html) }), /原文/);
  await assert.rejects(verifySearchAnswer(text, [sources[0], { ...other, citationIndex: 8 }]), /原文/);
});

test('an old article publication field cannot be replaced by a newer sidebar date', () => {
  const article = extractSourceArticle('<meta name="PubDate" content="2025-01-01"><article>发布时间：2026-10-20</article>');
  assert.deepEqual(article.published, ['2025-01-01']);
  assert.deepEqual(extractSourceArticle('<div>发布时间：2026-10-20</div>').published, []);
});

test('article JSON-LD supplies a named publication date but modified dates and unrelated widgets cannot substitute it',()=>{
 const structured='<script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',datePublished:'2026-10-21T08:00:00+02:00',dateModified:'2026-10-26'})+'</script>';
 assert.deepEqual(extractSourceArticle(structured).published,['2026-10-21']);
 assert.deepEqual(extractSourceArticle('<script type="application/ld+json">'+JSON.stringify({'@type':'Organization',datePublished:'2026-10-26'})+'</script>').published,[]);
 assert.deepEqual(extractSourceArticle('<meta name="PubDate" content="2025-01-01">'+structured).published,['2025-01-01']);
});


test('numeric proof preserves spaces and list punctuation rather than merging adjacent figures',()=>{
 const article={text:'在2026年展会上发布，日期为10月21日。防晒配方SPF 50，另列21项。'+quote,published:['2026-10-21']};
 assert.doesNotThrow(()=>assertSourceSupport('2026，2026年发布，SPF 50。“'+quote+'”',[article]));
 assert.throws(()=>assertSourceSupport('数字20262026，SPF 500。“'+quote+'”',[article]));
});

test('unique article time datetime is a publication fallback while metadata remains authoritative', () => {
  const article = '<article><h1>Industry analysis</h1><time datetime="2026-10-21T09:30:00+02:00">21 October 2026</time><p>Actual article text.</p></article>';
  assert.deepEqual(extractSourceArticle(article).published, ['2026-10-21']);
  assert.deepEqual(extractSourceArticle(article.replaceAll('article', 'main')).published, ['2026-10-21']);
  assert.deepEqual(extractSourceArticle(article.replace('<h1>', '<header><h1>').replace('</time>', '</time></header>')).published, ['2026-10-21']);
  assert.deepEqual(extractSourceArticle('<meta property="article:published_time" content="2025-01-01">' + article).published, ['2025-01-01']);
  assert.deepEqual(extractSourceArticle('<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2025-01-01"}</script>' + article).published, ['2025-01-01']);
});

test('time fallback excludes update widgets, footer dates, invalid dates and ambiguous article dates', () => {
  for (const content of [
    '<time datetime="2026-10-21">21 October</time>',
    '<article><footer><time datetime="2026-10-21">21 October</time></footer></article>',
    '<main><aside><time datetime="2026-10-21">Related article</time></aside></main>',
    '<article><time itemprop="dateModified" datetime="2026-10-21">21 October</time></article>',
    '<article>Updated: <time datetime="2026-10-21">21 October</time></article>',
    '<article><time datetime="2026-02-30">30 February</time></article>',
    '<article><time datetime="2026-10-21Tinvalid">21 October</time></article>',
    '<article><time datetime="2026-10-21">First date</time><time datetime="2026-10-22">Second date</time></article>',
    '<article><time itemprop="startDate" datetime="2026-10-21">Event date</time></article>',
  ]) assert.deepEqual(extractSourceArticle(content).published, [], content);
  const content = '<article><time datetime="2026-10-21">Published</time><footer><time datetime="2026-10-25">Footer</time></footer></article>';
  assert.deepEqual(extractSourceArticle(content).published, ['2026-10-21']);
});

test('semantic div article bodies preserve nested text and explicitly labelled publication dates', () => {
 const body = '<header><h1>行业技术研究的新进展</h1></header><div class="byline">发布时间：2026-10-20</div><div>首段正文<div>嵌套资料</div>之后仍需保留的正文</div>';
 for (const marker of ['class="article-content clearfix"', 'id="news-body"', 'itemprop="articleBody"', 'role="main"']) {
  const result = extractSourceArticle('<nav>导航日期2026-10-27</nav><div '+marker+'>'+body+'</div><footer>发布时间：2026-10-28</footer>');
  assert.deepEqual(result.published, ['2026-10-20']); assert.equal(result.headline, '行业技术研究的新进展');
  assert.match(result.text, /嵌套资料/); assert.match(result.text, /之后仍需保留/); assert.doesNotMatch(result.text, /2026-10-28/);
 }
 assert.deepEqual(extractSourceArticle('<div class="content"><h1>泛栏目页面</h1>发布时间：2026-10-20</div>').published, []);
});

test('article-scoped headlines outrank a site navigation heading and explicit meta publication aliases are supported', () => {
 const html = '<header><h1>网站品牌导航标题</h1></header><meta name="publish_date" content="2026-10-20"><article><h1>真实报道的文章标题</h1><p>Article.</p></article>';
 assert.equal(extractSourceArticle(html).headline, '真实报道的文章标题'); assert.deepEqual(extractSourceArticle(html).published, ['2026-10-20']);
 for (const key of ['publish_time', 'pubtime']) assert.deepEqual(extractSourceArticle(html.replace('publish_date', key)).published, ['2026-10-20']);
 const outside = '<meta property="og:title" content="真实报道的文章标题"><meta name="PubDate" content="2026-10-20"><h1>真实报道的文章标题</h1><div class="article-body"><p>正文不重复标题但确实在同一文章页面。</p></div>';
 const result = extractSourceArticle(outside); assert.equal(result.headline, '真实报道的文章标题'); assert.match(result.text, /^真实报道的文章标题/);
});

test('div article fallback never treats sidebar, updated or unlabelled dates as publication proof', () => {
 const base = '<div class="article-content"><h1>报道标题文本</h1><p>正文资料</p>PLACEHOLDER</div>';
 for (const value of ['<aside>发布时间：2026-10-20</aside>', '<footer>发布时间：2026-10-20</footer>', '更新时间：2026-10-20', '2026-10-20', '<time itemprop="dateModified" datetime="2026-10-20">Updated</time>']) assert.deepEqual(extractSourceArticle(base.replace('PLACEHOLDER', value)).published, [], value);
});

test('an article section h1 cannot replace the real page headline from metadata or document title', () => {
 const title = '2026美妆包材新趋势:从环保合规到智能包装的源头对接';
 const body = '<article><h1>一、市场背景与现状</h1><p>2026年全球美妆包装市场规模预计将突破580亿美元。</p></article>';
 for (const head of ['<meta property="og:title" content="'+title+'">', '<title>'+title+'</title>']) {
  const result = extractSourceArticle('<html><head>'+head+'</head><body>'+body+'</body></html>');
  assert.equal(result.headline, title);
  assert.match(result.text, /一、市场背景与现状/);
 }
 assert.equal(extractSourceArticle(body).headline, undefined);
 assert.equal(extractSourceArticle('<title>目录</title>'+body).headline, undefined);
});

test('business audience acronyms do not become quantitative evidence or unsupported statistics', () => {
  const original={text:'企业披露研发合作与质量管理安排，采购商可进一步了解产品适配范围。',published:[]};
  const quote='企业披露研发合作与质量管理安排';
  for(const label of ['B2B','B2C','b2b','Ｂ２Ｂ']) assert.doesNotThrow(()=>assertSourceSupport(`提示${label}采购商核对产品适配范围。“${quote}”`,[original]));
  for(const claim of ['预计增长2%','增加2家客户','产品B12','产品B2B2']) assert.throws(()=>assertSourceSupport(`${claim}。“${quote}”`,[original]),/source_number_mismatch/);
  assert.throws(()=>assertSourceSupport(`增加2家客户。“${quote}”`,[{...original,text:original.text+'B2B服务'}]),/source_number_mismatch/,'an audience acronym in the source cannot authorize a numeric claim');
});

test('outbound original citations come only from article anchors and still require public safe URLs',()=>{
 const html='<nav><a href="https://nav.com/article">导航链接</a></nav><article><a href="https://www.fda.gov/cosmetics/cosmetics-news-events/final-guidance">FDA final recall guidance</a><a href="https://digest.com/other">同站推荐</a><a href="http://unsafe.com/article">不安全链接</a><a href="https://localhost/article">内部地址</a><script><a href="https://evil.com/article">脚本伪造</a></script></article>';
 assert.deepEqual(sourceArticleLinks(html,'https://digest.com/news/item'),[{title:'FDA final recall guidance',uri:'https://www.fda.gov/cosmetics/cosmetics-news-events/final-guidance'}]);
 assert.deepEqual(sourceArticleLinks('<a href="https://www.fda.gov/cosmetics/recall">无正文外链</a>','https://digest.com/news/item'),[]);
});
