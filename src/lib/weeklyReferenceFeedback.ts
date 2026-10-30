import type { SocialInspirationCollectionRun } from '../../shared/contracts/socialContentWorkflow';
import type { DigitalEmployeeOverview } from './digitalEmployees';
import { weeklyHomeIndicator } from './weeklyHomeIndicator';

type CollectionResult = { run?: SocialInspirationCollectionRun; skipped?: boolean; reason?: string };
export function weeklyReferenceCollectionFeedback(result: CollectionResult): string {
  if (result.skipped) return result.reason === 'no_discovery_mode_due'
    ? '本次未重复采集：当前范围没有到期的采集项。可重新核验已有参考。'
    : '本次采集未启动，请检查采集范围和已有采集记录。';
  const run = result.run;
  if (!run) return '暂未取得采集回执，结果无法确认。请查看采集记录，不要重复提交。';
  if (run.status === 'running' || run.status === 'queued') return '采集仍在处理中；尚未取得完成回执。请稍后查看采集记录，再重新核验参考。';
  const errors = [run.error || '', ...(run.failureDetails || []).map(item => item.error)].join(' ');
  if (/isolated_test_network_blocked|ISOLATED_NETWORK_BLOCKED/.test(errors)) {
    return '本次采集失败：本地预览的网络隔离配置阻止了外部采集请求，未取得可用参考。请先配置采集环境，或手动录入参考。';
  }
  if (run.status === 'failed') return '本次采集失败，未取得可用参考。请查看采集记录中的来源错误，处理后再试。';
  if (run.status === 'stopped') return run.stopReason === 'daily_collection_limit_reached'
    ? '本次采集已停止：达到当日采集上限。请查看采集记录并核验已有参考。'
    : '本次采集已结束，没有取得合格参考。请调整采集范围或手动录入参考。';
  if (run.status === 'partial') return '本次采集部分完成，部分来源失败。已采集内容仍需完成分析并重新核验，才能绑定周计划。';
  return '本次采集已完成。新视频或图文仍需完成分析并重新核验，才能绑定周计划。';
}

export function weeklyPlanExecutionLabel(data: DigitalEmployeeOverview | null): string {
  if (!data) return '周计划状态待确认';
  if (!data.goal) return '周计划待生成';
  if (!data.run) {
    if (data.goal.status === 'completed') return '周计划已完成';
    if (data.goal.status === 'cancelled') return '周计划已取消';
    return data.goal.status === 'draft' ? '周计划待确认' : '周计划待启动';
  }
  if (data?.run?.status === 'succeeded' || data?.run?.status === 'completed') return '周计划已完成';
  if (data?.run?.status === 'cancelled') return '周计划已取消';
  if (data.run.status === 'failed') return '周计划执行失败';
  if (data.run.status === 'paused') return '周计划已暂停';
  const indicator = weeklyHomeIndicator(data);
  if (indicator === 'attention') return '周计划需要处理';
  if (indicator === 'producing') return '周计划正在生产';
  return '周计划等待执行';
}
