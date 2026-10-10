import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
import { SOCIAL_SCRIPT_BASELINE_SCHEMA, SOCIAL_SCRIPT_GROUNDING_VERSION } from '../starter198/socialContentScriptBaseline.js';
import { weeklyScriptEvidence } from './socialWeeklyScriptEvidence.js';
import { validateWeeklyExecutionResults } from './socialWeeklyResultValidation.js';
test('a grounded frozen-reference script is verifiable before rendering, without accepting fallback or unrelated scripts', async () => {
  const baseline = { schemaVersion:SOCIAL_SCRIPT_BASELINE_SCHEMA, version:'2', source:'inspiration_script', language:'zh', lockedAt:'2026-10-01T00:00:00Z', createdBeforeMaterialAdaptation:true, groundingVersion:SOCIAL_SCRIPT_GROUNDING_VERSION,
    match:{strategy:'inspiration',confidence:0.9,inspirationReference:{recordId:'candidate',confidence:0.9},verifiedKnowledgeSource:'enterprise_profile',verifiedFactKeys:['fact'],userTextUsage:'intent_only'},
    scenes:[{sceneId:'scene-1',shotFunction:'value',subject:'产品',action:'展示',script:'产品事实',voiceover:'产品事实',caption:'产品事实',narration:'产品事实'}] };
  const row:any={id:'row',tenant_id:'tenant',task_id:'content',run_id:'run',status:'producing',create_idempotency_key:'weekly-production:package:1:publication',brief:{programRef:{id:'program'},_weeklyAuthority:{referenceSelection:{selected:[{candidateId:'candidate'}]}}},script_baseline:baseline};
  const ref=weeklyScriptEvidence(row,['candidate'])!;
  assert.deepEqual(ref,{type:'starter_social_content_script_baseline',id:'content',version:2});
  assert.equal(weeklyScriptEvidence(row,['another-candidate']),null);
  assert.equal(weeklyScriptEvidence({...row,script_baseline:{...baseline,source:'knowledge_fallback'}},['candidate']),null);
  const pkg={id:'frozen-week',tenant_id:'tenant',program_id:'program',package_id:'package',version:1,payload:{programId:'program',packageId:'package',version:1,socialContentPackage:{publicationTasks:[{publicationTaskId:'publication'}]}}};
  const store={list:async(collection:string)=>({items:[collection==='social_weekly_operating_packages'?pkg:row],totalItems:1}),getById:async()=>({id:'run',tenant_id:'tenant',status:'running'})} as unknown as DataStore;
  const task={tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1,publicationTaskId:'publication',workflowKind:'content',schedule:{stepKind:'script'}} as WeeklyExecutionTask;
  await validateWeeklyExecutionResults(store,task,[ref]);
  await validateWeeklyExecutionResults(store,{...task,workflowKind:'directing'},[ref]);
  await assert.rejects(validateWeeklyExecutionResults(store,{...task,workflowKind:'directing',schedule:{...task.schedule,stepKind:'director_analysis'}},[ref]));
  await assert.rejects(validateWeeklyExecutionResults(store,{...task,workflowKind:'discovery'},[ref]));
  await assert.rejects(validateWeeklyExecutionResults(store,task,[{...ref,version:3}]));
  row.brief._weeklyAuthority.referenceSelection.selected=[{candidateId:'another-candidate'}];
  await assert.rejects(validateWeeklyExecutionResults(store,task,[ref]));
});
