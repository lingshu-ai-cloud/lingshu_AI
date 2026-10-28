import type { ContentExecutionJob } from '../contentExecution/durableQueueRecords.js';
import { socialRequestHash } from './socialContentValidation.js';

export const VIDEO_QUALITY_ACCEPTANCE_STAGE = 'social.video_quality_user_acceptance';

export type SocialVideoQualityAcceptance = {
  schemaVersion:'social-video-quality-user-acceptance.v1';tenantId:string;taskId:string;runId:string;
  jobId:string;mediaSha256:string;qualityInputHash:string;acceptedBy:string;acceptedAt:string;
  decision:'accept_unknown'|'accept_subtitle_style';recordHash:string;
};

export function socialVideoQualityAcceptanceRecord(input:Omit<SocialVideoQualityAcceptance,'schemaVersion'|'decision'|'recordHash'>,decision:SocialVideoQualityAcceptance['decision']='accept_unknown'):SocialVideoQualityAcceptance{
  const core={schemaVersion:'social-video-quality-user-acceptance.v1' as const,...input,decision};
  return{...core,recordHash:socialRequestHash(core)};
}

export function readAcceptedUnknownVideoQuality(job:ContentExecutionJob,mediaSha256:string,qualityInputHash:string):SocialVideoQualityAcceptance|null{
  const checkpoint=job.checkpoints[VIDEO_QUALITY_ACCEPTANCE_STAGE],value=checkpoint?.payload as SocialVideoQualityAcceptance|undefined;
  if(checkpoint?.version!=='1'||checkpoint.inputHash!==qualityInputHash||!value)return null;
  const {recordHash,...core}=value;
  return value.schemaVersion==='social-video-quality-user-acceptance.v1'&&['accept_unknown','accept_subtitle_style'].includes(value.decision)
    &&value.tenantId===job.tenantId&&value.taskId===job.taskId&&value.runId===job.runId&&value.jobId===job.id
    &&value.mediaSha256===mediaSha256&&value.qualityInputHash===qualityInputHash
    &&/^[a-f0-9]{64}$/.test(value.recordHash)&&socialRequestHash(core)===recordHash?value:null;
}
export const acceptedUnknownVideoQuality=(job:ContentExecutionJob,mediaSha256:string,qualityInputHash:string)=>Boolean(readAcceptedUnknownVideoQuality(job,mediaSha256,qualityInputHash));
