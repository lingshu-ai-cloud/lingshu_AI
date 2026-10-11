interface ScheduledDiscoveryResult {
  skipped?: true;
  reason?: string;
  run?: {
    runId?: string;
    status?: string;
    stopReason?: string | null;
    error?: string | null;
    modeStats?: Record<string, { accepted?: number }>;
    platformStats?: Record<string, { failed?: number }>;
  };
}

export function formatScheduledDiscoveryResult(result: ScheduledDiscoveryResult): string {
  if (result.skipped) return `执行状态：暂无结果\n发现采集未执行：${result.reason || 'no_discovery_mode_due'}`;
  const run = result.run;
  if (!run) return '执行状态：执行失败\n发现采集受阻：未返回可核验的采集运行记录。';
  const accepted = Object.values(run.modeStats || {}).reduce((sum, item) => sum + Math.max(0, Number(item.accepted || 0)), 0);
  const failedPlatforms = Object.entries(run.platformStats || {})
    .filter(([, item]) => Number(item.failed || 0) > 0)
    .map(([platform]) => platform);
  const failed = String(run.status || '').toLowerCase() === 'failed'
    || String(run.stopReason || '').toLowerCase() === 'source_failed';
  if (failed || accepted === 0) {
    const platforms = failedPlatforms.length ? `（${failedPlatforms.join('、')}）` : '';
    const reason = String(run.error || '').trim() || (run.stopReason === 'no_valid_results' ? '本轮没有通过质量门的可用内容' : '平台来源未返回可用内容');
    return `执行状态：执行失败\n发现采集受阻${platforms}：${reason}\n有效内容：${accepted} 条\n采集运行：${run.runId || 'unknown_run'}`;
  }
  if (String(run.status || '').toLowerCase() === 'partial') {
    return `执行状态：部分成功\n发现采集部分完成：有效内容 ${accepted} 条；部分平台或候选处理失败。\n采集运行：${run.runId || 'unknown_run'}`;
  }
  return `执行状态：执行成功\n发现采集已完成：有效内容 ${accepted} 条。\n采集运行：${run.runId || 'unknown_run'}`;
}
