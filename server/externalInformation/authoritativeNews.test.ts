import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AUTHORITATIVE_NEWS_SOURCES, collectAuthoritativeNews, discoverNewsArticles, readAuthoritativeNews, renderAuthoritativeNews } from './authoritativeNews.js';

test('only fixed official article paths are followed; no redirects, scripts or tracking queries',()=>{
 const source=AUTHORITATIVE_NEWS_SOURCES[2];
 const html='<a href="https://about.fb.com/news/2026/10/official/">Official original news</a><a href="https://evil.test/news/2026/10/x/">malicious article</a><a href="https://about.fb.com/news/2026/10/x/?token=abc">token-bearing link</a>';
 assert.deepEqual(discoverNewsArticles(html,source),[{url:'https://about.fb.com/news/2026/10/official/',title:'Official original news'}]);
});
test('collector preserves originals through partial outages and never presents historical material as today',async()=>{
 const cacheDir=await fs.mkdtemp(path.join(os.tmpdir(),'lingshu-news-test-'));
 const now=new Date('2026-10-27T08:00:00Z');
 const fetcher=(async (input,init)=>{
  assert.equal(init?.redirect,'error');
  const url=String(input);
  if(url==='https://about.fb.com/news/tag/reels/')return new Response('<a href="https://about.fb.com/news/2026/03/official/">Official original news</a>');
  if(url.endsWith('/official/'))return new Response('<meta property="article:published_time" content="2026-03-21"><h1>Official original news</h1><article>'+ 'Verified official article content. '.repeat(5)+'</article>');
  return new Response('unavailable',{status:503});
 }) as typeof fetch;
 try {
  const first=await collectAuthoritativeNews({cacheDir,now,fetcher});assert.equal(first.items.length,1);assert.equal(first.failures.length,2);
  const answer=renderAuthoritativeNews(first,'社交媒体资讯。美妆 美国 Facebook',now);
  assert.match(answer.text,/不代表今日动态/);assert.match(answer.text,/2026-03-21/);assert.equal(answer.sources.length,1);
  const second=await collectAuthoritativeNews({cacheDir,now:new Date('2026-10-27T09:00:00Z'),fetcher:async()=>new Response('',{status:503})});
  assert.equal(second.items.length,1);assert.equal(second.items[0].fetchedAt,first.items[0].fetchedAt);
  assert.equal((await readAuthoritativeNews(cacheDir))?.items.length,1);
  assert.equal(renderAuthoritativeNews(first,'社交媒体资讯。美妆 中国 TikTok',now).sources.length,3,'unmatched platform returns index choices, not fabricated TikTok results');
 } finally {await fs.rm(cacheDir,{recursive:true,force:true});}
});
