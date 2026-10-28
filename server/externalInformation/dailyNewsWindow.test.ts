import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyNewsWindow,publicationMatchesDay} from './dailyNewsWindow.js';
import {readSearchOriginals} from './searchEvidenceAnswer.js';
import {industryInsightBlock} from './industryInsightReport.js';
import {qwenDiscoveryQuery} from '../agents/qwenDiscoveryQuery.js';
test('today follows Shanghai midnight, never a rolling day or the UTC date',()=>{
 const now=Date.parse('2026-10-28T16:05:00Z');const window=dailyNewsWindow('今日资讯',now)!;
 assert.equal(window.day,'2026-10-29');assert.equal(dailyNewsWindow('行业资讯',now),undefined);
 assert.equal(publicationMatchesDay({published:['2026-10-28'],publishedTimes:['2026-10-28T16:01:00Z']},window.day,now),true);
 assert.equal(publicationMatchesDay({published:['2026-10-28'],publishedTimes:['2026-10-28T15:59:00Z']},window.day,now),false);
 assert.equal(publicationMatchesDay({published:['2026-10-29'],publishedTimes:['2026-10-29T01:00:00+08:00']},window.day,now),false,'not-yet-published timestamps must not pass');
 assert.equal(publicationMatchesDay({published:['2026-10-29']},window.day,now),true);
 const query=qwenDiscoveryQuery('今日资讯，行业：护肤，市场：北美。查询最近30天。\n今日资讯发布日期范围：2026-10-29（Asia/Shanghai当天）',1);
 assert.match(query,/2026-10-29 Asia\/Shanghai publication date only/);assert.doesNotMatch(query,/past 30 days/);
});
test('original publication timestamps determine daily admission; old publication plus recent modification remains old',async()=>{
 const now=Date.parse('2026-10-28T14:00:00Z');const source={title:'Skincare local production news',uri:'https://publisher.com/news/local-production'};
 const html=(published:string)=>`<meta property="article:published_time" content="${published}"><meta property="article:modified_time" content="2026-10-28T12:00:00Z"><article><h1>${source.title}</h1><p>${'Actual public production announcement. '.repeat(12)}</p></article>`;
 const read=(published:string,day?:string)=>readSearchOriginals([source],{publicWeb:true,now,freshnessDays:day?1:30,publicationDay:day,fetcher:async()=>new Response(html(published),{headers:{'content-type':'text/html'}})});
 const today=await read('2026-10-27T20:00:00Z','2026-10-28');assert.equal(today.originals.length,1);assert.equal(today.originals[0].publicationDay,'2026-10-28');assert.deepEqual(today.originals[0].publishedTimes,['2026-10-27T20:00:00Z']);
 assert.equal((await read('2026-10-27','2026-10-28')).originals.length,0);
 assert.equal((await read('2026-10-20','2026-10-28')).originals.length,0);
 assert.equal((await read('2026-10-20')).originals.length,1,'industry keeps its requested thirty-day range');
});
test('daily summary states cutoff and actual included range without filling old news; industry period stays unchanged',()=>{
 const window=dailyNewsWindow('今日资讯',Date.parse('2026-10-28T14:00:00Z'))!;
 const report=JSON.parse(industryInsightBlock('今日资讯，行业：美妆。',[],'暂无可展示的专题资料。',0,1,[],window).split('\n')[1]);
 assert.equal(report.period,'2026-10-28（Asia/Shanghai当天）');assert.match(report.summary,/截至2026-10-28 22:00/);assert.match(report.summary,/实际收录2026-10-28当天发布的0条资讯、0个发布方/);
 assert.equal(JSON.parse(industryInsightBlock('行业资讯',[],'暂无资料',0,30).split('\n')[1]).period,'最近30天');
});
