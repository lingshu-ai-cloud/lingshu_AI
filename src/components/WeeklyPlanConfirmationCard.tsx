import { Button } from 'antd';
import { ArrowLeft, Check, Loader2, WalletCards } from 'lucide-react';

import type { ContentPlatform } from '../lib/digitalEmployees';

type WeeklyPlanConfirmationCardProps = {
  busy: boolean;
  videoCount: number;
  platformPlanCounts: Array<{ platform: Exclude<ContentPlatform, 'all'>; count: number }>;
  promotionPlanCount: number;
  promotionBudgetCny: number;
  productionBudgetMinCny: number;
  productionBudgetMaxCny: number;
  onEdit: () => void;
  onConfirm: () => void;
};

const platformLabel: Record<Exclude<ContentPlatform, 'all'>, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
};

const money = (value: number) => `¥${value.toFixed(2)}`;

export default function WeeklyPlanConfirmationCard({
  busy,
  videoCount,
  platformPlanCounts,
  promotionPlanCount,
  promotionBudgetCny,
  productionBudgetMinCny,
  productionBudgetMaxCny,
  onEdit,
  onConfirm,
}: WeeklyPlanConfirmationCardProps) {
  const totalMin = productionBudgetMinCny + promotionBudgetCny;
  const totalMax = productionBudgetMaxCny + promotionBudgetCny;
  return (
    <section aria-label="费用参考与方案确认" className="rounded-lg border border-border bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg border border-border bg-surface-2 p-3 text-accent"><WalletCards size={22} /></div>
          <div>
            <p className="text-xs font-semibold text-accent">第 2 步 · 查看费用参考</p>
            <h2 className="mt-1 text-xl font-semibold text-text-primary">本周预计需要 {money(totalMin)}–{money(totalMax)}</h2>
          </div>
        </div>
        <span className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-secondary">制作费用为估算，不设用户预算上限</span>
      </div>

      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <dt className="text-xs text-text-muted">内容制作成本参考</dt>
          <dd className="mt-2 text-lg font-semibold text-text-primary">{money(productionBudgetMinCny)}–{money(productionBudgetMaxCny)}</dd>
          <p className="mt-1 text-xs text-text-secondary">{videoCount} 条视频</p>
        </div>
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <dt className="text-xs text-text-muted">投流计划</dt>
          <dd className="mt-2 text-lg font-semibold text-text-primary">{money(promotionBudgetCny)}</dd>
          <p className="mt-1 text-xs text-text-secondary">{promotionPlanCount > 0 ? `${promotionPlanCount} 条内容` : '本周不投流'}</p>
        </div>
        <div className="rounded-lg border border-accent bg-white p-4">
          <dt className="text-xs text-text-secondary">预计费用范围</dt>
          <dd className="mt-2 text-lg font-semibold text-accent">{money(totalMin)}–{money(totalMax)}</dd>
          <p className="mt-1 text-xs text-text-secondary">按实际供应商用量结算；区间不限制制作</p>
        </div>
      </dl>

      <div className="mt-4 rounded-lg border border-border px-4 py-3 text-sm leading-6 text-text-secondary">
        <p>{platformPlanCounts.filter(item => item.count > 0).map(item => `${platformLabel[item.platform]} ${item.count} 条`).join(' · ')}</p>
        <p className="mt-1 text-xs text-text-muted">确认后创建本周生产任务。投流预算仅用于广告投放，真实发布仍须通过账号授权和执行回执。</p>
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button htmlType="button" disabled={busy} icon={<ArrowLeft size={16} />} onClick={onEdit}>返回修改方案</Button>
        <Button type="primary" htmlType="button" disabled={busy} onClick={onConfirm} className="inline-flex items-center gap-2">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          确认方案并开始运营
        </Button>
      </div>
    </section>
  );
}
