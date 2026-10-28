import type {DataStore,Record_} from '../storage/datastore.js';
import {controlContentExecutionJob,readContentExecutionJob} from '../contentExecution/durableQueue.js';
import {SocialProgramError} from './service.js';
import {readWeeklyTaskWorkspace} from './weeklyTaskWorkspaces.js';
import {readAcceptedUnknownVideoQuality,socialVideoQualityAcceptanceRecord,VIDEO_QUALITY_ACCEPTANCE_STAGE} from '../starter198/socialVideoQualityAcceptance.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';

export type WeeklyVideoQualityAcceptanceScope={tenantId:string;actorUserId:string;programId:string;packageId:string;packageVersion:number;executionTaskId:string};
export type WeeklyVideoQualityAcceptanceInput={expectedJobId:string;expectedRunId:string;expectedMediaSha256:string;acceptUnknown:true;confirmSubtitleStyle?:true};

export async function acceptWeeklyUnknownVideoQuality(store:DataStore,scope:WeeklyVideoQualityAcceptanceScope,input:WeeklyVideoQualityAcceptanceInput,now=new Date()){
  if(!input||input.acceptUnknown!==true||(input.confirmSubtitleStyle!==undefined&&input.confirmSubtitleStyle!==true)||!input.expectedJobId||!input.expectedRunId||!/^[a-f0-9]{64}$/.test(input.expectedMediaSha256))throw new SocialProgramError('weekly_video_quality_acceptance_input_invalid',400,'当前成片接受参数无效。');
  const workspace=await readWeeklyTaskWorkspace(store,{tenantId:scope.tenantId,programId:scope.programId,packageId:scope.packageId,packageVersion:scope.packageVersion,executionTaskId:scope.executionTaskId});
  if(!workspace.contentTaskId||workspace.runId!==input.expectedRunId)throw new SocialProgramError('weekly_video_quality_acceptance_subject_changed',409,'当前成片或运行身份已变化，请刷新后重新验收。');
  const taskRows=await store.list<Record_>('starter_social_content_tasks',{where:{tenant_id:scope.tenantId,task_id:workspace.contentTaskId},page:1,perPage:2});
  if(taskRows.totalItems!==1||taskRows.items[0]?.run_id!==input.expectedRunId)throw new SocialProgramError('weekly_video_quality_acceptance_subject_changed',409,'原内容任务已变化，请刷新后重新验收。');
  const job=await readContentExecutionJob(store,scope.tenantId,workspace.contentTaskId,input.expectedRunId);
  const qualityCheckpoint=job?.checkpoints['social.video_node_quality'];
  if(!job||job.id!==input.expectedJobId||!qualityCheckpoint)throw new SocialProgramError('weekly_video_quality_acceptance_subject_changed',409,'原内容作业已变化，请刷新后重新验收。');
  const qualityInputHash=qualityCheckpoint.inputHash;
  const replay=readAcceptedUnknownVideoQuality(job,input.expectedMediaSha256,qualityInputHash);
  if(replay&&(replay.decision!=='accept_subtitle_style'||input.confirmSubtitleStyle===true)&&!['blocked','paused'].includes(job.status))return{taskId:workspace.contentTaskId,runId:job.runId,jobId:job.id,mediaSha256:input.expectedMediaSha256,status:job.status,acceptanceHash:replay.recordHash};
  const quality=workspace.runtime.videoQuality;
  if(workspace.runtime.recovery.jobId!==input.expectedJobId||quality?.mediaSha256!==input.expectedMediaSha256||job.workerId||job.leaseExpiresAt)throw new SocialProgramError('weekly_video_quality_acceptance_subject_changed',409,'原内容作业已变化，请刷新后重新验收。');
  if(quality.timelineStatus==='blocked'||(quality.subtitleStatus==='blocked'&&input.confirmSubtitleStyle!==true)||(quality.subtitleStatus==='passed'&&quality.timelineStatus==='passed'))throw new SocialProgramError('weekly_video_quality_acceptance_not_allowed',409,'音画同步明确失败必须修复；字幕样式失败需要用户明确确认当前版本。');
  let acceptanceHash=replay?.recordHash??'';
  const resumed=await controlContentExecutionJob({dataStore:store,tenantId:scope.tenantId,jobId:job.id,action:job.status==='paused'?'resume':'retry',now,beforeApply:async()=>{
    const current=await readContentExecutionJob(store,scope.tenantId,workspace.contentTaskId!,input.expectedRunId);
    if(!current||current.id!==input.expectedJobId||current.checkpoints['social.video_node_quality']?.inputHash!==qualityInputHash||socialRequestHash(current.checkpoints['social.video_node_quality'])!==socialRequestHash(qualityCheckpoint)||socialRequestHash(current.checkpoints['social.graph_render'])!==socialRequestHash(job.checkpoints['social.graph_render']))throw new SocialProgramError('weekly_video_quality_acceptance_subject_changed',409,'成片检查证据已变化，请刷新后重新验收。');
    const prior=readAcceptedUnknownVideoQuality(current,input.expectedMediaSha256,qualityInputHash);
    if(prior&&(quality.subtitleStatus!=='blocked'||prior.decision==='accept_subtitle_style'))return;
    if(!['blocked','paused'].includes(current.status)||current.workerId||current.leaseExpiresAt)throw new SocialProgramError('weekly_video_quality_acceptance_subject_changed',409,'原内容作业正在变化，请刷新后重试。');
    const record=socialVideoQualityAcceptanceRecord({tenantId:scope.tenantId,taskId:workspace.contentTaskId!,runId:input.expectedRunId,jobId:current.id,mediaSha256:input.expectedMediaSha256,qualityInputHash,acceptedBy:scope.actorUserId,acceptedAt:now.toISOString()},input.confirmSubtitleStyle?'accept_subtitle_style':'accept_unknown');
    acceptanceHash=record.recordHash;
    if(!await store.update('content_execution_jobs',current.id,{checkpoints:{...current.checkpoints,[VIDEO_QUALITY_ACCEPTANCE_STAGE]:{version:'1',inputHash:qualityInputHash,payload:record,updatedAt:now.toISOString()}}}))throw new SocialProgramError('weekly_video_quality_acceptance_write_failed',503,'当前成片接受回执保存失败。');
  }});
  const receipt=readAcceptedUnknownVideoQuality(await readContentExecutionJob(store,scope.tenantId,workspace.contentTaskId,input.expectedRunId)??resumed,input.expectedMediaSha256,qualityInputHash);
  return{taskId:workspace.contentTaskId,runId:resumed.runId,jobId:resumed.id,mediaSha256:input.expectedMediaSha256,status:resumed.status,acceptanceHash:receipt?.recordHash||acceptanceHash};
}
