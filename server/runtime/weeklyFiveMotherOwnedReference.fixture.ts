import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {TestContext} from 'node:test';
import {prepareWeeklyNonPresenterPlanningFixture} from './weeklyNonPresenterProduction.fixture.js';
import {createWeeklyPlanningAuthority} from '../socialPrograms/planningAuthority.js';
import {buildWeeklyWorkflow} from '../socialPrograms/weeklyPlanner.js';
import {createSocialOperatingRepository} from '../socialOperating/repository.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';

/** Local provider-contract evidence; historical metrics and ownership are explicit,
 * while reference media/frame verification is inherited from the real fixture. */
export async function prepareFiveMotherOwnedReferenceFixture(t:TestContext,ownedPercent:40|20){
 const setup=await prepareWeeklyNonPresenterPlanningFixture(t,{ownedReferenceBytes:true,primaryStructure:true,targetCta:'Contact sales',metricTargets:['播放目标1000','点赞目标20','评论目标5','分享目标5']});
 const {f,pkg,referenceId}=setup;
 const ownedReferenceId=`owned-${randomUUID()}`,sourceUrl=`https://www.tiktok.com/@owned/video/${ownedReferenceId}`;
 const original=f.tables.trend_videos!.find(row=>row.id===referenceId)!;
 const own=structuredClone(original);Object.assign(own,{id:ownedReferenceId,sourceUrl,title:'本账号历史产品演示'});
 const ownedFile=path.resolve('data/media/tenants/t/reference-videos',`${ownedReferenceId}.mp4`);await fs.copyFile(path.resolve('data/media',String(original.videoFileId)),ownedFile);t.after(()=>fs.rm(ownedFile,{force:true}));t.after(()=>fs.rm(path.resolve('data/media/tenants/t/reference-evidence',ownedReferenceId),{recursive:true,force:true}));own.videoFileId=`tenants/t/reference-videos/${ownedReferenceId}.mp4`;await f.store.create('trend_videos',own);
 const candidate=f.tables.social_candidate_evidence!.find(row=>row.candidateId===referenceId)!;
 const {id:originalCandidateId,...ownCandidate}=structuredClone(candidate);Object.assign(ownCandidate,{evidenceId:`evidence-${ownedReferenceId}`,candidateId:ownedReferenceId});
 (ownCandidate.evidence as Record<string,unknown>).inspirationId=ownedReferenceId;(ownCandidate.g1 as Record<string,unknown>).sourceUrl=sourceUrl;
 await f.store.create('social_candidate_evidence',ownCandidate);
 const frozen=f.tables.starter_social_inspiration_handoff_versions!.find(row=>(row.payload as Record<string,unknown>).inspirationId===referenceId)!;
 const handoff=structuredClone(frozen.payload) as Record<string,any>;handoff.inspirationId=ownedReferenceId;handoff.analysisId=`analysis-${ownedReferenceId}`;handoff.source.sourceUrl=sourceUrl;handoff.readiness='production_reference';handoff.rights={mayAnalyze:true,mayAdapt:true,mayUseOriginalMedia:false};handoff.reusableLogic={hookTypes:['原片图形运动开场'],revealOrder:['图形进入','图形持续移动'],proofPlacement:[],pacing:'两段各三秒',emotionalProgression:'观察到理解',ctaPosition:'结尾'};handoff.evidenceRefs=[{description:'受控provider契约：已实际抽帧核验图形运动，原片无人物；调性结论仅限该受控样片',confidence:.95,needsReview:false}];
 await f.store.create('starter_social_inspiration_handoff_versions',{tenant_id:'t',handoff_version:'1',record_hash:socialRequestHash(handoff),payload:handoff});
 await f.store.create('social_external_contents',{tenant_id:'t',account_id:'account',channel_id:'tiktok',external_content_id:ownedReferenceId,content:{tenantId:'t',accountId:'account',channelId:'tiktok',externalContentId:ownedReferenceId,status:'published',publicUrl:sourceUrl}});
 const snapshotId=`metric-${ownedReferenceId}`;
 await f.store.create('social_channel_metric_snapshots',{tenant_id:'t',account_id:'account',channel_id:'tiktok',external_content_id:ownedReferenceId,snapshot_id:snapshotId,snapshot:{snapshotId,tenantId:'t',accountId:'account',channelId:'tiktok',externalContentId:ownedReferenceId,capturedAt:'2026-10-01T00:00:00Z',source:'official_api',metrics:{views:1200,likes:20,shares:3,comments:4}}});
 pkg.planningBlockers=[];
 pkg.referenceSourcePolicy={profile:'b2b_established',allocationUnit:'mother_content',ownedPercent,externalPercent:100-ownedPercent};
 const template=structuredClone(pkg.socialContentPackage.publicationTasks[0]!);
 pkg.socialContentPackage.publicationTasks=Array.from({length:5},(_,i)=>({...structuredClone(template),publicationTaskId:`h-pub-${i+1}`,motherContentId:`h-mother-${i+1}`,publishWindow:`2026-10-${String(8+i).padStart(2,'0')}T10:00:00Z`}));
 Object.assign(pkg.socialContentPackage,{originalContentTarget:5,publicationTaskTarget:5,adaptationVersionTarget:0});
 const goal=await createSocialOperatingRepository(f.store).getGoal('t','p',pkg.businessContentGoalRef!.id,pkg.businessContentGoalRef!.version);assert.ok(goal);const workflow=buildWeeklyWorkflow({packageId:pkg.packageId,version:pkg.version,businessGoal:goal,capacity:null,automationPolicy:null,publicationTasks:pkg.socialContentPackage.publicationTasks,discoveryBudgetCny:pkg.discoveryBudgetCny});pkg.workflows=workflow.workflows;pkg.workflowTasks=workflow.tasks;
 f.tables.social_weekly_agent_planning=[];
 const packageRow=f.tables.social_weekly_operating_packages.find(row=>row.package_id===pkg.packageId&&row.version===pkg.version)!;assert.ok(packageRow);packageRow.payload=structuredClone(pkg);
 const service=createWeeklyPlanningAuthority(f.store),scope={tenantId:'t',programId:'p',packageId:pkg.packageId,packageVersion:pkg.version};
 const initialized=await service.initialize('t',pkg);
 const analysis=await service.runDirectorAnalysis({...scope,expectedPlanningVersion:initialized.version,actor:'director_agent',now:new Date('2026-10-02T00:00:00Z')});
 assert.equal(analysis.directorAnalyses.length,5,JSON.stringify(analysis.directorGaps));assert.equal(analysis.directorGaps?.length??0,0,JSON.stringify(analysis.directorAnalyses));
 const schedule=await service.mergeDetailedSchedule({tenantId:'t',programId:'p',package:pkg,expectedPlanningVersion:analysis.version,actor:'business_agent'});
 const confirmation=await service.confirm({...scope,expectedPlanningVersion:schedule.version,userId:'owner'});
 const dispatched=await service.dispatch({...scope,expectedPlanningVersion:confirmation.version,actor:'business_agent'});
 pkg.agentPlanning=structuredClone(dispatched);packageRow.payload=structuredClone(pkg);
 return {...setup,pkg,dispatched,ownedReferenceId,snapshotId};
}
