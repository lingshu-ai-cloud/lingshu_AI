import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type {DataStore,ListQuery,Record_} from '../storage/datastore.js';
import {createSocialProgramService} from '../socialPrograms/service.js';
import {createWeeklyOperatingPackageService} from '../socialPrograms/weeklyOperatingPackages.js';
import {createWeeklyInitialScheduleRouter} from './weeklyInitialSchedule.js';
import {parseInitialSchedulePreview} from '../../src/lib/weeklyInitialScheduleApi.js';
import {createSocialProgramsRouter} from './socialPrograms.js';

test('initial schedule HTTP preview preserves draft and enforces actual scope and pristine state',async t=>{
 const tables=new Map<string,Record_[]>();let serial=0;
 const store:DataStore={
  async getById<T>(c:string,id:string){return structuredClone(tables.get(c)?.find(r=>r.id===id)??null)as T|null;},
  async create<T>(c:string,d:Record<string,unknown>){const row={id:`http-${++serial}`,...structuredClone(d)}as Record_;tables.set(c,[...(tables.get(c)??[]),row]);return structuredClone(row)as T;},
  async update(c,id,d){const row=tables.get(c)?.find(r=>r.id===id);if(!row)return false;Object.assign(row,structuredClone(d));return true;},
  async delete(c,id){const rows=tables.get(c)??[];tables.set(c,rows.filter(r=>r.id!==id));return rows.some(r=>r.id===id);},
  async list<T>(c:string,q:ListQuery={}){const rows=(tables.get(c)??[]).filter(r=>Object.entries(q.where??{}).every(([k,v])=>r[k]===v)),page=q.page??1,perPage=q.perPage??30;return {items:structuredClone(rows.slice((page-1)*perPage,page*perPage))as T[],totalItems:rows.length,totalPages:Math.max(1,Math.ceil(rows.length/perPage)),page,perPage};},
 };
 await store.create('users',{id:'owner',tenantId:'tenant',role:'admin'});
 const programs=createSocialProgramService(store),packages=createWeeklyOperatingPackageService(store);
 const program=await programs.createProgram('tenant','owner',{brandName:'First week',market:'EU',targetAudience:'Buyer',candidatePlatforms:['tiktok'],route:'cold_start'});
 const account=await programs.createAccount('tenant','owner',program.programId,{platform:'tiktok',displayName:'Factory',businessRole:'core',audiencePromise:'buyer',contentPromise:'facts'});
 const pkg=await packages.create('tenant','owner',program.programId,{weekStart:'2026-11-09',objective:'One verified publication',successCriteria:['One reviewed video'],accountPlans:[{accountId:account.accountId,publicationCount:1}],originalContentTarget:1});
 const snapshot=()=>JSON.stringify([...tables].filter(([c])=>c!=='durable_operation_leases'));
 const before=snapshot();let tenant:string|undefined='tenant';
 const app=express();app.use(express.json());
 // Exercise the router's authenticated scope contract; this fixture does not issue JWTs.
 app.use((_req,res,next)=>{res.locals.tenantId=tenant;res.locals.userId='owner';next();});
 app.use('/api/overseas/social-programs',createSocialProgramsRouter(store,false));
 app.use('/:programId/:packageId',createWeeklyInitialScheduleRouter(store));
 const server=app.listen(0);await new Promise<void>(resolve=>server.once('listening',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const address=server.address();assert.ok(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}/${program.programId}/${pkg.packageId}`;
 const response=await fetch(`${url}?version=1`),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
 const preview=parseInitialSchedulePreview(body.item,{tenantId:'tenant',programId:program.programId,packageId:pkg.packageId,packageVersion:1});
 assert.equal(preview.authority,'estimated_task_durations_only');assert(preview.graph.tasks.some(task=>task.schedule.stepKind==='material_preparation'));
 assert.equal(preview.requiredInputs.length,preview.graph.tasks.length);assert(preview.requiredInputs.every(input=>input.missing.includes('resourceWorkingWindows')));
 const mountedUrl=`http://127.0.0.1:${address.port}/api/overseas/social-programs/${program.programId}/operating-packages/${pkg.packageId}/initial-schedule`;
 const mountedResponse=await fetch(`${mountedUrl}?version=1`);assert.equal(mountedResponse.status,200);const mounted=await mountedResponse.json();
 assert.deepEqual(parseInitialSchedulePreview(mounted.item,{tenantId:'tenant',programId:program.programId,packageId:pkg.packageId,packageVersion:1}).graph.tasks.map(task=>task.taskId),preview.graph.tasks.map(task=>task.taskId));
 assert.equal(snapshot(),before,'preview cannot revise, activate, execute or persist proposals');
 assert.equal((await fetch(`${url}?version=invalid`)).status,400);assert.equal((await fetch(`${url}?version=2`)).status,409);
 tenant=undefined;assert.equal((await fetch(`${url}?version=1`)).status,401);tenant='foreign';assert.equal((await fetch(`${url}?version=1`)).status,403);tenant='tenant';
 await store.update('users','owner',{disabled:true});assert.equal((await fetch(`${url}?version=1`)).status,403);await store.update('users','owner',{disabled:false});
 const post=(path:string,value:unknown)=>fetch(`${url}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
 assert.equal((await post('/proposals',{packageVersion:1,tenantId:'foreign',capacity:{constraints:{},resources:{},remainingBudgetCny:1}})).status,400);
 assert.equal((await post('/confirm',{packageVersion:1,expectedVersion:2,proposalId:'fake',inputEvidenceHash:'fake'})).status,400);
 const row=tables.get('social_weekly_operating_packages')!.find(r=>r.package_id===pkg.packageId)!;const payload=row.payload as Record<string,unknown>;payload.status='active';
 const drift=await fetch(`${url}?version=1`);assert.equal(drift.status,409);assert.equal((await drift.json()).code,'weekly_initial_schedule_not_pristine');
 assert.equal(tables.get('content_execution_jobs')?.length??0,0);assert.equal(tables.get('social_publication_attempts')?.length??0,0);
});
