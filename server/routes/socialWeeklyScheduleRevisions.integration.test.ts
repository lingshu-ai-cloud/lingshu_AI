import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type {DataStore,ListQuery,Record_} from '../storage/datastore.js';
import {createSocialProgramService} from '../socialPrograms/service.js';
import {createWeeklyOperatingPackageService} from '../socialPrograms/weeklyOperatingPackages.js';
import {createSocialWeeklyScheduleRevisionsRouter} from './socialWeeklyScheduleRevisions.js';
import {parseScheduleTargetGraph} from '../../src/lib/socialProgramApi.js';

function isolatedStore(){
 const tables=new Map<string,Record_[]>();let serial=0;
 const store:DataStore={
  async getById<T>(name:string,id:string){return structuredClone(tables.get(name)?.find(r=>r.id===id)??null) as T|null;},
  async create<T>(name:string,value:Record<string,unknown>){const row={id:`row-${++serial}`,...structuredClone(value)} as Record_;tables.set(name,[...(tables.get(name)??[]),row]);return structuredClone(row) as T;},
  async update(name,id,value){const row=tables.get(name)?.find(r=>r.id===id);if(!row)return false;Object.assign(row,structuredClone(value));return true;},
  async delete(name,id){const rows=tables.get(name)??[];tables.set(name,rows.filter(r=>r.id!==id));return rows.some(r=>r.id===id);},
  async list<T>(name:string,query:ListQuery={}){let rows=(tables.get(name)??[]).filter(r=>Object.entries(query.where??{}).every(([k,v])=>r[k]===v));if(query.sort)rows=[...rows].sort((a,b)=>String(a[query.sort!]).localeCompare(String(b[query.sort!])));const page=query.page??1,perPage=query.perPage??30;return {items:structuredClone(rows.slice((page-1)*perPage,page*perPage)) as T[],totalItems:rows.length,totalPages:Math.max(1,Math.ceil(rows.length/perPage)),page,perPage};},
 };
 return {store,tables};
}

test('actual target graph HTTP route precedes proposal lookup, projects real factory and performs no production mutation',async t=>{
 const {store,tables}=isolatedStore();await store.create('users',{id:'owner',tenantId:'tenant',role:'admin'});
 const programs=createSocialProgramService(store),packages=createWeeklyOperatingPackageService(store);
 const program=await programs.createProgram('tenant','owner',{brandName:'Preview factory',market:'EU',targetAudience:'Buyer',candidatePlatforms:['tiktok'],route:'cold_start'});
 const account=await programs.createAccount('tenant','owner',program.programId,{platform:'tiktok',displayName:'Factory',businessRole:'core',audiencePromise:'buyer',contentPromise:'facts'});
 const pkg=await packages.create('tenant','owner',program.programId,{weekStart:'2026-11-09',objective:'Deliver one publication',successCriteria:['One approved video'],accountPlans:[{accountId:account.accountId,publicationCount:1}],originalContentTarget:1});
 const before=JSON.stringify([...tables].filter(([name])=>name!=='durable_operation_leases'));
 let activeTenant='tenant';const app=express();app.use((_req,res,next)=>{res.locals.tenantId=activeTenant;res.locals.userId='owner';next();});app.use('/:programId/:packageId',createSocialWeeklyScheduleRevisionsRouter(store));const server=app.listen(0);await new Promise<void>(resolve=>server.once('listening',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));const address=server.address();assert.ok(address&&typeof address==='object');
 const url=`http://127.0.0.1:${address.port}/${program.programId}/${pkg.packageId}/target-graph`;
 const response=await fetch(`${url}?version=1`);const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
 const graph=parseScheduleTargetGraph(body.item,{tenantId:'tenant',programId:program.programId,packageId:pkg.packageId,packageVersion:1});assert.equal(graph.targetVersion,2);assert(graph.tasks.some(task=>task.schedule.stepKind==='material_preparation'));
 assert.equal(JSON.stringify([...tables].filter(([name])=>name!=='durable_operation_leases')),before,'preview may acquire its guard but cannot revise packages, execute tasks, or save proposals');
 assert.equal((await fetch(`${url}?version=2`)).status,409);assert.equal((await fetch(`${url}?version=invalid`)).status,400);
 activeTenant='foreign';assert.equal((await fetch(`${url}?version=1`)).status,403);activeTenant='tenant';await store.update('users','owner',{disabled:true});assert.equal((await fetch(`${url}?version=1`)).status,403);
 assert.equal(tables.get('content_execution_jobs')?.length??0,0);assert.equal(tables.get('social_publication_attempts')?.length??0,0);
});
