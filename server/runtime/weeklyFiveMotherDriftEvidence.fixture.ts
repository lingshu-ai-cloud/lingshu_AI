import assert from 'node:assert/strict';
import type {executeFiveMotherWeek} from './weeklyFiveMotherExecution.fixture.js';

/** Negative checks against actual generated artifacts, without supplier retries. */
export async function assertFiveMotherArtifactDriftRejected(f:Awaited<ReturnType<typeof executeFiveMotherWeek>>){
 const quality=f.graph.find(task=>task.schedule.stepKind==='quality_check')!;assert(quality);
 const reference=quality.resultRefs.find(ref=>ref.type==='starter_social_content_artifact')!;assert(reference);
 const artifact=f.f.tables.starter_social_content_artifacts!.find(row=>row.artifact_id===reference.id)!;assert(artifact);
 const before={runs:f.f.tables.workflow_runs?.length??0,jobs:f.f.tables.content_execution_jobs?.length??0,artifacts:f.f.tables.starter_social_content_artifacts?.length??0,attempts:f.f.tables.social_publication_attempts?.length??0};
 async function rejected(operation:()=>ReturnType<typeof f.adapter.execute>){try{const output=await operation();assert.notEqual(output.status,'succeeded','drifted generated evidence must be rejected');}catch(error){assert(error instanceof Error);if(error instanceof assert.AssertionError)throw error;}}
 const savedHash=artifact.content_hash;
 try{await f.f.store.update('starter_social_content_artifacts',String(artifact.id),{content_hash:'0'.repeat(64)});await rejected(()=>f.adapter.execute(quality));}
 finally{await f.f.store.update('starter_social_content_artifacts',String(artifact.id),{content_hash:savedHash});}
 await rejected(()=>f.adapter.execute({...structuredClone(quality),tenantId:'other-tenant'}));
 await rejected(()=>f.adapter.execute({...structuredClone(quality),packageVersion:quality.packageVersion-1}));
 assert.deepEqual({runs:f.f.tables.workflow_runs?.length??0,jobs:f.f.tables.content_execution_jobs?.length??0,artifacts:f.f.tables.starter_social_content_artifacts?.length??0,attempts:f.f.tables.social_publication_attempts?.length??0},before,'rejected actual artifact drift must not start suppliers or publications');
 const restored=await f.adapter.execute(quality);assert.equal(restored.status,'succeeded');
}
