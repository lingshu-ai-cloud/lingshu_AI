import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverPublicNewsRss,publicNewsRssCandidates} from './publicNewsRssDiscovery.js';
import {readPublicSearchOriginal} from './publicSearchOriginal.js';
import {readSearchOriginals} from './searchEvidenceAnswer.js';
const now=Date.parse('2026-10-28T14:00:00Z');
const target='https://www.usatoday.com/press-release/story/52711/tafitie-introduces-10-mhz-ultrasound-beauty-device-for-at-home-skincare/';
// Actual Bing RSS metadata observed on 2026-10-28; feed contents never supply report facts.
const item=(link=target,date='Tue, 27 Oct 2026 09:54:00 GMT')=>`<item><title>TAFITIE Introduces 10 MHz Ultrasound Beauty Device for At-Home Skincare</title><link>${link.replaceAll('&','&amp;')}</link><pubDate>${date}</pubDate><description>Unverified feed summary, not an original article.</description></item>`;
const rss=(items=item())=>`<rss version="2.0"><channel>${items}</channel></rss>`;
test('real feed wrapper yields only public publisher candidates, never feed date or summary as evidence',()=>{
 const wrapper='http://www.bing.com/news/apiclick.aspx?ref=FexRss&url='+encodeURIComponent(target);
 assert.deepEqual(publicNewsRssCandidates(rss(item(wrapper)),{now,freshnessDays:7}),[{title:'TAFITIE Introduces 10 MHz Ultrasound Beauty Device for At-Home Skincare',uri:target}]);
 for(const link of ['https://127.0.0.1/article','https://private.local/article','javascript:alert(1)','http://publisher.com/article','https://user:password@publisher.com/article','https://news.google.com/rss/articles/token'])assert.deepEqual(publicNewsRssCandidates(rss(item(link)),{now}),[]);
 assert.deepEqual(publicNewsRssCandidates(rss(item(target,'Tue, 27 Oct 2025 09:54:00 GMT')),{now,freshnessDays:7}),[]);
 assert.deepEqual(publicNewsRssCandidates(rss(item()+item()),{now}).length,1);
 assert.throws(()=>publicNewsRssCandidates('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+rss()),/news_rss_invalid/);
});
test('bounded feeds share original-read budget, use no credentials, and failures retain any successful feed',async()=>{
 const budget={remaining:24};let calls=0;
 const candidates=await discoverPublicNewsRss(['United States skincare','Canada haircare','third ignored'],{now,freshnessDays:7,articleRequestBudget:budget,fetcher:async(input,init)=>{
  calls++;const url=new URL(String(input));assert.equal(url.hostname,'www.bing.com');assert.equal(url.searchParams.get('format'),'rss');assert.equal(init?.redirect,'manual');assert.equal(init?.headers,undefined);
  if(calls===2)throw Error('feed unavailable');return new Response(rss(),{headers:{'content-type':'application/xml'}});
 }});
 assert.equal(calls,2);assert.equal(budget.remaining,22);assert.equal(candidates.length,1);
 const failed=await discoverPublicNewsRss(['query'],{articleRequestBudget:{remaining:1},fetcher:async()=>{throw Error('unavailable');}});assert.deepEqual(failed,[]);
 const abort=new AbortController();abort.abort(Error('cancel-feed'));await assert.rejects(discoverPublicNewsRss(['query'],{signal:abort.signal,articleRequestBudget:{remaining:24}}),/cancel-feed/);
});
test('XML read capability is restricted to exact Bing RSS endpoint; normal articles remain HTML-only',async()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;return new Response(rss(),{headers:{'content-type':'application/xml'}});};
 for(const uri of ['https://other.com/news/search?format=rss&q=a','https://www.bing.com/other?format=rss&q=a','https://www.bing.com/news/search?format=rss&q=a&url=https://private.local'])await assert.rejects(readPublicSearchOriginal(new URL(uri),{responseFormat:'rss',fetcher}),/source_rss_endpoint_invalid/);
 assert.equal(calls,0);
 await assert.rejects(readPublicSearchOriginal(new URL(target),{fetcher}),/source_http_200/);
 await assert.rejects(readPublicSearchOriginal(new URL('https://www.bing.com/news/search?q=skincare&format=rss'),{responseFormat:'rss',fetcher:async()=>new Response(null,{status:302,headers:{location:target}})}),/source_rss_redirect_forbidden/);
});
test('RSS publication date cannot fill in a missing original-page publication date',async()=>{
 const candidates=publicNewsRssCandidates(rss(),{now,freshnessDays:7});
 const read=await readSearchOriginals(candidates,{publicWeb:true,now,freshnessDays:7,fetcher:async()=>new Response(`<article><h1>${candidates[0].title}</h1><p>${'Actual article body but no publication date. '.repeat(12)}</p></article>`,{headers:{'content-type':'text/html'}})});
 assert.equal(read.originals.length,0);assert.equal(read.rejectionReasons.date,1);
});
