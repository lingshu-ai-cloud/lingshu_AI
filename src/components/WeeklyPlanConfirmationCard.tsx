import { Button } from 'antd';
import { ArrowLeft, Check, Loader2, Star } from 'lucide-react';

import type { ContentPlatform } from '../lib/digitalEmployees';

type WeeklyPlanConfirmationCardProps = {
  busy: boolean;
  videoCount: number;
  platformPlanCounts: Array<{ platform: Exclude<ContentPlatform, 'all'>; count: number }>;
  promotionPlanCount: number;
  promotionBudgetCny: number;
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
  onEdit,
  onConfirm,
}: WeeklyPlanConfirmationCardProps) {
  return (
    <section aria-label="周计划方案确认" className="rounded-lg border border-border bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg border border-border bg-surface-2 p-3 text-accent"><Star size={22} /></div>
          <div>
            <p className="text-xs font-semibold text-accent">第 2 步 · 确认本周方案</p>
            <h2 className="mt-1 text-xl font-semibold text-text-primary">确认后开始本周运营</h2>
          </div>
        </div>
        <span className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-secondary">内容积分按实际交付核算</span>
      </div>

      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <dt className="text-xs text-text-muted">预计制作积分</dt>
          <dd className="mt-2 text-lg font-semibold text-text-primary">待制作方案冻结</dd>
          <p className="mt-1 text-xs text-text-secondary">{videoCount} 条视频</p>
        </div>
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <dt className="text-xs text-text-muted">投流计划</dt>
          <dd className="mt-2 text-lg font-semibold text-text-primary">{money(promotionBudgetCny)}</dd>
          <p className="mt-1 text-xs text-text-secondary">{promotionPlanCount > 0 ? `${promotionPlanCount} 条内容` : '本周不投流'}</p>
        </div>
        <div className="rounded-lg border border-accent bg-white p-4">
          <dt className="text-xs text-text-secondary">发布平台</dt>
          <dd className="mt-2 text-lg font-semibold text-accent">{platformPlanCounts.filter(item => item.count > 0).length} 个</dd>
          <p className="mt-1 text-xs text-text-secondary">实际积分以成功交付的产品功能为准</p>
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
