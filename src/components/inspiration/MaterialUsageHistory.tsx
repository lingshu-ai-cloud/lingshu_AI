import { Zap } from 'lucide-react';
import type { Material } from '../../lib/studioApi';

function compactMetric(value: number | undefined): string {
  const normalized = Number.isFinite(Number(value)) ? Number(value) : 0;
  return new Intl.NumberFormat('zh-CN', { notation: normalized >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(normalized);
}

function materialUsageRoleLabel(role: string): string {
  return ({
    three_second_hook: '前三秒钩子',
    body: '正文画面',
    proof: '证据画面',
    cta: '行动引导',
    cover: '封面',
    generation_reference: '生成参考',
  } as Record<string, string>)[role] || role;
}

export function MaterialUsageMark({ material }: { material: Material }) {
  const summary = material.usageSummary;
  if (!summary || summary.totalUses < 1) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-[11px] font-semibold text-text-secondary" aria-label="素材使用记录">
      <span>已使用 {summary.totalUses} 次</span>
      {summary.hookUses > 0 ? <span className="inline-flex items-center gap-1 text-accent"><Zap size={11} aria-hidden="true" />前三秒 {summary.hookUses} 次</span> : null}
    </div>
  );
}

export function MaterialUsagePanel({ material }: { material: Material }) {
  const summary = material.usageSummary;
  const stats = [
    ['使用次数', compactMetric(summary?.totalUses)],
    ['前三秒钩子', compactMetric(summary?.hookUses)],
    ['已发布内容', compactMetric(summary?.publishedUses)],
    ['累计播放', summary?.metrics.available.includes('views') ? compactMetric(summary.metrics.views) : '—'],
  ];
  return (
    <section className="border-t border-border px-5 py-5" aria-labelledby="material-usage-history-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="material-usage-history-title" className="ls-type-title-small text-text-primary">使用次数与历史表现</h3>
          <p className="mt-1 ls-type-body-small text-text-muted">只统计已产出成品的真实使用；前三秒钩子单独追踪。</p>
        </div>
        {summary?.lastUsedAt ? <span className="ls-type-label-small text-text-muted">最近使用 {new Date(summary.lastUsedAt).toLocaleDateString('zh-CN')}</span> : null}
      </div>
      <dl className="mt-4 grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-surface sm:grid-cols-4">
        {stats.map(([label, value], index) => (
          <div key={label} className={`px-4 py-3 ${index % 2 === 1 ? 'border-l border-border' : ''} ${index > 1 ? 'border-t border-border' : ''} ${index > 0 ? 'sm:border-l sm:border-border' : ''} ${index > 1 ? 'sm:border-t-0' : ''}`}>
            <dt className="ls-type-label-small text-text-muted">{label}</dt>
            <dd className="mt-1 text-xl font-semibold text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
      {summary?.history.length ? (
        <div className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface" aria-label="素材使用历史">
          {summary.history.map(item => {
            const performanceParts = [
              item.metrics.available.includes('views') ? `${compactMetric(item.metrics.views)} 播放` : '',
              item.metrics.available.some(key => ['likes', 'comments', 'shares'].includes(key)) ? `${item.metrics.engagementRate}% 互动` : '',
              item.metrics.available.includes('leads') ? `${compactMetric(item.metrics.leads)} 条线索` : '',
            ].filter(Boolean);
            const performance = item.metricsStatus === 'synced'
              ? performanceParts.join(' · ')
              : item.metricsStatus === 'awaiting_sync' ? '已发布，等待平台数据回传' : '尚未发布';
            return (
              <article key={item.usageId} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <p className="truncate ls-type-label-medium text-text-primary">{item.contentTitle}</p>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 ls-type-label-small text-text-muted">
                    <span>{new Date(item.usedAt).toLocaleDateString('zh-CN')}</span>
                    {item.roles.map(role => <span key={`${item.usageId}-${role}`} className={role === 'three_second_hook' ? 'font-semibold text-accent' : ''}>{materialUsageRoleLabel(role)}</span>)}
                  </div>
                </div>
                <p className={`ls-type-label-small ${item.metricsStatus === 'synced' ? 'text-text-primary' : 'text-text-muted'}`}>{performance}</p>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-surface-2 px-4 py-8 text-center ls-type-body-small text-text-muted">这条素材还没有进入已完成的内容成品。</div>
      )}
    </section>
  );
}
