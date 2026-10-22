import type { ScheduledTaskExecutionState } from '../lib/scheduledWorkflowHandoff';
import type { ScheduledTask } from './ScheduledPage';

export function scheduledTaskExecutionState(
  task: Pick<ScheduledTask, 'lastResult' | 'executionState'>,
  options: { running?: boolean; workerOnline?: boolean } = {},
): ScheduledTaskExecutionState {
  if (options.running) return 'running';
  const text = String(task.lastResult || '').trim();
  const serverState = task.executionState;
  const queued = serverState === 'queued' || /\u6267\u884c\u72b6\u6001\uff1a\u5df2\u6392\u961f|\u6267\u884c\u72b6\u6001\uff1a\u5904\u7406\u4e2d|\u7b49\u5f85\s*(?:Mac\s*)?(?:\u672c\u5730\s*)?Worker/.test(text);
  if (queued && options.workerOnline === false) return 'worker_offline';
  if (serverState) return serverState;
  if (queued) return 'queued';
  if (/执行状态：部分成功/.test(text)) return 'partial';
  if (/执行状态：已采集，待分析/.test(text)) return 'collected';
  if (/执行状态：暂无结果/.test(text)) return 'no_data';
  if (/执行状态：执行失败/.test(text)) return 'failed';
  if (/\u6267\u884c\u72b6\u6001\uff1a(?:\u6267\u884c\u6210\u529f|\u90e8\u5206\u6210\u529f)|\u4efb\u52a1\u6267\u884c\u5b8c\u6210|\u91c7\u96c6\u5df2\u7ed3\u675f/.test(text)) return 'succeeded';
  if (/\u6267\u884c\u72b6\u6001\uff1a\u6267\u884c\u5931\u8d25|\u6267\u884c\u5931\u8d25[:\uff1a]|\u4efb\u52a1\u5747\u6267\u884c\u5931\u8d25/.test(text)) return 'failed';
  return 'idle';
}

export const TASK_EXECUTION_META: Record<ScheduledTaskExecutionState, { label: string; style: string }> = {
  idle: { label: '待执行', style: 'bg-gray-100 text-gray-600' },
  queued: { label: '已入队', style: 'bg-amber-50 text-amber-700' },
  running: { label: '执行中', style: 'bg-blue-50 text-blue-700' },
  partial: { label: '部分成功', style: 'bg-amber-50 text-amber-700' },
  collected: { label: '已采集，待分析', style: 'bg-blue-50 text-blue-700' },
  no_data: { label: '暂无结果', style: 'bg-gray-100 text-gray-600' },
  succeeded: { label: '成功', style: 'bg-green-50 text-green-700' },
  failed: { label: '失败', style: 'bg-red-50 text-red-700' },
  worker_offline: { label: 'Worker 离线', style: 'bg-red-50 text-red-700' },
};

export function safeAnalysisActionMessage(message: unknown, fallback: string): string {
  const text = String(message || '').trim();
  if (!text) return fallback;
  if (/404|not found|unable to download|download webpage|unsupported url/i.test(text)) return '源视频暂时无法获取，请确认链接有效后重试。';
  if (/429|quota|resource_exhausted|额度|余额/i.test(text)) return 'AI 分析额度暂时不足，请稍后重试。';
  if (/timeout|timed out|超时/i.test(text)) return '视频分析超时，请稍后重试。';
  if (/command failed|python3|yt_dlp|\/app\/|ffmpeg|bearer|api[_-]?key/i.test(text)) return fallback;
  return text.slice(0, 120);
}
