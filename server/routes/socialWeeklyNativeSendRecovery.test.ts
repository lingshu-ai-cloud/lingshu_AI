import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {createSocialWeeklyNativeSendRecoveryRouter} from './socialWeeklyNativeSendRecovery';
test('native recovery HTTP accepts original request identity and explicit owner deadline, never caller provider proof',async()=>{
 const calls:unknown[]=[];const app=express();app.use(express.json());app.use((_req,res,next)=>{Object.assign(res.locals,{tenantId:'tenant',userId:'actor'});next();});
 app.use('/programs/:programId/weeks/:packageId/recovery',createSocialWeeklyNativeSendRecoveryRouter({list:async()=>[],sources:async()=>[],get:async()=>({}),create:async(a,actor,input)=>{calls.push({a,actor,input});return {id:'recovery'};},resolve:async(a,id,actor,input)=>{calls.push({a,id,actor,input});return {messagesSent:0,runAdvanced:false};}}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));try{const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}/programs/program/weeks/week/recovery`;const body={packageVersion:1,channel:'instagram',requestId:'original-request',ownerUserId:'owner',deadlineAt:'2026-10-11T10:00:00+08:00',reason:'原发送结果未知'};
 const post=(url:string,b:unknown)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
 for(const field of ['providerMessageId','actorUserId','tenantId','weeklyAuthority','body'])assert.equal((await post(base,{...body,[field]:'fake'})).status,400);
 assert.equal((await post(base,{...body,deadlineAt:'2026-10-11'})).status,400);assert.equal((await post(base,{...body,channel:'whatsapp'})).status,400);assert.equal(calls.length,0);
 assert.equal((await post(base,body)).status,201);assert.deepEqual(calls[0],{a:{tenantId:'tenant',programId:'program',packageId:'week',packageVersion:1},actor:'actor',input:{channel:'instagram',requestId:'original-request',ownerUserId:'owner',deadlineAt:body.deadlineAt,reason:body.reason}});
 assert.equal((await post(base+'/recovery/resolve',{packageVersion:1,expectedVersion:1,providerMessageId:'user-mid'})).status,400);assert.equal((await post(base+'/recovery/resolve',{packageVersion:1,expectedVersion:1})).status,200);assert.equal(calls.length,2);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
