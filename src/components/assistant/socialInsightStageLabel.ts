import type { SocialInsightJob } from '../../../shared/socialInsightReport';
const stageLabel = { queued: '准备采集', collecting: '采集并核验公开内容', analyzing: '整理数据与报告', completed: '整理完成', blocked: '暂时无法生成' };
export function socialInsightStageLabel(job: Pick<SocialInsightJob, 'status' | 'stage'>): string {
  return job.status === 'failed' ? '采集未完成' : stageLabel[job.stage];
}
