import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {createServer,type AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {pbStore} from '../storage/pbStore.js';
import {adoptWeeklyAutomationTemplate,WEEKLY_TEMPLATE_ADOPTIONS} from '../socialPrograms/weeklyAutomationTemplate.js';
import {WEEKLY_SAMPLE_POLICY_REVIEW_OPERATIONS,WEEKLY_SAMPLE_POLICY_REVIEW_DECISIONS,WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS,REVIEW_FIELDS} from '../socialPrograms/weeklySamplePolicyReview.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {createSocialProgramsRouter} from './socialPrograms.js';

const binary=process.env.WEEKLY_PB_TEST_BINARY||'/Users/julia1/.local/share/lingshu/pocketbase/pocketbase';
const migrations=fileURLToPath(new URL('../../pb_migrations/',import.meta.url));
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as AddressInfo).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port;}

test('real isolated PocketBase serves authenticated CTA GET/POST and restart read without sample approval',{
 skip:!existsSync(binary)?'PocketBase binary is unavailable':false,
},async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'weekly-cta-pb-'));
 const data=path.join(root,'pb_data'),hooks=path.join(root,'pb_hooks');await mkdir(hooks);
 const port=await freePort(),pbUrl=`http://127.0.0.1:${port}`;
 const old=Object.fromEntries(['PB_URL','PB_ADMIN_EMAIL','PB_ADMIN_PASSWORD','ENABLE_LOCAL_DEV_FALLBACK','DATA_BACKEND'].map(key=>[key,process.env[key]]));
 const email='isolated-admin@example.test',password='isolated-admin-password-2026';
 const userPassword='isolated-user-password-2026';
 const flags=['--dir',data,'--migrationsDir',migrations,'--hooksDir',hooks,'--automigrate=false'];
 let child:ChildProcess|null=null;
 const stop=async()=>{const running=child;if(!running)return;child=null;running.kill('SIGTERM');await Promise.race([new Promise(resolve=>running.once('exit',resolve)),pause(5000)]);if(running.exitCode===null)running.kill('SIGKILL');};
 t.after(async()=>{await stop();for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(root,{recursive:true,force:true});});
 execFileSync(binary,['migrate','up',...flags],{stdio:'ignore',timeout:30000});
 execFileSync(binary,['superuser','create',email,password,...flags],{stdio:'ignore',timeout:10000});
 process.env.PB_URL=pbUrl;process.env.PB_ADMIN_EMAIL=email;process.env.PB_ADMIN_PASSWORD=password;
 process.env.ENABLE_LOCAL_DEV_FALLBACK='false';process.env.DATA_BACKEND='pocketbase';
 const start=async()=>{child=spawn(binary,['serve','--http',`127.0.0.1:${port}`,...flags],{stdio:'ignore'});for(let i=0;i<100;i++){try{if((await fetch(`${pbUrl}/api/health`)).ok)return;}catch{/* starting */}await pause(50);}throw Error('isolated_pocketbase_not_ready');};
 await start();
 const scope={tenantId:'isolated-tenant',programId:'isolated-program',packageId:'isolated-package',packageVersion:1};
 const userId='abcde12345abcde';
 assert(await pbStore.create('users',{id:userId,email:'operator@example.test',password:userPassword,passwordConfirm:userPassword,verified:true,tenantId:scope.tenantId,role:'social_operator'}));
 const now=new Date().toISOString();
 const publication={publicationTaskId:'publication-a',accountId:'account-a',platform:'tiktok',motherContentId:'mother-a',factRefs:[]};
 const pkg={packageId:scope.packageId,programId:scope.programId,version:1,weekStart:'2026-10-12',weekEnd:'2026-10-18',socialContentPackage:{publicationTasks:[publication]}};
 assert(await pbStore.create('social_weekly_operating_packages',{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,version:1,week_start:pkg.weekStart,status:'active',payload:pkg,created_by:userId,created_at:now,updated_at:now}));
 await adoptWeeklyAutomationTemplate(pbStore,scope,userId);
 const adoptionRows=await pbStore.list<any>(WEEKLY_TEMPLATE_ADOPTIONS,{where:{tenant_id:scope.tenantId,package_id:scope.packageId},perPage:2});
 assert.equal(adoptionRows.totalItems,1);
 assert.match(adoptionRows.items[0]!.id,/^[a-f0-9]{15}$/);
 await assert.rejects(pbStore.create(WEEKLY_TEMPLATE_ADOPTIONS,{id:'123456789abcde0',tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:1,payload:adoptionRows.items[0]!.payload}),/create failed/);
 assert.equal((await pbStore.list(WEEKLY_TEMPLATE_ADOPTIONS,{where:{tenant_id:scope.tenantId,package_id:scope.packageId}})).totalItems,1,'database unique index prevents a competing template');
 const login=await fetch(`${pbUrl}/api/collections/users/auth-with-password`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identity:'operator@example.test',password:userPassword})});
 assert.equal(login.status,200,await login.clone().text());
 const token=(await login.json()).token as string;
 const app=express();app.use(express.json());app.use('/api/overseas/social-programs',createSocialProgramsRouter(pbStore));
 app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error.status??500).json({error:error.code??error.message}));
 const http=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>http.once('listening',resolve));
 t.after(()=>{http.closeAllConnections();return new Promise<void>(resolve=>http.close(()=>resolve()));});
 const url=`http://127.0.0.1:${(http.address() as AddressInfo).port}/api/overseas/social-programs/${scope.programId}/operating-packages/${scope.packageId}/cta-contact`;
 const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
 assert.equal((await fetch(`${url}?version=1`)).status,401);
 const beforeResponse=await fetch(`${url}?version=1`,{headers});
 assert.equal(beforeResponse.status,200,await beforeResponse.clone().text());
 const before=(await beforeResponse.json()).item;
 assert.equal(before.status,'missing');
 const input={expectedPackageVersion:1,contactChannel:'whatsapp',contactValue:'+8619653282176',expectedContextHash:before.contextHash,expectedReceiptId:null};
 const savedResponse=await fetch(url,{method:'POST',headers,body:JSON.stringify(input)});
 assert.equal(savedResponse.status,200,await savedResponse.clone().text());
 const saved=(await savedResponse.json()).item;
 assert.equal(saved.status,'recorded');assert.equal(saved.samplePromiseConfirmed,false);
 const stale=await fetch(url,{method:'POST',headers,body:JSON.stringify({...input,contactValue:'+8619653282177'})});
 assert.equal(stale.status,409,await stale.clone().text());
 // This is a storage-contract rehearsal, not a policy-approval call. There is
 // deliberately no route or production reader that treats these rows as proof.
 const reviewScope={...scope,publicationTaskId:'publication-a'},candidateId='c123456789abcde',reviewerId='f123456789abcde';
 const findings=REVIEW_FIELDS.map(field=>({field,page:1,excerpt:`Isolated documentary finding for ${field}`,conclusion:'supported' as const}));
 const id=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,15);
 const operationId=id(['weekly-policy-review-operation',reviewScope,candidateId,'a'.repeat(64),saved.receiptId,'b'.repeat(64),reviewerId,socialRequestHash(findings)]);
 const decisionId=id(['weekly-policy-review-decision',operationId]);
 const decision={kind:'weekly-sample-policy-review-decision.v1',decisionId,operationId,scope:reviewScope,candidateId,candidateHash:'a'.repeat(64),contactReceiptId:saved.receiptId,contactHash:'b'.repeat(64),reviewerUserId:reviewerId,reviewedAt:now,findings,outcome:'all_fields_supported',authorizesProduction:false,authorizesPublishing:false,authorizesCustomerMessages:false};
 const operation={kind:'weekly-sample-policy-review-operation.v1',operationId,scope:reviewScope,candidateId,candidateHash:'a'.repeat(64),contactReceiptId:saved.receiptId,contactHash:'b'.repeat(64),reviewerUserId:reviewerId,reviewedAt:now,findingsHash:socialRequestHash(findings),decisionHash:socialRequestHash(decision),status:'recorded_not_authoritative'};
 const common={tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:1,publication_task_id:'publication-a'};
 assert(await pbStore.create(WEEKLY_SAMPLE_POLICY_REVIEW_OPERATIONS,{id:operationId,...common,candidate_id:candidateId,content_hash:socialRequestHash(operation),payload:operation}));
 assert(await pbStore.create(WEEKLY_SAMPLE_POLICY_REVIEW_DECISIONS,{id:decisionId,...common,candidate_id:candidateId,operation_id:operationId,content_hash:socialRequestHash(decision),payload:decision}));
 await assert.rejects(pbStore.create(WEEKLY_SAMPLE_POLICY_REVIEW_DECISIONS,{id:'decis1234567890',...common,candidate_id:candidateId,operation_id:operationId,content_hash:socialRequestHash(decision),payload:decision}),/create failed/);
 const revocationId=id(['weekly-policy-review-revoke',reviewScope,decisionId]);
 const revocation={kind:'weekly-sample-policy-review-revocation.v1',revocationId,scope:reviewScope,decisionId,revokedBy:reviewerId,revokedAt:now,reason:'Source authority remains unproven'};
 assert(await pbStore.create(WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS,{id:revocationId,...common,decision_id:decisionId,content_hash:socialRequestHash(revocation),payload:revocation}));
 await assert.rejects(pbStore.create(WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS,{id:'revok1234567890',...common,decision_id:decisionId,content_hash:socialRequestHash(revocation),payload:revocation}),/create failed/);
 await stop();await start();
 const restored=await fetch(`${url}?version=1`,{headers});
 assert.equal(restored.status,200,await restored.clone().text());
 const again=(await restored.json()).item;
 assert.equal(again.receiptId,saved.receiptId);
 assert.equal(again.samplePromiseConfirmed,false);
 for(const [collection,recordId] of [[WEEKLY_SAMPLE_POLICY_REVIEW_OPERATIONS,operationId],[WEEKLY_SAMPLE_POLICY_REVIEW_DECISIONS,decisionId],[WEEKLY_SAMPLE_POLICY_REVIEW_REVOCATIONS,revocationId]] as const){
  const row=await pbStore.getById<any>(collection,recordId);
  assert(row,`${collection} survived PocketBase restart`);
  assert.equal(row.tenant_id,scope.tenantId);
  assert.equal(row.payload.authorizesProduction??false,false);
 }
});
