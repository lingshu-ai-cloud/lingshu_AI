import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Button, InputNumber, Segmented, Tag } from 'antd';
import { Calculator, Coins, DatabaseZap, RefreshCcw, ShieldCheck, WalletCards } from 'lucide-react';
import { authHeader } from '../../lib/auth';
import DeveloperUsageMonitor from './DeveloperUsageMonitor';

type CredentialState = 'configured' | 'missing' | 'tenant_scoped';
type ApiEstimate = {
  label: string;
  amount: number | null;
  currency: 'CNY' | 'USD';
  unit: string;
  source: string;
  internalCostPoints: number | null;
};
type PaidApi = {
  id: string;
  provider: string;
  api: string;
  productAreas: string[];
  capabilities: string[];
  billingUnits: string[];
  credentialState: CredentialState;
  credentialKeys: string[];
  pricingBasis: string;
  pricingEvidence: string;
  estimates: ApiEstimate[];
};
type PointSection = { id: string; label: string; description: string };
type PointRate = {
  id: string;
  section: string;
  feature: string;
  description: string;
  unit: 'second' | 'action' | 'item' | 'conversation' | 'document';
  points: number;
  billingMode?: 'metered' | 'plan_included' | 'free';
  note: string;
};
type EconomicsSnapshot = {
  generatedAt: string;
  access: 'platform_admin_only';
  rules: {
    customerPriceBookVersion: string;
    customerProductPointScale: number;
    internalCostPointsPerCny: number;
    providerCostFormula: string;
    customerSettlementFormula: string;
    separationRule: string;
  };
  summary: { paidApiCount: number; configuredCount: number; missingCount: number; tenantScopedCount: number };
  apis: PaidApi[];
  productPointSections: PointSection[];
  productPointRates: PointRate[];
  excludedCosts: string[];
};

const fmt = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
const pointUnit = (value: PointRate['unit']) => ({
  second: '每秒', action: '每次', item: '每项', conversation: '每轮', document: '每份',
}[value]);
const billingMode = (value?: PointRate['billingMode']) => ({
  plan_included: '套餐内', free: '免费', metered: '按量',
}[value || 'metered']);
const credentialLabel = (value: CredentialState) => ({
  configured: '服务端已配置', missing: '服务端未配置', tenant_scoped: '租户级配置',
}[value]);
const credentialColor = (value: CredentialState) => ({
  configured: 'success', missing: 'error', tenant_scoped: 'processing',
}[value]);

function MetricCard(props: { label: string; value: string; detail: string; icon: ReactNode }) {
  return (
    <article className="rounded-xl border border-border bg-white p-4">
      <div className="flex items-center justify-between text-text-muted"><span className="text-xs font-medium">{props.label}</span>{props.icon}</div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-text-primary">{props.value}</p>
      <p className="mt-1 text-xs leading-5 text-text-muted">{props.detail}</p>
    </article>
  );
}

export default function DeveloperApiEconomicsCenter() {
  const [section, setSection] = useState<'pricing' | 'usage'>(() =>
    new URLSearchParams(window.location.search).get('economicsSection') === 'usage' ? 'usage' : 'pricing');
  const [snapshot, setSnapshot] = useState<EconomicsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [usd, setUsd] = useState<number>(1);
  const [cnyPerUsd, setCnyPerUsd] = useState<number>(7.1);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/overseas/admin/api-economics?_=${Date.now()}`, {
        headers: authHeader(), cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '读取 API 成本与积分规则失败');
      setSnapshot(data as EconomicsSnapshot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取 API 成本与积分规则失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const changeSection = (value: 'pricing' | 'usage') => {
    const url = new URL(window.location.href);
    url.searchParams.set('economicsSection', value);
    window.history.replaceState({}, '', url);
    setSection(value);
  };

  const simulation = useMemo(() => {
    const cny = Math.max(0, Number(usd) || 0) * Math.max(0, Number(cnyPerUsd) || 0);
    const rate = snapshot?.rules.internalCostPointsPerCny ?? 1_000;
    return { cny, points: Math.ceil((cny * rate) - Number.EPSILON) };
  }, [usd, cnyPerUsd, snapshot]);

  const sectionPicker = <Segmented<'pricing' | 'usage'> value={section} onChange={changeSection} options={[
    { label: '价格和换算', value: 'pricing' },
    { label: '用户消耗监控', value: 'usage' },
  ]} />;

  if (section === 'usage') return <div className="mx-auto w-full max-w-[1500px] space-y-5">
    <section className="rounded-xl border border-border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-text-primary">API 与积分中台</h2><Tag color="blue">平台管理员</Tag></div><p className="mt-1 text-sm text-text-secondary">查看指定用户由供应商真实回执记录的输入、输出和缓存 token。</p></div>{sectionPicker}</div>
    </section>
    <DeveloperUsageMonitor />
  </div>;

  if (!snapshot && loading) return <div className="flex min-h-72 items-center justify-center text-sm text-text-muted">正在读取成本与积分规则…</div>;
  if (!snapshot) return <Alert type="error" showIcon title={error || '成本与积分规则不可用'} action={<Button onClick={() => void load()}>重试</Button>} />;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5">
      {error && <Alert type="warning" showIcon title={error} />}
      <section className="rounded-xl border border-border bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-text-primary">API 与积分中台</h2><Tag color="blue">平台管理员</Tag></div>
            <p className="mt-1 text-sm text-text-secondary">集中查看付费 API、成本换算、用户积分价格簿和结算边界。页面不展示任何密钥值。</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">{sectionPicker}<Button icon={<RefreshCcw size={15} />} loading={loading} onClick={() => void load()}>刷新配置状态</Button></div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="付费 API 能力" value={`${snapshot.summary.paidApiCount} 项`} detail="按能力与独立计费口径登记" icon={<DatabaseZap size={18} />} />
          <MetricCard label="服务端已配置" value={`${snapshot.summary.configuredCount} 项`} detail={`${snapshot.summary.missingCount} 项缺配置 · ${snapshot.summary.tenantScopedCount} 项租户配置`} icon={<ShieldCheck size={18} />} />
          <MetricCard label="内部成本积分" value={`¥1 = ${fmt(snapshot.rules.internalCostPointsPerCny)}`} detail="只用于成本、预算与毛利核算" icon={<Coins size={18} />} />
          <MetricCard label="用户产品积分" value={`${snapshot.rules.customerProductPointScale}×`} detail={snapshot.rules.customerPriceBookVersion} icon={<WalletCards size={18} />} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-xl border border-border bg-white p-5">
          <div className="flex items-center gap-2"><Calculator size={18} /><h3 className="text-sm font-semibold text-text-primary">统一换算链路</h3></div>
          <ol className="mt-4 grid gap-3 md:grid-cols-3">
            {[
              ['1', '供应商原始成本', '保留币种、计费单位、模型与原始回执。'],
              ['2', '审计汇率换算', '外币金额 × 有来源和时间的汇率 = 人民币成本。'],
              ['3', '内部成本积分', `人民币成本 × ${fmt(snapshot.rules.internalCostPointsPerCny)}，结果向上取整。`],
            ].map(([step, title, detail]) => <li key={step} className="rounded-lg bg-surface-2 p-4"><span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{step}</span><p className="mt-3 text-sm font-semibold text-text-primary">{title}</p><p className="mt-1 text-xs leading-5 text-text-muted">{detail}</p></li>)}
          </ol>
          <Alert className="mt-4" type="info" showIcon title="两本账严格隔离" description={snapshot.rules.separationRule} />
        </div>
        <div className="rounded-xl border border-border bg-white p-5">
          <h3 className="text-sm font-semibold text-text-primary">USD → CNY → 成本积分试算</h3>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-text-secondary">美元成本<InputNumber className="mt-1.5 w-full" min={0} precision={6} value={usd} onChange={value => setUsd(Number(value) || 0)} addonBefore="$" /></label>
            <label className="text-xs font-medium text-text-secondary">审计汇率<InputNumber className="mt-1.5 w-full" min={0} precision={6} value={cnyPerUsd} onChange={value => setCnyPerUsd(Number(value) || 0)} addonBefore="¥/$" /></label>
          </div>
          <div className="mt-4 rounded-lg border border-border bg-surface-2 p-4">
            <p className="text-xs text-text-muted">人民币成本</p><p className="mt-1 text-xl font-semibold text-text-primary">¥{fmt(simulation.cny)}</p>
            <div className="my-3 h-px bg-border" />
            <p className="text-xs text-text-muted">内部成本积分</p><p className="mt-1 text-2xl font-semibold text-primary">{fmt(simulation.points)}</p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-white">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border px-5 py-4">
          <div><h3 className="text-sm font-semibold text-text-primary">全系统付费 API 清单</h3><p className="mt-1 text-xs text-text-muted">“已配置”只表示凭据存在，不代表余额、配额或真实链路已经验收。</p></div>
          <span className="text-xs text-text-muted">更新于 {new Date(snapshot.generatedAt).toLocaleString('zh-CN', { hour12: false })}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1280px] w-full text-left text-xs">
            <thead className="bg-surface-2 text-text-muted"><tr><th className="px-4 py-3 font-semibold">供应商 / API</th><th className="px-4 py-3 font-semibold">产品与能力</th><th className="px-4 py-3 font-semibold">配置状态</th><th className="px-4 py-3 font-semibold">计费与价格证据</th><th className="px-4 py-3 font-semibold">成本积分估算</th></tr></thead>
            <tbody className="divide-y divide-border">
              {snapshot.apis.map(item => <tr key={item.id} className="align-top hover:bg-surface-2/60">
                <td className="px-4 py-4"><p className="font-semibold text-text-primary">{item.provider}</p><p className="mt-1 text-text-secondary">{item.api}</p><p className="mt-2 font-mono text-[10px] text-text-muted">{item.id}</p></td>
                <td className="px-4 py-4"><p className="text-text-secondary">{item.productAreas.join('、')}</p><p className="mt-2 text-text-muted">{item.capabilities.join(' · ')}</p></td>
                <td className="px-4 py-4"><Tag color={credentialColor(item.credentialState)}>{credentialLabel(item.credentialState)}</Tag><p className="mt-2 max-w-48 break-words font-mono text-[10px] leading-4 text-text-muted">{item.credentialKeys.join(' / ')}</p></td>
                <td className="px-4 py-4"><p className="font-medium text-text-primary">{item.pricingBasis}</p><p className="mt-1 max-w-md leading-5 text-text-muted">{item.pricingEvidence}</p><p className="mt-2 text-text-secondary">单位：{item.billingUnits.join('、')}</p></td>
                <td className="px-4 py-4">{item.estimates.map(row => <div key={`${row.label}-${row.unit}`} className="mb-2 last:mb-0"><p className="text-text-secondary">{row.label}</p><p className="font-semibold text-text-primary">{row.amount === null ? '按回执结算' : `${row.currency === 'CNY' ? '¥' : '$'}${fmt(row.amount)} / ${row.unit}`}</p>{row.internalCostPoints !== null && <p className="text-primary">≈ {fmt(row.internalCostPoints)} 成本积分 / {row.unit}</p>}<p className="text-[10px] leading-4 text-text-muted">{row.source}</p></div>)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-white">
        <div className="border-b border-border px-5 py-4"><h3 className="text-sm font-semibold text-text-primary">用户产品积分价格簿</h3><p className="mt-1 text-xs text-text-muted">按成功交付的产品结果计价；供应商、模型或内部重试不会改变用户价格。</p></div>
        <div className="grid gap-px bg-border lg:grid-cols-3">
          {snapshot.productPointSections.map(section => <article key={section.id} className="bg-white p-5"><p className="text-sm font-semibold text-text-primary">{section.label}</p><p className="mt-1 min-h-10 text-xs leading-5 text-text-muted">{section.description}</p><div className="mt-4 space-y-3">{snapshot.productPointRates.filter(rate => rate.section === section.id).map(rate => <div key={rate.id} className="rounded-lg bg-surface-2 p-3"><div className="flex items-start justify-between gap-3"><span className="font-medium text-text-primary">{rate.feature}</span><span className="whitespace-nowrap text-base font-semibold text-primary">{fmt(rate.points)}</span></div><div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-text-muted"><span>{billingMode(rate.billingMode)}</span><span>{pointUnit(rate.unit)}</span></div><p className="mt-2 text-[10px] leading-4 text-text-muted">{rate.note}</p></div>)}</div></article>)}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-white p-5"><h3 className="text-sm font-semibold text-text-primary">不计入付费 API 的项目</h3><ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-text-secondary">{snapshot.excludedCosts.map(item => <li key={item}>{item}</li>)}</ul></section>
    </div>
  );
}
