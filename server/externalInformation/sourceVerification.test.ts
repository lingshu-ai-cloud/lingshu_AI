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
