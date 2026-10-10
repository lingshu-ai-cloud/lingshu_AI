import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {prepareWeeklyQualityAuditFixture} from '../runtime/weeklyContentQualityAudit.fixture.js';
import {g5FixtureScope,passedDirectorChecks} from '../starter198/socialDirectorG5ReviewService.fixture.js';
import {createWeeklyContentQualityRecoveryService,WEEKLY_QUALITY_REVIEW_BLOCK} from './weeklyContentQualityRecovery.js';

/** Real persisted source, media, G4 and weekly quality consumer; G5 remains explicit. */
export async function prepareWeeklyQualityRecoveryFixture(options:{hardFailure?:boolean}={}){
 const f=await prepareWeeklyQualityAuditFixture();
 f.tables.starter_social_content_tasks![0]!.weekly_plan_id='week1';
 const task:WeeklyExecutionTask={...f.task,taskId:'original-weekly-quality',scope:'content',subjectId:'pub',status:'blocked',dependsOnTaskIds:[],upstreamVersionRefs:[],inputSnapshot:{publicationTask:structuredClone(f.pkg.socialContentPackage.publicationTasks[0])},idempotencyKey:'weekly-quality-week1-v1-pub',budget:{category:'production',limitCny:10},schedule:{stepKind:'quality_check',responsibleActor:'content_agent',estimatedDurationMinutes:15,estimatedStartAt:'2026-10-01T00:00:00Z',estimatedFinishAt:'2026-10-01T00:15:00Z',actualStartedAt:null,actualFinishedAt:null},ownBlockingReasons:[WEEKLY_QUALITY_REVIEW_BLOCK],inheritedBlockingTaskIds:[],attempt:1,maxAttempts:3,nextAttemptAt:null,lease:null,resultRefs:[],lastError:{code:WEEKLY_QUALITY_REVIEW_BLOCK,message:'待独立审核',retryable:false,occurredAt:'2026-10-01T00:00:00Z'},recoveredFromDeadLetterAt:null,cancelReason:null,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z'};
 f.tables.social_weekly_execution_tasks=[{id:'quality-row',tenant_id:'t',program_id:'p',package_id:'week1',package_version:1,task_id:task.taskId,idempotency_key:task.idempotencyKey,payload:task}];
 if(options.hardFailure){task.ownBlockingReasons=['weekly_quality_audit_actual_repair_required'];task.lastError={code:'weekly_quality_audit_actual_repair_required',message:'实际技术检测要求修复原产物',retryable:false,occurredAt:task.updatedAt};}
 const current=()=>f.tables.social_weekly_execution_tasks!.find(row=>row.task_id===task.taskId)!.payload as WeeklyExecutionTask;
 const completeG5=async()=>{await f.g5.assign(g5FixtureScope,'owner',{reviewerUserId:'owner'});const ctx=await f.g5.context(g5FixtureScope,'owner');return f.g5.human(g5FixtureScope,'owner',{requestId:'quality-recovery-human-g5-0001',expectedContextHash:ctx.contextHash,checks:passedDirectorChecks(ctx)});};
 return {...f,task,scope:g5FixtureScope,current,completeG5,service:createWeeklyContentQualityRecoveryService(f.store)};
}
