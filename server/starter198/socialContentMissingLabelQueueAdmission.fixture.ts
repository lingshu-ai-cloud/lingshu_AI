import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LangGraphTestStore} from '../../scripts/langgraphTestStore.js';
import {createStarter198Repository,STARTER_COLLECTIONS} from './repository.js';
import {buildSocialTaskReferencePackage} from './socialContentScriptSources.js';
import {verifiedSocialScriptContext} from './socialContentScriptBaseline.js';
import {readSocialTaskDetail} from './socialContentRecords.js';
import {socialRequestHash} from './socialContentValidation.js';

import {listActiveSocialWorkPackageCards} from './socialWorkPackages.js';
export async function missingLabelStartFixture(t:test.TestContext,scriptStatus:'draft'|'confirmed'='confirmed'){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'label-start-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const store=new LangGraphTestStore(path.join(directory,'store.json'));
 const repository=createStarter198Repository(store,{materialLibrary:async()=>({items:[],total:0} as never)});
 const packages=await listActiveSocialWorkPackageCards({repository});
 const source={sourceId:'source',sourceRef:'https://example.com/reference',sourceVersion:'v1',createdAt:'2026-10-28T00:00:00.000Z'};
 const analysis={analysisMode:'exact',analysisQuality:'video',analysisRunId:'analysis',contentSha256:'a'.repeat(64),gemini:{theme:'工厂能力',
  audioTranscript:{segments:[{start:0,end:3,text:'工厂生产稳定。',timingPrecision:'phrase',provenance:'qwen3-asr-flash-filetrans'},{start:3,end:6,text:'欢迎联系。',timingPrecision:'phrase',provenance:'qwen3-asr-flash-filetrans'}]},
  scriptDetails15s:[{time:'0-3',purpose:'开场展示工厂',visual:'工厂生产线正在运转',dialogue:'工厂生产稳定。',
   materialType:'unknown',narrativeRole:'hook',needsReview:false,classificationEvidence:'',shot:'中景',camera:'固定',confidence:.99},{time:'3-6',purpose:'联系工厂',visual:'仓库画面',dialogue:'欢迎联系。',materialType:'unknown',narrativeRole:'cta',needsReview:false,classificationEvidence:'',shot:'中景',camera:'固定',confidence:.99}]}};
 const record={id:'reference',tenantId:'tenant',sourceUrl:source.sourceRef,aiAnalysis:JSON.stringify(analysis)};
 await store.create('trend_videos',record);
 const resolve=async()=>buildSocialTaskReferencePackage({record,source,themeId:'supplier_capability',verifiedContext:verifiedSocialScriptContext(null,null),planning:{materialRoutingPolicyVersion:'type-aware.v3',language:'zh',targetDurationSeconds:3,budgetCny:15}});
 const resolved=await resolve();assert.ok(resolved);resolved.replicationScript.status=scriptStatus;
 await store.create(STARTER_COLLECTIONS.socialContentTasks,{id:'task-row',tenant_id:'tenant',task_id:'film',task_mode:'instant',package_selection:packages,run_id:'',version:'1',status:'plan_review',
  theme_selection:{themeId:'supplier_capability',inputKind:'preset',classificationStatus:'confirmed',topic:'工厂生产'},
  brief:{restrictions:[],title:'工厂视频',objective:'介绍工厂',creationMode:'viral_replication',productionApproach:'ai_enhanced',
   materialRoutingPolicyVersion:'type-aware.v3',presenterPolicy:'none',productionMode:'social_ready',managementMode:'one_click_managed',
   productRef:'工厂',audience:'采购商',markets:['CN'],languages:['zh'],platforms:['douyin'],formats:['short_video'],aspectRatio:'9:16',requestedOutputCount:1,
   referenceReuse:{recordId:record.id,analysisId:analysis.analysisRunId,contentSha256:analysis.contentSha256,analysisHash:socialRequestHash(analysis)}},
  reference_video_analysis:resolved.referenceVideoAnalysis,replication_script:resolved.replicationScript,shot_material_map:resolved.shotMaterialMap,
  source_count:1,knowledge_source_count:0,material_source_count:0,artifact_count:0,approved_artifact_count:0,delivery_package_count:0,publication_count:0,metric_submission_count:0,
  created_by:'owner',created_at:source.createdAt,updated_at:source.createdAt});
 await store.create(STARTER_COLLECTIONS.socialTaskSources,{id:'source-row',tenant_id:'tenant',task_id:'film',source_id:source.sourceId,source_kind:'reference_link',
  source_ref:source.sourceRef,source_version:source.sourceVersion,status:'active',created_at:source.createdAt,label:'参考'});
 const detail=await readSocialTaskDetail({repository,tenantId:'tenant',taskId:'film'});assert.ok(detail);
 return {store,repository,detail,resolve,record,source};
}
