import test from 'node:test';
import assert from 'node:assert/strict';
import { readSearchOriginals, composeSearchEvidenceAnswer, type SearchOriginal } from './searchEvidenceAnswer.js';
const sentence='Certain small businesses are exempt from facility registration and product listing requirements.';
const html=`<meta property="article:published_time" content="2026-10-20"><article><h1>Cosmetic registration requirements</h1><p>${sentence}</p><p>${'Additional original regulatory conditions. '.repeat(6)}</p></article>`;
const source={title:'Search title differs',uri:'https://www.fda.gov/cosmetics/registration',citationIndex:9};
const original:SearchOriginal={id:'S1',source,text:sentence,published:['2026-10-20']};
const draft={items:[{sourceId:'S1',fact:'部分小企业可能适用设施注册和产品列名豁免，仍需核对具体条件。',quoteIds:['S1-Q1'],meaning:'可能影响企业适用范围，不能把所有主体一概视为强制注册。',action:'建议逐项核对产品及企业是否符合豁免条件。'}],conclusion:'本次原文支持对豁免范围作进一步核对，不能据此判定本企业已经合规。'};
test('source-first reading uses actual original headings and dates, isolates failed candidates and never follows redirects',async()=>{
 const {originals,rejected}=await readSearchOriginals([source,{...source,uri:'https://www.fda.gov/unreadable'}],{now:Date.parse('2026-10-26'),freshnessDays:30,fetcher:async(input,init)=>{assert.equal(init?.redirect,'error');if(String(input).endsWith('unreadable'))throw Error('failed');return new Response(html);}});
 assert.equal(originals.length,1);assert.equal(rejected,1);assert.equal(originals[0].source.title,'Cosmetic registration requirements');
 const old=await readSearchOriginals([source],{now:Date.parse('2027-10-26'),freshnessDays:30,fetcher:async()=>new Response(html)});assert.equal(old.originals.length,0);
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
