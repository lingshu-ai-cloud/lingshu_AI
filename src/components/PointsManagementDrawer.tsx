import { useState } from 'react';
import { Button, Empty, Modal, Tag } from 'antd';
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

type SectionUsage = {
  id: ProductPointSection;
  usedPoints: number;
  totalPoints: number;
};

const MOCK_SECTION_USAGE: SectionUsage[] = [
  { id: 'business_operations', usedPoints: 420, totalPoints: 1_000 },
  { id: 'insight_planning', usedPoints: 680, totalPoints: 1_200 },
  { id: 'content_production', usedPoints: 2_580, totalPoints: 5_000 },
  { id: 'traffic_growth', usedPoints: 260, totalPoints: 800 },
  { id: 'customer_service', usedPoints: 340, totalPoints: 800 },
  { id: 'knowledge_assistant', usedPoints: 220, totalPoints: 700 },
];

const MOCK_ADDON_POINTS = 2_400;

const MOCK_POINT_PACKS = [
  { points: 1_000, label: '轻量加油包', note: '适合临时补充图片与策划任务' },
  { points: 3_000, label: '活动加油包', note: '适合一次完整的活动内容生产' },
  { points: 8_000, label: '集中生产包', note: '适合多条视频并行生产' },
] as const;

const MOCK_PLANS = [
  { id: 'trial', label: '试用版', points: '500', note: '体验基础策划与内容能力' },
  { id: 'professional', label: '专业版', points: '9,500', note: '适合稳定的月度内容生产', current: true },
  { id: 'enterprise', label: '企业版', points: '30,000', note: '适合团队协作与规模化生产' },
] as const;

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

function UsageCard({ item }: { item: SectionUsage }) {
  const section = PRODUCT_POINT_SECTIONS.find(candidate => candidate.id === item.id);
  if (!section) return null;
  const Icon = sectionIcon[item.id];
  const rates = CURRENT_PRODUCT_POINT_RATES.filter(rate => rate.section === item.id);
  const percent = item.totalPoints > 0
    ? Math.min(100, Math.round(item.usedPoints / item.totalPoints * 100))
    : 0;

  return <article className="min-w-0 rounded-lg border border-border bg-white p-4">
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
        <PointsAmount value={item.usedPoints} suffix={`/ ${item.totalPoints.toLocaleString('zh-CN')} 积分`}/>
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
  onOpenPacks,
  onOpenPlans,
}: {
  session?: AuthSession | null;
  onOpenPacks: () => void;
  onOpenPlans: () => void;
}) {
  const status = String(session?.tenant?.subscriptionStatus || session?.subscription?.status || 'none').toLowerCase();
  const statusView = STATUS_LABELS[status] || { label: status || '状态未知' };
  const expiresAt = displayDate(session?.tenant?.subscriptionExpiresAt || session?.subscription?.expiresAt);
  const showMock = import.meta.env.DEV;
  const usage = showMock ? MOCK_SECTION_USAGE : [];
  const usedPoints = usage.reduce((sum, item) => sum + item.usedPoints, 0);
  const totalPoints = usage.reduce((sum, item) => sum + item.totalPoints, 0);

  return <div className="space-y-6">
    <section aria-labelledby="points-plan-title" className="overflow-hidden rounded-lg border border-border bg-white">
      <div className="flex flex-col gap-4 border-b border-border bg-surface-2 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-secondary">当前套餐</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 id="points-plan-title" className="text-xl font-semibold text-text-primary">{planName(session)}</h2>
            <Tag color={statusView.color}>{statusView.label}</Tag>
            {showMock ? <Tag color="warning">界面示意</Tag> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-1 flex items-center gap-2 text-xs text-text-secondary">
            <CalendarClock size={15} aria-hidden="true"/>
            <span>{expiresAt ? `有效期至 ${expiresAt}` : '当前套餐未设置到期时间'}</span>
          </div>
          <Button onClick={onOpenPacks}>购买加油包</Button>
          <Button type="primary" onClick={onOpenPlans}>查看全部套餐</Button>
        </div>
      </div>
      <dl className="grid gap-px bg-border sm:grid-cols-3">
        <div className="bg-white px-5 py-4">
          <dt className="text-xs text-text-muted">套餐状态</dt>
          <dd className="mt-1 text-sm font-semibold text-text-primary">{statusView.label}</dd>
        </div>
        <div className="bg-white px-5 py-4">
          <dt className="text-xs text-text-muted">本月套餐积分</dt>
          <dd className="mt-1 text-sm text-text-primary">
            {usage.length ? <PointsAmount value={usedPoints} suffix={`/ ${totalPoints.toLocaleString('zh-CN')} 积分`}/> : '—'}
          </dd>
        </div>
        <div className="bg-white px-5 py-4">
          <dt className="text-xs text-text-muted">加油包积分</dt>
          <dd className="mt-1 text-sm text-text-primary">
            {showMock ? <PointsAmount value={MOCK_ADDON_POINTS}/> : '—'}
          </dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="points-usage-title">
      <div className="border-b border-border pb-3">
        <h2 id="points-usage-title" className="text-base font-semibold text-text-primary">套餐内使用情况</h2>
        <p className="mt-1 text-xs text-text-secondary">按六大业务板块查看本月积分用量，以及当前套餐包含的全部功能。</p>
      </div>
      {usage.length
        ? <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">{usage.map(item => <UsageCard key={item.id} item={item}/>)}</div>
        : <Empty className="my-6" image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前套餐尚未返回可核验的积分额度"/>}
    </section>
  </div>;
}

function PointPacksModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Modal
    open={open}
    onCancel={onClose}
    title={<span className="inline-flex items-center gap-2">购买加油包 <Tag color="warning">界面示意</Tag></span>}
    footer={<Button onClick={onClose}>关闭</Button>}
    width={720}
    centered
  >
    <p className="mb-4 text-sm text-text-secondary">套餐积分不够时，可单独补充；加油包积分不会覆盖套餐内额度。</p>
    <div className="grid gap-3 sm:grid-cols-3">
      {MOCK_POINT_PACKS.map(pack => <article key={pack.points} className="rounded-lg border border-border bg-white p-4">
        <p className="text-sm font-semibold text-text-primary">{pack.label}</p>
        <p className="mt-3 text-xl text-text-primary"><PointsAmount value={pack.points}/></p>
        <p className="mt-2 min-h-10 text-xs leading-5 text-text-secondary">{pack.note}</p>
        <Button className="mt-4" block disabled title="当前为界面示意，购买流程尚未接入">购买此加油包</Button>
      </article>)}
    </div>
    <p className="mt-4 text-xs text-text-muted">当前仅预览套餐结构，尚未接入支付，不会产生扣款。</p>
  </Modal>;
}

function PlansModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Modal
    open={open}
    onCancel={onClose}
    title={<span className="inline-flex items-center gap-2">全部套餐 <Tag color="warning">界面示意</Tag></span>}
    footer={<Button onClick={onClose}>关闭</Button>}
    width={760}
    centered
  >
    <p className="mb-4 text-sm text-text-secondary">不同套餐使用同一套功能口径，以每月可用积分和团队生产规模区分。</p>
    <div className="grid gap-3 sm:grid-cols-3">
      {MOCK_PLANS.map(plan => <article key={plan.id} className={`rounded-lg border p-4 ${plan.current ? 'border-primary bg-primary-soft' : 'border-border bg-white'}`}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text-primary">{plan.label}</h3>
          {plan.current ? <Tag color="success">当前套餐</Tag> : null}
        </div>
        <p className="mt-3 text-xl text-text-primary"><PointsAmount value={Number(plan.points.replace(',', ''))} suffix="积分/月"/></p>
        <p className="mt-2 min-h-10 text-xs leading-5 text-text-secondary">{plan.note}</p>
        <Button className="mt-4" block type={plan.current ? 'default' : 'primary'} disabled title="当前为界面示意，升级流程尚未接入">
          {plan.current ? '已订阅' : '升级套餐'}
        </Button>
      </article>)}
    </div>
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
        onOpenPacks={() => setSecondaryModal('packs')}
        onOpenPlans={() => setSecondaryModal('plans')}
      />
    </Modal>
    <PointPacksModal open={secondaryModal === 'packs'} onClose={() => setSecondaryModal(null)}/>
    <PlansModal open={secondaryModal === 'plans'} onClose={() => setSecondaryModal(null)}/>
  </>;
}
