import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { composeSearchEvidenceAnswer } from '../server/externalInformation/searchEvidenceAnswer.js';
const directory=path.resolve('data/local-store/search-candidates');
const files=(await fs.readdir(directory)).filter(file=>file.includes('-analysis-')).sort();
const receiptFile=files.at(-1);assert.ok(receiptFile);
const receipt=JSON.parse(await fs.readFile(path.join(directory,receiptFile),'utf8'));
const result=await composeSearchEvidenceAnswer('全球美妆原料BASF最近30天的原始发布',receipt.originals,async()=>receipt.raw,{freshnessDays:30,rejected:receipt.rejected});
assert.ok(result.sources.length>0);assert.match(result.text,/原文摘录/);assert.match(result.text,/总体结论/);
assert.doesNotMatch(result.text,/仅保留原文|摘要未通过/);
for(const source of result.sources){assert.ok(source.uri.startsWith('https://www.basf.com/'));}
const output=path.resolve('artifacts/external-news/completed-receipt-replay');await fs.mkdir(output,{recursive:true});
const evidence={testedAt:new Date().toISOString(),mode:'completed-provider-receipt-replay',receiptFile,paidRequests:0,sources:result.sources,
 originals:receipt.originals.map((item:{id:string;text:string;published:string[]})=>({id:item.id,published:item.published,sha256:createHash('sha256').update(item.text).digest('hex')})),
 completeFactSummary:true,scope:'Replay of an actual completed provider response and captured original pages; not a new live-provider or full semantic-quality certification'};
await fs.writeFile(path.join(output,'acceptance.json'),JSON.stringify(evidence,null,2));
await fs.writeFile(path.join(output,'answer.txt'),result.text);
console.log(JSON.stringify(evidence));
