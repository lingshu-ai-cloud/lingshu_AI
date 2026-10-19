import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type {AddressInfo} from 'node:net';
import {auth,store} from '../storage/index.js';
import {socialDiscoveryRouter} from './socialDiscovery.js';

test('candidate-only storyboard GET requires authentication and hides foreign weekly jobs',async t=>{
 t.mock.method(auth,'verifyToken',async(header?:string)=>header==='Bearer owner'?{tenantId:'tenant-a',userId:'owner'}:header==='Bearer foreign'?{tenantId:'tenant-b',userId:'foreign'}:null);
 t.mock.method(store,'getById',async(collection:string,id:string)=>collection==='social_weekly_preproduction_jobs'&&id==='job-a'?{id:'job-a',tenant_id:'tenant-a',payload:{jobId:'job-a'}}:null);
 t.mock.method(store,'list',async()=>({items:[],totalItems:0,totalPages:1,page:1}));
 const app=express();app.use('/api/overseas/social-discovery',socialDiscoveryRouter);
 const server=app.listen(0,'127.0.0.1');t.after(()=>server.close());await new Promise<void>(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/social-discovery/weekly-candidate-storyboard-briefs?jobId=job-a&runId=run-a`;
 assert.equal((await fetch(url)).status,401);
 const foreign=await fetch(url,{headers:{authorization:'Bearer foreign'}});assert.equal(foreign.status,404);assert.equal((await foreign.json()).error,'weekly_candidate_storyboard_job_not_found');
 const invalid=await fetch(url.replace('job-a','../job-a'),{headers:{authorization:'Bearer owner'}});assert.ok([400,404].includes(invalid.status));
});
