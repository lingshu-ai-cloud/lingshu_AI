import { Button } from 'antd';
import { Check, Loader2, Target } from 'lucide-react';

import type { ContentPlatform, PublishingTarget, WeeklyGoal } from '../lib/digitalEmployees';
import WeeklyGoalScheduleCards from './smartBusiness/WeeklyGoalScheduleCards';

type WeeklyPlanConfirmationCardProps = {
  busy: boolean;
  businessLine: 'full_funnel' | 'content_growth' | 'customer_conversion';
  packageLabel: string;
  plans: NonNullable<WeeklyGoal['videoPlans']>;
  publishingTargets: PublishingTarget[];
  startsAt: string;
  endsAt: string;
  scope: string;
  objective: string;
  estimatedCostCny: number;
  platformPlanCounts: Array<{ platform: Exclude<ContentPlatform, 'all'>; count: number }>;
  targetPlatformCount: number;
  missingItems: string[];
  missingItemCount: number;
  hasValidationErrors: boolean;
  missingProduct: boolean;
  onOpenSettings?: () => void;
  onEdit: () => void;
  onConfirm: () => void;
};

const platformLabel: Record<Exclude<ContentPlatform, 'all'>, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

/**
 * Pure confirmation surface for the proposed weekly package. It deliberately
 * owns no API calls: the parent remains the single authority for validation,
 * idempotent confirmation and reconciliation after an uncertain response.
 */
export default function WeeklyPlanConfirmationCard({
  busy,
  businessLine,
  packageLabel,
  plans,
  publishingTargets,
  startsAt,
  endsAt,
  scope,
  objective,
  estimatedCostCny,
  platformPlanCounts,
  targetPlatformCount,
  missingItems,
  missingItemCount,
  hasValidationErrors,
  missingProduct,
  onOpenSettings,
  onEdit,
  onConfirm,
}: WeeklyPlanConfirmationCardProps) {
  const coveredPlatforms = platformPlanCounts.filter(item => item.count > 0).length;

  return (
    <section className="rounded-lg border border-border bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-emerald-50 p-3 text-emerald-700"><Target size={22} /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">本周任务确认</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">灵小枢已生成本周默认方案</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">产量由账号矩阵的逐平台周配额相加，确认后不会再从其他口径扩出不同数量。</p>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${hasValidationErrors ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {hasValidationErrors ? `需补 ${missingItemCount} 项` : '可直接确认'}
        </span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-[10px] font-bold text-slate-400">任务方案</p><p className="mt-1 text-sm font-semibold text-slate-900">{businessLine === 'customer_conversion' ? '客户转化任务' : packageLabel}</p></div>
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-[10px] font-bold text-slate-400">本周实际视频任务</p><p className="mt-1 text-sm font-semibold text-slate-900">{plans.length} 条</p><p className="mt-1 text-[9px] text-slate-400">等于下方各平台任务数之和</p></div>
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-[10px] font-bold text-slate-400">平台分配</p><p className="mt-1 text-sm font-semibold text-slate-900">{platformPlanCounts.map(item => `${platformLabel[item.platform]} ${item.count}`).join(' · ') || '待确认'}</p><p className="mt-1 text-[9px] text-slate-400">覆盖 {coveredPlatforms}/{targetPlatformCount} 个目标平台</p></div>
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-[10px] font-bold text-slate-400">业务范围</p><p className="mt-1 truncate text-sm font-semibold text-slate-900">{scope || '按企业默认市场'}</p></div>
        <div className="rounded-lg bg-slate-50 p-4"><p className="text-[10px] font-bold text-slate-400">预计成本</p><p className="mt-1 text-sm font-semibold text-slate-900">{estimatedCostCny > 0 ? `¥${estimatedCostCny.toFixed(2)}` : '待真实核算'}</p><p className="mt-1 text-[9px] text-slate-400">实际以服务费用回执为准</p></div>
      </div>
      <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/55 px-4 py-3"><p className="text-xs font-semibold text-emerald-950">本周重点结果</p><p className="mt-1 text-xs leading-5 text-emerald-800">{objective}</p></div>
      {businessLine !== 'customer_conversion' && <WeeklyGoalScheduleCards plans={plans} accounts={publishingTargets} startsAt={startsAt} endsAt={endsAt} onEdit={onEdit} />}
      {missingItems.length > 0 && <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"><p className="font-semibold">暂时不能确认，具体缺少：</p><ul className="mt-2 list-disc space-y-1 pl-4">{missingItems.map(item => <li key={item}>{item}</li>)}</ul>{missingProduct && onOpenSettings && <Button htmlType="button" onClick={onOpenSettings} className="!h-auto min-h-9 !whitespace-normal mt-3 rounded-lg bg-amber-900 px-3 py-2 text-[11px] font-semibold text-white">去 Agent 设置选择重点产品</Button>}</div>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button htmlType="button" onClick={onEdit} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">调整本周设置</Button>
        <Button type="primary" htmlType="button" disabled={busy} onClick={onConfirm} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold">{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}确认周计划</Button>
      </div>
    </section>
  );
}
