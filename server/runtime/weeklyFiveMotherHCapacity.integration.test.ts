import test from 'node:test';import assert from 'node:assert/strict';
import {prepareHCanonicalQueuedRuns} from './weeklyFiveMotherMultiAccount.fixture.js';
import {admitContentExecutionJob,setContentExecutionLimit,listContentExecutionJobs,DurableContentExecutionWorker,controlContentExecutionJob} from '../contentExecution/durableQueue.js';
for(const percent of [40,20] as const)test(`H${percent} real canonical content/run jobs obey independent two-account capacity and tenant/task type limits`,async t=>{
 const setup=await prepareHCanonicalQueuedRuns(t,percent),store=setup.f.store,now=new Date(setup.clock);
 const jobs=await Promise.all(setup.canonical.map(row=>admitContentExecutionJob({dataStore:store,tenantId:'t',userId:'owner',...row,taskType:'social_content_weekly',now})));
 assert.equal(new Set(jobs.map(job=>job.id)).size,5);assert.ok(jobs.every(job=>setup.canonical.some(row=>row.taskId===job.taskId&&row.runId===job.runId&&row.accountId===job.accountId)));
 let success=0;
 for(const limiting of ['account','tenant','task_type'] as const){
  if(limiting!=='account')for(const job of jobs)await controlContentExecutionJob({dataStore:store,tenantId:'t',jobId:job.id,action:'resume',now});
  await setContentExecutionLimit({dataStore:store,tenantId:'t',scope:'tenant',scopeKey:'*',maxRunning:limiting==='tenant'?1:5,updatedBy:'owner',now});
  await setContentExecutionLimit({dataStore:store,tenantId:'t',scope:'task_type',scopeKey:'social_content_weekly',maxRunning:limiting==='task_type'?1:5,updatedBy:'owner',now});
  for(const account of ['account','account-b'])await setContentExecutionLimit({dataStore:store,tenantId:'t',scope:'account',scopeKey:account,maxRunning:limiting==='account'?1:5,updatedBy:'owner',now});
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),started:string[]=[];
  const worker=new DurableContentExecutionWorker({dataStore:store,now:()=>now,env:{CONTENT_EXECUTION_WORKER_CONCURRENCY:'5',CONTENT_EXECUTION_TENANT_MAX_RUNNING:'5',CONTENT_EXECUTION_ACCOUNT_MAX_RUNNING:'5',CONTENT_EXECUTION_TASK_TYPE_MAX_RUNNING:'5'},execute:async job=>{started.push(job.accountId!);await gate;throw Error('content_execution_stopped');},onSucceeded:async()=>{success++;}});
  const expected=limiting==='account'?2:1;
  try{await worker.drain();await worker.drain();assert.equal(started.length,expected,limiting);if(limiting==='account')assert.deepEqual(started.slice().sort(),['account','account-b']);const current=await listContentExecutionJobs(store,'t');assert.equal(current.filter(job=>job.status==='running').length,expected);assert.equal(current.filter(job=>job.status==='queued').length,5-expected);assert.ok(current.every(job=>!job.completedAt&&job.providerReceipts.length===0));}finally{for(const job of jobs)await controlContentExecutionJob({dataStore:store,tenantId:'t',jobId:job.id,action:'pause'});release();for(let i=0;i<100&&setup.canonical.some(row=>worker.isLocallyActive('t',row.taskId));i++)await new Promise<void>(resolve=>setImmediate(resolve));worker.stop();}
 }
 assert.equal(success,0);assert.equal(setup.f.tables.starter_usage_ledger?.length??0,0);assert.equal(setup.f.tables.social_publication_attempts?.length??0,0);
});
