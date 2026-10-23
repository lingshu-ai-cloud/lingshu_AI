import { useEffect, useState } from 'react';
import { Alert, Button, Empty, Modal, Skeleton, Tag } from 'antd';
import {
  BrainCircuit,
  CalendarClock,
  ChartNoAxesCombined,
  CheckCircle2,
  Film,
  Headphones,
  Megaphone,
  Search,
  Star,
} from 'lucide-react';
import {
  CURRENT_PRODUCT_POINT_RATES,
  PRODUCT_POINT_SECTIONS,
  type ProductPointSection,
} from '../../shared/pointsPolicy';
import type { AuthSession } from '../lib/auth';
import type { CustomerPointsSummary } from '../../shared/contracts/customerPoints';
import { customerPointsApi } from '../lib/customerPointsApi';
import { LsGradientProgress } from './ui/LsExperiencePrimitives';

const sectionIcon: Record<ProductPointSection, typeof Film> = {
  business_operations: ChartNoAxesCombined,
  insight_planning: Search,
  content_production: Film,
  traffic_growth: Megaphone,
  customer_service: Headphones,
  knowledge_assistant: BrainCircuit,
};

const PLAN_LABELS: Record<string, string> = {
  trial: '试用版',
  customer: '专业版',
  advanced_customer: '专业版',
  starter_198: '198 标准版',
  admin: '平台管理版',
};

const STATUS_LABELS: Record<string, { label: string; color?: string }> = {
  trialing: { label: '试用中', color: 'processing' },
  active: { label: '已订阅', color: 'success' },
  past_due: { label: '续费逾期', color: 'warning' },
  canceled: { label: '已取消' },
  expired: { label: '已过期', color: 'error' },
  none: { label: '未订阅' },
};

type SectionUsage = CustomerPointsSummary['sections'][number];

function displayDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function planName(session?: AuthSession | null): string {
  const raw = String(
    session?.productProfile === 'starter_198'
      ? 'starter_198'
      : session?.tenant?.subscriptionPlan || session?.subscription?.plan || session?.productProfile || '',
  ).toLowerCase();
  return PLAN_LABELS[raw] || (raw ? raw : '未配置套餐');
}

function PointsAmount({ value, suffix = '积分' }: { value: number; suffix?: string }) {
  return <span className="inline-flex items-center gap-1.5 tabular-nums">
    <Star size={14} className="shrink-0 text-amber-500" fill="currentColor" aria-hidden="true"/>
    <strong>{value.toLocaleString('zh-CN')}</strong>
    <span className="font-normal text-text-muted">{suffix}</span>
  </span>;
}

function UsageCard({ item, configured }: { item: SectionUsage; configured: boolean }) {
  const section = PRODUCT_POINT_SECTIONS.find(candidate => candidate.id === item.id);
  if (!section) return null;
  const Icon = sectionIcon[item.id];
  const rates = CURRENT_PRODUCT_POINT_RATES.filter(rate => rate.section === item.id);
  const percent = item.totalPoints > 0
    ? Math.min(100, Math.round(item.usedPoints / item.totalPoints * 100))
    : 0;

  return <article className="min-w-0 rounded-lg border border-border bg-surface p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2 text-text-primary">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
          <Icon size={16} aria-hidden="true"/>
        </span>
        <div>
          <h3 className="text-sm font-semibold">{section.label}</h3>
          <p className="mt-0.5 text-xs text-text-muted">本月积分 · 每月刷新</p>
        </div>
      </div>
      <p className="shrink-0 text-sm text-text-primary">
        {configured ? <PointsAmount value={item.usedPoints} suffix={`/ ${item.totalPoints.toLocaleString('zh-CN')} 积分`}/> : <span className="text-text-muted">额度未配置</span>}
      </p>
    </div>
    <LsGradientProgress
      className="mt-3"
      percent={percent}
      showInfo={false}
      size="small"
      aria-label={`${section.label}已使用 ${item.usedPoints}，共 ${item.totalPoints} 积分`}
    />
    <ul className="mt-4 grid gap-x-3 gap-y-2 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      {rates.map(rate => <li key={rate.id} className="flex min-w-0 items-start gap-2 text-xs leading-5 text-text-secondary">
        <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" aria-hidden="true"/>
        <span>{rate.feature}</span>
      </li>)}
    </ul>
  </article>;
}

function PlanAndUsage({
  session,
  summary,
  loading,
  error,
  onReload,
  onOpenPacks,
  onOpenPlans,
}: {
  session?: AuthSession | null;
  summary: CustomerPointsSummary | null;
  loading: boolean;
  error: string;
  onReload: () => void;
  onOpenPacks: () => void;
  onOpenPlans: () => void;
}) {
  const status = String(session?.tenant?.subscriptionStatus || session?.subscription?.status || 'none').toLowerCase();
  const statusView = STATUS_LABELS[status] || { label: status || '状态未知' };
  const expiresAt = displayDate(session?.tenant?.subscriptionExpiresAt || session?.subscription?.expiresAt);
  const usage = summary?.sections || PRODUCT_POINT_SECTIONS.map(section => ({ id: section.id, usedPoints: 0, totalPoints: 0, reservedPoints: 0, remainingPoints: 0 }));
  const usedPoints = summary?.plan?.usedPoints ?? 0;
  const totalPoints = summary?.plan?.totalPoints ?? 0;
  const planLabel = summary?.plan?.label || planName(session);
  const cycleEndsAt = displayDate(summary?.plan?.cycleEndsAt) || expiresAt;

  return <div className="space-y-6">
    <section aria-labelledby="points-plan-title" className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex flex-col gap-4 border-b border-border bg-surface-2 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-secondary">当前套餐</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 id="points-plan-title" className="text-xl font-semibold text-text-primary">{planLabel}</h2>
            <Tag color={statusView.color}>{statusView.label}</Tag>
            {summary?.configured ? <Tag color="success">真实账本</Tag> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-1 flex items-center gap-2 text-xs text-text-secondary">
            <CalendarClock size={15} aria-hidden="true"/>
            <span>{cycleEndsAt ? `本期额度至 ${cycleEndsAt}` : '当前套餐未设置积分周期'}</span>
          </div>
          <Button onClick={onOpenPacks}>购买加油包</Button>
          <Button type="primary" onClick={onOpenPlans}>查看全部套餐</Button>
        </div>
      </div>
      <dl className="grid gap-px bg-border sm:grid-cols-3">
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs text-text-muted">套餐状态</dt>
          <dd className="mt-1 text-sm font-semibold text-text-primary">{statusView.label}</dd>
        </div>
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs text-text-muted">本月套餐积分</dt>
          <dd className="mt-1 text-sm text-text-primary">
            {summary?.configured ? <PointsAmount value={usedPoints} suffix={`/ ${totalPoints.toLocaleString('zh-CN')} 积分`}/> : '—'}
          </dd>
        </div>
        <div className="bg-surface px-5 py-4">
          <dt className="text-xs text-text-muted">加油包积分</dt>
          <dd className="mt-1 text-sm text-text-primary">
            {summary?.configured ? <PointsAmount value={summary.addon.remainingPoints} suffix="可用积分"/> : '—'}
          </dd>
        </div>
      </dl>
    </section>

    {loading ? <Skeleton active paragraph={{ rows: 3 }}/> : error ? <Alert type="error" showIcon message="积分账户暂时无法读取" description={error} action={<Button size="small" onClick={onReload}>重试</Button>}/> : null}

    <section aria-labelledby="points-usage-title">
      <div className="border-b border-border pb-3">
        <h2 id="points-usage-title" className="text-base font-semibold text-text-primary">套餐内使用情况</h2>
        <p className="mt-1 text-xs text-text-secondary">按六大业务板块查看本月积分用量，以及当前套餐包含的全部功能。</p>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">{usage.map(item => <UsageCard key={item.id} item={item} configured={Boolean(summary?.configured)}/>)}</div>
    </section>
  </div>;
}

function PointPacksModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Modal
    open={open}
    onCancel={onClose}
    title="购买加油包"
    footer={<Button onClick={onClose}>关闭</Button>}
    width={720}
    centered
  >
    <p className="mb-4 text-sm text-text-secondary">加油包在套餐积分不足时使用，单积分价格高于套餐内积分；套餐额度会优先抵扣。</p>
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="加油包商品与支付尚未接入；这里不会展示虚构价格或余额"/>
  </Modal>;
}

function PlansModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Modal
    open={open}
    onCancel={onClose}
    title="全部套餐"
    footer={<Button onClick={onClose}>关闭</Button>}
    width={760}
    centered
  >
    <p className="mb-4 text-sm text-text-secondary">套餐包含按月刷新的固定积分额度；只有套餐外追加生产才会使用加油包。</p>
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="套餐商品与升级支付尚未接入；当前只展示已配置的真实套餐账户"/>
  </Modal>;
}

export default function PointsManagementDrawer({
  open,
  onClose,
  session,
}: {
  open: boolean;
  onClose: () => void;
  session?: AuthSession | null;
}) {
  const [secondaryModal, setSecondaryModal] = useState<'packs' | 'plans' | null>(null);
  const [summary, setSummary] = useState<CustomerPointsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError('');
    void customerPointsApi.summary()
      .then(result => { if (alive) setSummary(result); })
      .catch(cause => { if (alive) { setSummary(null); setError(cause instanceof Error ? cause.message : '积分账户读取失败'); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, reloadKey]);

  return <>
    <Modal
      open={open}
      onCancel={onClose}
      title={<span className="inline-flex items-center gap-2"><Star size={18} className="text-amber-500" fill="currentColor" aria-hidden="true"/>套餐与积分</span>}
      footer={null}
      width={1040}
      centered
      styles={{ body: { maxHeight: '78vh', overflowY: 'auto' } }}
    >
      <PlanAndUsage
        session={session}
        summary={summary}
        loading={loading}
        error={error}
        onReload={() => setReloadKey(value => value + 1)}
        onOpenPacks={() => setSecondaryModal('packs')}
        onOpenPlans={() => setSecondaryModal('plans')}
      />
    </Modal>
    <PointPacksModal open={secondaryModal === 'packs'} onClose={() => setSecondaryModal(null)}/>
    <PlansModal open={secondaryModal === 'plans'} onClose={() => setSecondaryModal(null)}/>
  </>;
}
