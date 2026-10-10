import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyQualityAuditFixture} from './weeklyContentQualityAudit.fixture.js';
import {validateContentArtifact} from './socialWeeklyResultValidation.js';

// This is a rejection test over an already-produced helper fixture. It is not
// evidence that M1 production or review succeeded; the separate continuous test
// must create its own package, run, artifact, audits and publication attempt.
test('M1 cannot reuse same-tenant seed media as another package, version or publication, or skip its independent director audit',async()=>{
  const originalFetch=globalThis.fetch;
  const externalRequests:string[]=[];
  globalThis.fetch=async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)){
      externalRequests.push(url.href);
      throw Error(`m1_test_external_fetch_forbidden:${url.origin}`);
    }
    return originalFetch(input,{...init,redirect:'error'});
  };
  let cleanup:(()=>Promise<void>)|undefined;
  try{
    const f=await prepareWeeklyQualityAuditFixture();cleanup=f.cleanup;
    const before={jobs:f.tables.content_execution_jobs?.length??0,g5:f.tables.starter_social_director_g5_reviews?.length??0,g6:f.tables.starter_social_weekly_g6_reviews?.length??0};
    for(const changed of [{packageId:'m1-new-package'},{packageVersion:f.task.packageVersion+1},{publicationTaskId:'m1-new-publication'}]){
      await assert.rejects(validateContentArtifact(f.store,{...f.task,...changed},f.ref));
    }
    // The seed has real local bytes and G4 receipts, but no independent G5 audit.
    await assert.rejects(validateContentArtifact(f.store,f.task,f.ref),/latest_g5_missing/);
    assert.deepEqual({jobs:f.tables.content_execution_jobs?.length??0,g5:f.tables.starter_social_director_g5_reviews?.length??0,g6:f.tables.starter_social_weekly_g6_reviews?.length??0},before);
    assert.deepEqual(externalRequests,[]);
  }finally{try{await cleanup?.();}finally{globalThis.fetch=originalFetch;}}
});
