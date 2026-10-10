import { Button, Select } from 'antd';
import { ArrowUpRight, RefreshCcw } from 'lucide-react';
import type { VideoCreationPlan } from '../../lib/videoCreationPlan';
import { thumbnailUrlWithSourceFallback } from '../../lib/calendarModel';
import { LsCalendar, calendarDayKey, type LsCalendarEvent } from '../ui/LsCalendar';

type PublishingAccount = { accountId: string; accountLabel: string; platform: string };
type ProductOption = { id: string; name: string; materialIds: string[] };
type Props = {
  startsAt: string;
  endsAt: string;
  plans: VideoCreationPlan[];
  masterPlans: VideoCreationPlan[];
  accounts: PublishingAccount[];
  products: ProductOption[];
  busy?: boolean;
  onChangeProduct: (masterIndex: number, productName: string) => void;
  onOpenReference: (plan: VideoCreationPlan) => void;
  onRefreshReferences?: () => void;
};

function familyKey(plan: VideoCreationPlan) { return plan.contentFamilyId || plan.contentId; }
function referenceThumbnail(plan: VideoCreationPlan) {
  const thumbnailUrl = plan.preproduction?.benchmark.thumbnailUrl || plan.planningEvidence?.referenceThumbnailUrl || '';
  const sourceUrl = plan.preproduction?.benchmark.sourceUrl || plan.planningEvidence?.referenceSourceUrl || '';
  return thumbnailUrlWithSourceFallback(thumbnailUrl, sourceUrl);
}

export default function WeeklyPlanCalendar({ startsAt, endsAt, plans, masterPlans, accounts, products, busy, onChangeProduct, onOpenReference, onRefreshReferences }: Props) {
  const mastersByFamily = new Map(masterPlans.map(plan => [familyKey(plan), plan]));
  const accountById = new Map(accounts.map(account => [account.accountId, account]));
  const missingReferences = masterPlans.filter(plan => !plan.referenceId).length;
  const selectedProducts = [...new Set(masterPlans.map(plan => plan.productName).filter(Boolean))];
  const events: LsCalendarEvent[] = plans.map((plan, index) => {
    const master = mastersByFamily.get(familyKey(plan)) || plan;
    const account = accountById.get(plan.matrix?.accountId || '') || accounts.find(item => item.platform === plan.platform);
    return {
      id: plan.contentId || `weekly-plan-${index}`, title: plan.publication?.title || plan.theme,
      start: plan.plannedPublishDate || startsAt || calendarDayKey(new Date()), allDay: true,
      timeZone: 'Asia/Shanghai', eventType: 'content', status: master.referenceId ? 'planned' : 'needs_action',
      statusLabel: master.referenceId ? '待制作' : '待补爆款',
      accountId: account?.accountId, accountName: account?.accountLabel || '待绑定账号', platform: plan.platform,
      thumbnailUrl: referenceThumbnail(master), sourceId: master.referenceId,
      ownerAgent: '内容 Agent', costEstimate: master.estimatedCost,
      description: `${master.productName || '待选择产品'} · ${plan.productionRole === 'platform_adaptation' ? '平台适配' : '原创母版'}`,
      data: { plan, master },
    };
  });
  return <section aria-label="本周发布日历" className="overflow-hidden rounded-lg border border-border bg-white">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
      <div><h3 className="text-base font-semibold text-text-primary">本周发布日历</h3><p className="mt-1 text-xs text-text-secondary">{plans.length} 条内容 · {startsAt} 至 {endsAt} · 点击事件查看排期与对应爆款</p></div>
      {missingReferences > 0 && onRefreshReferences && <Button disabled={busy} icon={<RefreshCcw size={14}/>} onClick={onRefreshReferences}>补齐 {missingReferences} 条爆款</Button>}
    </header>
    <details className="border-b border-border bg-surface-2">
      <summary className="cursor-pointer px-4 py-3 text-sm text-text-secondary">制作产品：{selectedProducts.join('、') || '待选择'} · 调整母版产品</summary>
      <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2 lg:grid-cols-3">
        {masterPlans.map((plan, index) => <label key={familyKey(plan) || index} className="min-w-0 text-xs text-text-secondary">母版 {index + 1}
          <Select className="mt-1 w-full" aria-label={`母版 ${index + 1} 的产品`} value={plan.productName || undefined} disabled={busy} placeholder="请选择产品" onChange={value => onChangeProduct(index, value)} options={products.map(product => ({ value: product.name, label: `${product.name} · ${product.materialIds.length} 项素材` }))}/>
        </label>)}
      </div>
    </details>
    <LsCalendar events={events} initialDate={startsAt} date={startsAt} initialView="timeGridWeek" loading={busy} label="本周发布日历" renderDetails={(event, closeDetails) => {
      const { plan, master } = event.data as { plan: VideoCreationPlan; master: VideoCreationPlan };
      const canOpen = Boolean(master.referenceId || master.planningEvidence?.referenceSourceUrl || master.preproduction?.benchmark.sourceUrl);
      return <div className="space-y-4">
        <dl className="ls-calendar-details"><div><dt>产品</dt><dd>{master.productName || '待选择产品'}</dd></div><div><dt>成片时长</dt><dd>{plan.duration} 秒</dd></div><div><dt>爆款参考</dt><dd>{master.planningEvidence?.referenceTitle || '等待补齐'}</dd></div><div><dt>发布文案</dt><dd className="whitespace-pre-wrap">{plan.publication?.caption || '尚未生成'}</dd></div></dl>
        <Button type="primary" disabled={!canOpen} icon={<ArrowUpRight size={14}/>} onClick={() => { closeDetails(); onOpenReference(master); }}>{canOpen ? '查看对应爆款详情' : '待补爆款详情'}</Button>
      </div>;
    }}/>
  </section>;
}
