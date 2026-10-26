import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ASSISTANT_HOME_PROMPTS } from '../src/lib/assistantHomeQuickPrompts.js';
if (!process.argv.includes('--run')) throw Error('Use --run for the authorized local public-information feature test.');
const stage = process.argv.find(value => value.startsWith('--stage='))?.split('=')[1] ?? 'before';
const origin = 'http://127.0.0.1:5285', directory = path.resolve('artifacts/external-news', stage);
await fs.mkdir(directory,{recursive:true});
const session=await fetch(`${origin}/api/overseas/auth/local-preview-session`,{method:'POST',headers:{Origin:origin}});
if(!session.ok)throw Error(`session_${session.status}`);
const {token}=await session.json() as {token:string};
const results=[];
for(const id of (process.argv.find(value=>value.startsWith('--only='))?.split('=')[1]?.split(',')??['OP-02','OP-09','OP-11','OP-12'])){
 const entry=ASSISTANT_HOME_PROMPTS.find(item=>item.id===id)!;
 const started=Date.now();
 const response=await fetch(`${origin}/api/overseas/strategy/chat`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({messages:[{role:'user',content:process.argv.find(value=>value.startsWith('--query='))?.slice(8)??entry.prompt}]}),signal:AbortSignal.timeout(180000)});
 const raw=await response.text(); await fs.writeFile(path.join(directory,`${id}.sse`),raw);
 const events=raw.split('\n').filter(line=>line.startsWith('data: ')&&line!=='data: [DONE]').map(line=>JSON.parse(line.slice(6)));
 const result={id,label:entry.label,http:response.status,elapsedMs:Date.now()-started,done:raw.includes('data: [DONE]'),errors:events.flatMap(event=>event.error?[event.error]:[]),text:events.map(event=>event.text??'').join(''),sources:events.flatMap(event=>event.sources??[])};
 const expectation=process.argv.find(value=>value.startsWith('--expect='))?.split('=')[1];
 assert.equal(result.http,200);assert.equal(result.done,true);
 if(stage==='before')assert.ok(result.errors.some(value=>String(value).includes('联网来源能力尚未配置')));
 if(expectation==='clarification'){assert.equal(result.errors.length,0);assert.match(result.text,/请补充资讯范围/);}
 if(expectation==='verified'){assert.equal(result.errors.length,0);assert.ok(result.sources.length>0);assert.match(result.text,/原文摘录/);assert.match(result.text,/总体结论/);assert.doesNotMatch(result.text,/仅保留原文|摘要未通过/);}
 results.push(result);console.log(JSON.stringify(result));await fs.writeFile(path.join(directory,'results.json'),JSON.stringify(results,null,2));
}
