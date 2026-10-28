import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import express from 'express';
import {weeklyVideoQualityFixture as fixture} from './weeklyVideoQuality.fixture.js';
import {readWeeklyVideoQualityMedia} from './weeklyVideoQualityMedia.js';
import {createWeeklyVideoQualityMediaRouter} from '../routes/weeklyVideoQualityMedia.js';
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

test('only current tenant/week/job/media/checkpoint can read the cached preview bytes',async t=>{
 const f=await fixture(t),input={...f.input,expectedQualityInputHash:'b'.repeat(64)};
 const read=(changed={})=>readWeeklyVideoQualityMedia(f.store,f.scope,{...input,...changed});
 const output=await read();assert.deepEqual(output.bytes,f.media);assert.equal(output.contentType,'video/mp4');
 for(const changed of [{expectedJobId:'other'},{expectedRunId:'other'},{expectedMediaSha256:'a'.repeat(64)},{expectedQualityInputHash:'a'.repeat(64)}])await assert.rejects(read(changed));
 await assert.rejects(readWeeklyVideoQualityMedia(f.store,{...f.scope,tenantId:'other'},input));
 await assert.rejects(readWeeklyVideoQualityMedia(f.store,{...f.scope,packageVersion:3},input));
 assert.equal(f.job().status,'blocked');assert.equal(f.tables.get('content_execution_jobs')!.length,1);
 await writeFile(f.cachePath,'tampered');await assert.rejects(read());
});

test('a sample must belong to this report and pass both path and actual PNG hash checks',async t=>{
 const f=await fixture(t),input={...f.input,expectedQualityInputHash:'b'.repeat(64)};
 const frame=Buffer.from('png-pixels'),frameSha256=sha(frame),directory=path.resolve('data/content-execution-quality',f.input.expectedMediaSha256);
 const framePath=path.join(directory,`2-${frameSha256}.png`);await mkdir(directory,{recursive:true});await writeFile(framePath,frame);t.after(()=>rm(directory,{recursive:true,force:true}));
 const quality=(f.job().checkpoints as any)['social.video_node_quality'].payload;
 quality.subtitleStyle.samples=[{framePath,frameSha256,atSeconds:2,subtitlePresent:true,font:true,fontSize:true,color:true}];
 const result=await readWeeklyVideoQualityMedia(f.store,f.scope,{...input,frameSha256});assert.deepEqual(result.bytes,frame);assert.equal(result.contentType,'image/png');
 await assert.rejects(readWeeklyVideoQualityMedia(f.store,f.scope,{...input,frameSha256:'c'.repeat(64)}));
 quality.subtitleStyle.samples[0].framePath=path.resolve('private',path.basename(framePath));await assert.rejects(readWeeklyVideoQualityMedia(f.store,f.scope,{...input,frameSha256}));
 quality.subtitleStyle.samples[0].framePath=framePath;await writeFile(framePath,'different');await assert.rejects(readWeeklyVideoQualityMedia(f.store,f.scope,{...input,frameSha256}));
});

test('preview endpoint uses authenticated tenant identity, no-store headers and validated selectors',async t=>{
 const f=await fixture(t),app=express();
 app.use((req,res,next)=>{if(req.headers['x-fixture-tenant'])res.locals.tenantId=req.headers['x-fixture-tenant'];next();});
 app.use(createWeeklyVideoQualityMediaRouter(f.store));
 app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.status??500).json({code:error.code}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const address=server.address();assert.ok(address&&typeof address==='object');
 const base=`http://127.0.0.1:${address.port}/p/operating-packages/week/execution-tasks/weekly/video-quality/media`;
 const query=new URLSearchParams({version:'2',jobId:'job',runId:'run',mediaSha256:f.input.expectedMediaSha256,qualityInputHash:'b'.repeat(64)});
 const url=`${base}?${query}`;
 assert.equal((await fetch(url)).status,401);
 const response=await fetch(url,{headers:{'x-fixture-tenant':f.scope.tenantId}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('content-type'),'video/mp4');assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.media);
 assert.equal((await fetch(`${url}&path=/etc/passwd`,{headers:{'x-fixture-tenant':f.scope.tenantId}})).status,400);
 assert.equal((await fetch(url,{headers:{'x-fixture-tenant':'foreign'}})).status,404);
 assert.equal(f.job().status,'blocked');
});
