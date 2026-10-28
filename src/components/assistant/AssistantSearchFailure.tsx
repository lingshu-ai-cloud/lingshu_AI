import { CircleAlert } from 'lucide-react';
import type { AssistantWork } from '../../../shared/contracts/assistantWork';
import type { ReplySource } from '../../lib/assistantSourceLinks';

export interface SearchFailurePresentation { title: string; reason: string }
export function hasUsableReplySource(sources: ReplySource[] = []) {
  return sources.some(source => { try { const url = new URL(source.uri); return /^https?:$/u.test(url.protocol) && !url.username && !url.password; } catch { return false; } });
}
/** Final retrieval outcomes only. Structured empty observations follow original-page reading; access failures use separate receipts. Stored history remains unchanged. */
export function assistantSearchFailure({ content, sources = [], events = [], active = false }: {
  content: string; sources?: ReplySource[]; events?: AssistantWork[]; active?: boolean;
}): SearchFailurePresentation | null {
  if (active || hasUsableReplySource(sources)) return null;
  const emptyReport = content.match(/```industry-insight\s*\n([\s\S]*?)(?:\n```|$)/u);
  let emptyIndustry = false;
  if (emptyReport) { try { const value = JSON.parse(emptyReport[1]); emptyIndustry = value.version === 1 && Array.isArray(value.signals) && !value.signals.length; } catch { return null; } }
  if (emptyIndustry) return { title: '暂无符合条件的资讯', reason: '已读取候选资料，但未形成与本次查询范围相关且证据充分的资讯条目。' };
  const receipt = events.filter(event => event.status === 'failed' && /检索|公开来源|联网/u.test(event.label));
  const explicitFailure = /本轮未取得通过核验的资料|未取得可读取且符合时间范围的原文|(?:检索|搜索)(?:服务|任务)?[^。\n]{0,30}(?:失败|未完成|超时)|未取得(?:可交付|可核验)的资讯原文/u.test(content);
  if (!emptyIndustry && (!explicitFailure || (!receipt.length && !/本轮未取得通过核验的资料|未取得可读取且符合时间范围的原文/u.test(content)))) return null;
  const details = receipt.map(event => event.detail).join(' ') || content;
  let reason = '本次没有取得可读取并可核验的资讯原文。';
  if (/超时|timed?\s*out/iu.test(details)) reason = '检索或原文读取超时，本次没有取得可核验资料。';
  else if (/未配置|尚未配置/u.test(details)) reason = '搜索服务尚未配置，本次未能执行资料检索。';
  else if (/配额|限额|额度/u.test(details)) reason = '检索服务可用额度不足，本次未能取得资料。';
  else if (/网络|连接|访问失败|读取失败/u.test(details)) reason = '资料页面访问或读取失败，本次没有取得可核验原文。';
  else if (/缺少?(?:明确)?发布(?:日|时间)|无发布(?:日|时间)|(?:日期|时间范围)(?:不符合|不合格)|超出(?:查询|所选)?时间范围|已过期/u.test(details)) reason = '未取得符合查询时间范围且可读取的资料原文。';
  return { title: '本次检索未完成', reason };
}
export function AssistantSearchFailure({ failure }: { failure: SearchFailurePresentation }) {
  return <div role="status" aria-label="资讯检索状态" className="flex items-start gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm">
    <CircleAlert size={16} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden="true"/><div><strong className="font-semibold text-text-primary">{failure.title}</strong><p className="mt-1 leading-relaxed text-text-secondary">{failure.reason}</p></div>
  </div>;
}
