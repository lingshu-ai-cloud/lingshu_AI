import type { MonitoredContent } from './socialChannels';
import type { InspirationTaskCandidate } from './socialInspirationTask';

/** These are observations for the director, not invented causal performance conclusions. */
export function monitoringReviewCandidate(item: MonitoredContent, now = new Date()): InspirationTaskCandidate {
  if (!item.platformUrl || !/^https?:\/\//i.test(item.platformUrl)) throw new Error('缺少原内容链接，暂时无法关联反馈创作。');
  const captured = Date.parse(item.capturedAt || '');
  if (!Number.isFinite(captured) || captured > now.getTime() + 60_000 || item.freshness !== 'fresh') {
    throw new Error('请先同步有效的近期指标，再基于反馈创作。');
  }
  const metrics = Object.entries(item.metrics).filter(([, value]) => typeof value === 'number' && Number.isFinite(value));
  if (!metrics.length) throw new Error('平台尚未返回可用指标，不能据此生成效果结论。');
  // The exact evidence snapshot is the review input; repeated clicks resume the same task.
  const window = new Date(captured).toISOString();
  return {
    id: `review:${item.id}:${window}`,
    title: `反馈优化 · ${item.title}`,
    sourceUrl: item.platformUrl,
    sourceVersion: item.capturedAt,
    objective: `根据原内容与真实反馈提出一项可验证的表达改进并制作新版本。原内容：${item.id}；账号：${item.accountId || '未提供'}；发布时间：${item.publishedAt || '未知'}；采集时间：${item.capturedAt}；数据来源：${item.source}；观测指标：${JSON.stringify(Object.fromEntries(metrics))}。单次观测不构成因果或成交归因，不能将未知指标当作零；保留原有事实与素材授权边界。`,
  };
}
