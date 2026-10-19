import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LangGraphTestStore} from '../../scripts/langgraphTestStore.js';
import {admitContentExecutionJob,readContentExecutionJob} from '../contentExecution/durableQueue.js';
import { createScopedSocialContentProductionWorker } from './socialContentProductionQueue.js';

test('scoped production worker requires an explicit durable job allow-list', () => {
  assert.throws(
    () => createScopedSocialContentProductionWorker([]),
    /scoped_production_job_ids_required/,
  );
  assert.throws(
    () => createScopedSocialContentProductionWorker([' job-id']),
    /scoped_production_job_ids_required/,
  );
});

test('scoped production worker can be constructed without starting global recovery loops', () => {
  const worker = createScopedSocialContentProductionWorker(['job-id', 'job-id']);
  assert.equal(worker.isLocallyActive('tenant', 'task'), false);
  worker.stop();
});

test('scoped production worker claims and settles against the injected durable store',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'scoped-production-store-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=path.join(root,'store.json'),first=new LangGraphTestStore(file);
  const job=await admitContentExecutionJob({dataStore:first,tenantId:'tenant',userId:'owner',
    taskId:'missing-task',runId:'missing-run',taskType:'social_content_weekly'});
  const restarted=new LangGraphTestStore(file);
  const worker=createScopedSocialContentProductionWorker([job.id],restarted);
  try{
    await worker.drain();
    for(let attempt=0;attempt<60&&worker.isLocallyActive('tenant','missing-task');attempt++)
      await new Promise<void>(resolve=>setImmediate(resolve));
  }finally{worker.stop();}
  const settled=await readContentExecutionJob(new LangGraphTestStore(file),'tenant','missing-task','missing-run');
  assert.equal(settled?.attempt,1);
  assert.match(settled?.lastError??'',/social_content_task_not_found/);
  assert.ok(['retry_wait','blocked'].includes(settled?.status??''));
});
