import { Button, Collapse, DatePicker, Empty, Tag } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { Activity, CheckCircle2, CircleDashed, CircleDollarSign, Clapperboard, MessageSquareText, Minus, Puzzle, RefreshCcw, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { smartBusinessShowcaseChannels } from '../../dev/smartBusinessShowcaseData';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { authHeader } from '../../lib/auth';
import { loadConnectedSocialPerformance } from '../../lib/socialPerformance';
import type { Page } from '../../pageRegistry';
import { SocialPlatformIcon } from '../SocialPlatformIcon';
import LsDataChart, { chartPalette } from '../ui/LsDataChart';
import { LsGradientProgress } from '../ui/LsExperiencePrimitives';
import { buildBusinessHealthModel, businessHealthStatus, healthCriterionCoverageStatus, summarizeHealthCriteria, type BusinessHealthDimension, type BusinessHealthSources, type HealthCriterion, type HealthCriterionCoverageStatus } from './businessHealthModel';
import type { AccountHealthResult } from './AccountHealthPanel';

const icons = { accounts: Users, inquiries: MessageSquareText, content: Clapperboard, advertising: CircleDollarSign };
const scoreLabel = (value: number | null) => value === null ? '待评估' : `${value} 分`;

export type BusinessHealthOverviewRange = { startsAt: string; endsAt: string };

type Props = {
  summaryOnly?: boolean;
  detailsOnly?: boolean;
  data: DigitalEmployeeOverview;
  selectedAccountId?: string;
  overviewRangeBusy?: boolean;
  onOverviewRangeChange?: (range: BusinessHealthOverviewRange) => void;
  onNavigate?: (page: Page) => void;
};

function readPerformanceWithDeadline() {
  return new Promise<Awaited<ReturnType<typeof loadConnectedSocialPerformance>>>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('账号表现同步超时')), 20_000);
    loadConnectedSocialPerformance().then(resolve, reject).finally(() => window.clearTimeout(timeout));
  });
}

function Criteria({ items }: { items: HealthCriterion[] }) {
  return <dl className="divide-y divide-border">
    {items.map(item => <div key={item.label} className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(140px,1fr)_minmax(0,2fr)]">
      <dt className="text-sm font-medium text-text-primary">{item.label}<span className="ml-2 font-normal tabular-nums text-text-secondary">{scoreLabel(item.score)}</span></dt>
      <dd className="min-w-0 text-xs leading-5 text-text-secondary"><strong className="block font-medium text-text-primary">{item.current}</strong>{item.basis}</dd>
    </div>)}
  </dl>;
}

const coverageStatusMeta: Record<HealthCriterionCoverageStatus, { label: string; className: string; tileClassName: string; icon: typeof CheckCircle2 }> = {
  scored: { label: '已评分', className: 'text-[var(--ls-success)]', tileClassName: 'border-[var(--ls-success)] bg-[var(--ls-success-bg)]', icon: CheckCircle2 },
  pending: { label: '待数据', className: 'text-[var(--ls-warning)]', tileClassName: 'border-dashed border-[var(--ls-warning)] bg-[var(--ls-warning-bg)]', icon: CircleDashed },
  not_applicable: { label: '不适用', className: 'text-text-muted', tileClassName: 'border-dashed border-border-bright bg-surface-2', icon: Minus },
};

function HealthCoveragePuzzleBoard({ dimensions }: { dimensions: BusinessHealthDimension[] }) {
  const dimensionCoverage = dimensions.map(dimension => ({ dimension, coverage: summarizeHealthCriteria(dimension.criteria) }));
  const totals = summarizeHealthCriteria(dimensions.flatMap(dimension => dimension.criteria));
  return <section aria-labelledby="criteria-map-title" aria-label="指标覆盖拼图">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 id="criteria-map-title" className="flex items-center gap-2 ls-type-title-small text-text-primary"><Puzzle size={17} className="text-accent" aria-hidden="true"/>指标覆盖图谱</h3><p className="mt-1 text-xs text-text-secondary">每块拼图代表一个真实评分口径，补齐程度不等于经营结果。</p></div>
      <span className="text-xs tabular-nums text-text-secondary">已补齐 <strong className="font-semibold text-text-primary">{totals.scored}/{totals.applicable}</strong> 个适用口径</span>
    </div>
    <div className="mt-3 flex flex-wrap gap-3 text-xs" aria-label="拼图状态图例">{(Object.keys(coverageStatusMeta) as HealthCriterionCoverageStatus[]).map(status => { const meta = coverageStatusMeta[status]; const Icon = meta.icon; return <span key={status} className={`inline-flex items-center gap-1 ${meta.className}`}><Icon size={14} aria-hidden="true"/>{meta.label}</span>; })}</div>
    <div className="mt-3 overflow-hidden rounded-lg border border-border bg-border">
      <div className="grid gap-px md:grid-cols-2">
        {dimensionCoverage.map(({ dimension, coverage }, dimensionIndex) => <section key={dimension.key} className="min-w-0 bg-white" aria-labelledby={`coverage-${dimension.key}`}>
          <header className="flex min-w-0 items-start justify-between gap-3 border-b border-border pb-3" style={{ borderInlineStart: `3px solid ${chartPalette[dimensionIndex]}`, paddingInlineStart: 10 }}><div><h4 id={`coverage-${dimension.key}`} className="text-sm font-semibold text-text-primary">{dimension.label}</h4><p className="mt-1 text-xs text-text-muted">覆盖 {coverage.scored}/{coverage.applicable} 个适用口径</p></div><span className="shrink-0 text-xs tabular-nums text-text-secondary">{scoreLabel(dimension.score)}</span></header>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label={`${dimension.label}口径拼图`}>
            {dimension.criteria.map(criterion => { const status = healthCriterionCoverageStatus(criterion); const meta = coverageStatusMeta[status]; const Icon = meta.icon; const hasScore = status === 'scored' && criterion.score !== null && Number.isFinite(criterion.score); return <li key={criterion.label} data-coverage-status={status} title={criterion.current} aria-label={`${dimension.label}，${criterion.label}，${meta.label}${hasScore ? `，${criterion.score} 分` : ''}`} className={`relative min-h-24 overflow-hidden rounded-md border p-3 transition-colors motion-reduce:transition-none ${meta.tileClassName}`}>
              <div className="flex items-start justify-between gap-2"><Icon size={17} className={`mt-0.5 shrink-0 ${meta.className}`} aria-hidden="true"/><span className={`text-xs font-medium ${meta.className}`}>{hasScore ? `${criterion.score} 分` : meta.label}</span></div>
              <p className="mt-3 text-sm font-semibold leading-5 text-text-primary">{criterion.label}</p>
              <span aria-hidden="true" className="absolute -bottom-3 -right-3 h-8 w-8 rounded-full border border-current opacity-10"/>
            </li>; })}
          </ul>
        </section>)}
      </div>
    </div>
  </section>;
}

function HealthCriteriaVisualization({ dimensions, selectedAccountId, generatedAt, accountLoadedAt }: {
  dimensions: BusinessHealthDimension[];
  selectedAccountId: string;
  generatedAt: string;
  accountLoadedAt?: string;
}) {
  const dimensionCoverage = dimensions.map(dimension => ({ dimension, coverage: summarizeHealthCriteria(dimension.criteria) }));
  const totals = summarizeHealthCriteria(dimensions.flatMap(dimension => dimension.criteria));
  const coverageValue = totals.coveragePercent;
  const chartSeries = [
    { label: '已评分', values: dimensionCoverage.map(item => item.coverage.scored), color: chartPalette[2] },
    { label: '待数据', values: dimensionCoverage.map(item => item.coverage.pending), color: chartPalette[3] },
    { label: '不适用', values: dimensionCoverage.map(item => item.coverage.notApplicable), color: '#A1A1AA' },
  ];

  return <div className="space-y-5 pb-4">
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-4" aria-label="评分口径覆盖摘要">
      <div className="min-w-0 bg-white p-3"><span className="text-xs text-text-secondary">已评分口径</span><p className="mt-1 flex items-baseline gap-1"><strong className="ls-type-metric text-success">{totals.scored}</strong><span className="text-xs text-text-muted">/ {totals.applicable} 个适用口径</span></p></div>
      <div className="min-w-0 bg-white p-3"><span className="text-xs text-text-secondary">待数据</span><p className="mt-1 flex items-baseline gap-1"><strong className="ls-type-metric text-warning">{totals.pending}</strong><span className="text-xs text-text-muted">项不参与当前得分</span></p></div>
      <div className="min-w-0 bg-white p-3"><span className="text-xs text-text-secondary">不适用</span><p className="mt-1 flex items-baseline gap-1"><strong className="ls-type-metric text-text-secondary">{totals.notApplicable}</strong><span className="text-xs text-text-muted">项已排除分母</span></p></div>
      <div className="min-w-0 bg-white p-3"><span className="text-xs text-text-secondary">证据覆盖率</span><p className="mt-1 flex items-baseline gap-1"><strong className="text-[32px] leading-10 font-semibold tabular-nums text-text-primary">{coverageValue ?? '—'}</strong><span className="text-xs text-text-muted">{coverageValue === null ? '' : '%'}</span></p>{coverageValue === null ? <p className="mt-1 text-xs text-text-muted">暂无适用口径</p> : <LsGradientProgress percent={coverageValue} showInfo={false} aria-label={`评分证据覆盖 ${totals.scored}/${totals.applicable} 项`}/>}</div>
    </div>

    <div className="grid min-w-0 border-y border-border lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
      <div className="min-w-0 border-b border-border py-4 lg:border-b-0 lg:border-r lg:pr-4">
        <LsDataChart title="四领域评分口径覆盖结构" kind="bar" horizontal stacked unit="项" labels={dimensions.map(item => item.label)} series={chartSeries} height={250} showDataTable={false}/>
      </div>
      <section className="min-w-0 py-4 lg:pl-4" aria-labelledby="domain-coverage-title">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 id="domain-coverage-title" className="ls-type-title-small text-text-primary">领域覆盖进度</h3><span className="text-xs tabular-nums text-text-muted">{totals.scored}/{totals.applicable} 项</span></div>
        <ul className="mt-2 divide-y divide-border">
          {dimensionCoverage.map(({ dimension, coverage }) => <li key={dimension.key} className="py-3">
            <div className="flex min-w-0 items-center justify-between gap-3"><span className="min-w-0 text-sm font-medium text-text-primary">{dimension.label}</span><span className="shrink-0 text-xs tabular-nums text-text-secondary">{coverage.scored}/{coverage.applicable} 已评分</span></div>
            {coverage.coveragePercent === null ? <p className="mt-2 text-xs text-text-muted">该领域暂无适用口径</p> : <LsGradientProgress percent={coverage.coveragePercent} showInfo={false} aria-label={`${dimension.label}评分覆盖 ${coverage.scored}/${coverage.applicable} 项`}/>}
            <p className="mt-1 text-xs text-text-muted">待数据 {coverage.pending} 项{coverage.notApplicable ? ` · 不适用 ${coverage.notApplicable} 项` : ''}</p>
          </li>)}
        </ul>
      </section>
    </div>

    <HealthCoveragePuzzleBoard dimensions={dimensions}/>

    <div className="border-l-2 border-accent pl-3 text-xs leading-5 text-text-secondary" role="note"><strong className="font-medium text-text-primary">计分规则</strong>：总经营分只对已评估领域等权平均；待数据不填 0、不补 100，不适用项排除分母。当前不包含收入或 ROI 判断。{selectedAccountId ? '当前筛选账号；缺少账号级归因的数据不以全公司数值代替。' : ''}</div>
    <Collapse ghost items={[{ key: 'basis', label: '查看完整计算口径', children: <div className="space-y-4">{dimensions.map(dimension => <section key={dimension.key}><h4 className="text-sm font-semibold text-text-primary">{dimension.label}</h4><Criteria items={dimension.criteria}/></section>)}</div> }]}/>
    <p className="text-xs text-text-muted">经营快照：{generatedAt ? new Date(generatedAt).toLocaleString('zh-CN') : '待同步'} · 账号同步：{accountLoadedAt ? new Date(accountLoadedAt).toLocaleString('zh-CN') : '待读取'}</p>
  </div>;
}

function AccountJourney({ account }: { account: AccountHealthResult }) {
  return <div className="space-y-4">
    <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={`${account.accountLabel} 阶段目标`}>
      {account.milestones.map((milestone, index) => <li key={milestone.label} className="min-w-0 border-l-2 border-border pl-3">
        <span className={`mb-1 flex items-center gap-1 text-xs font-medium ${milestone.complete ? 'text-success' : 'text-text-muted'}`}>{milestone.complete ? <CheckCircle2 size={14}/> : `${index + 1}.`}{milestone.complete ? '已达成' : '待达成'}</span>
        <p className="text-sm leading-5 text-text-primary">{milestone.label}</p>
      </li>)}
    </ol>
    <Criteria items={account.dimensions.map(dimension => ({ label: dimension.label, score: dimension.currentScore, current: `${dimension.currentLabel} · 目标：${dimension.targetLabel}`, basis: dimension.evidence }))}/>
    <div className="border-t border-border pt-3"><h4 className="text-sm font-semibold text-text-primary">用户动作建议</h4><ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-6 text-text-secondary">{(account.userActions.length ? account.userActions : ['当前无需额外补充，保持账号授权与承接渠道有效。']).map(action => <li key={action}>{action}</li>)}</ul></div>
  </div>;
}

export default function BusinessHealthOverview({ data, selectedAccountId = '', overviewRangeBusy = false, onOverviewRangeChange, onNavigate, summaryOnly = false, detailsOnly = false }: Props) {
  const [sources, setSources] = useState<BusinessHealthSources>({ performance: null, channelsLoaded: false, whatsappConnected: false, messengerPages: [] });
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    const showcase = smartBusinessShowcaseChannels(data);
    if (showcase) {
      setSources(showcase);
      setLoading(false);
      return;
    }
    const readJson = async (url: string) => {
      const response = await fetch(url, { headers: authHeader(), signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('承接渠道状态暂时无法读取');
      return response.json();
    };
    const results = await Promise.allSettled([
      readPerformanceWithDeadline(),
      readJson('/api/oauth/whatsapp/config'),
      readJson('/api/overseas/social/accounts?platform=facebook'),
    ]);
    if (id !== requestId.current) return;
    const [performance, whatsapp, messenger] = results;
    setSources(previous => ({
      performance: performance.status === 'fulfilled' ? performance.value.unavailable.length && previous.performance ? previous.performance : performance.value : previous.performance,
      // Failed reads remain unknown (or retain the last confirmed state), never disconnected.
      channelsLoaded: whatsapp.status === 'fulfilled' && messenger.status === 'fulfilled' || previous.channelsLoaded,
      whatsappConnected: whatsapp.status === 'fulfilled' ? whatsapp.value.connected === true : previous.whatsappConnected,
      messengerPages: messenger.status === 'fulfilled' && Array.isArray(messenger.value.items) ? messenger.value.items : previous.messengerPages,
    }));
    setLoading(false);
  }, [data]);
  const snapshotStartsAt = data.businessSnapshot?.range.startsAt || data.goal?.startsAt || '';
  const snapshotEndsAt = data.businessSnapshot?.range.endsAt || data.goal?.endsAt || '';
  useEffect(() => { void refresh(); return () => { requestId.current += 1; }; }, [refresh, snapshotStartsAt, snapshotEndsAt]);
  const model = useMemo(() => buildBusinessHealthModel(data, sources, selectedAccountId), [data, sources, selectedAccountId]);
  const rangeValue = useMemo<[Dayjs, Dayjs] | null>(() => model.startsAt && model.endsAt
    ? [dayjs(model.startsAt), dayjs(model.endsAt)]
    : null, [model.endsAt, model.startsAt]);
  return <div className="space-y-6">
    {!detailsOnly && <section className="overflow-hidden rounded-lg border border-border bg-white" aria-labelledby="business-health-title">
      <header className="flex flex-wrap items-start justify-between gap-3 px-6 pb-4 pt-5 xl:min-h-[112px]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-full min-w-0"><h2 id="business-health-title" className="break-words text-xl leading-8 font-semibold text-text-primary">{data.config?.companyName?.trim() || '企业名称待完善'}</h2></div>{summaryOnly && <div className="flex items-baseline gap-2"><span className="text-sm text-text-secondary">企业经营分</span><strong className="text-[32px] font-semibold tabular-nums text-accent">{model.totalScore ?? '—'}</strong><span className="text-xs text-text-muted">/ 100 · {model.scoreCoverage}/4 领域已评估</span></div>}
          {!summaryOnly && <><DatePicker.RangePicker
            aria-label="经营健康统计时间段"
            value={rangeValue}
            allowClear={false}
            disabled={!onOverviewRangeChange || overviewRangeBusy}
            format="YYYY-MM-DD"
            placeholder={['开始日期', '结束日期']}
            onChange={dates => {
              if (!dates?.[0] || !dates[1] || !onOverviewRangeChange) return;
              onOverviewRangeChange({ startsAt: dates[0].format('YYYY-MM-DD'), endsAt: dates[1].format('YYYY-MM-DD') });
            }}
          />
          <span className="text-xs text-text-muted">北京时间 · {data.businessSnapshot?.range.timeZone || 'Asia/Shanghai'}</span></>}
        </div>
        {!summaryOnly && <Button icon={<RefreshCcw size={14}/>} loading={loading || overviewRangeBusy} onClick={() => void refresh()}>同步健康度</Button>}
      </header>
      <div className="grid grid-cols-2 auto-rows-[112px] gap-x-6 gap-y-6 bg-white px-6 pb-6 pt-3" aria-label="经营健康指标">
        {!summaryOnly && <div className="col-span-2 min-w-0 bg-white">
          <h3 className="flex items-center gap-2 text-base leading-6 font-normal text-text-secondary"><Activity size={16} className="text-accent"/>企业经营分 <span className="text-xs">已评估项</span></h3>
          <p className="mt-3 flex items-baseline gap-1"><strong className="text-[32px] leading-10 font-semibold tabular-nums text-text-primary">{model.totalScore ?? '—'}</strong><span className="text-xs text-text-muted">/ 100</span></p>
          <p className="mt-2 text-xs text-text-secondary">{model.scoreCoverage}/4 个领域 · {model.scoreCoverage < 4 ? '待完整评估' : '已覆盖全领域'}</p>
        </div>}
        {model.dimensions.map((dimension, index) => { const Icon = icons[dimension.key]; return <div key={dimension.key} className="min-w-0 bg-white">
          <h3 className="flex items-center gap-2 text-base leading-6 font-normal text-text-secondary"><Icon size={16} style={{ color: chartPalette[index] }}/>{dimension.label}</h3>
          <p className="mt-3 flex items-baseline gap-1"><strong className="text-[28px] leading-9 font-semibold tabular-nums text-text-primary">{dimension.score ?? '—'}</strong><span className="text-xs text-text-muted">/ 100</span></p>
          <p className="mt-2 text-xs text-text-secondary">{businessHealthStatus(dimension.score, dimension.criteria.filter(item => item.score !== null).length, dimension.criteria.length)} · {dimension.criteria.filter(item => item.score !== null).length}/{dimension.criteria.length} 项已评估</p>
        </div>; })}
      </div>
      {!summaryOnly && <div className="border-t border-border px-3"><Collapse ghost items={[{ key: 'method', label: '评分口径与数据覆盖', children: <HealthCriteriaVisualization dimensions={model.dimensions} selectedAccountId={selectedAccountId} generatedAt={model.generatedAt} accountLoadedAt={sources.performance?.loadedAt}/> }]}/></div>}
    </section>}

    {!summaryOnly && <section className="overflow-hidden rounded-lg border border-border bg-white" aria-labelledby="account-growth-title">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3"><h2 id="account-growth-title" className="ls-type-title-medium text-text-primary">账号健康与阶段目标</h2><span className="text-xs text-text-muted">{model.accountHealth.length} 个真实配置账号 · 目标来自账号自身</span></header>
      {!model.accountHealth.length ? <div className="p-4"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置经营账号">{onNavigate && <Button onClick={() => onNavigate('socialAccounts')}>配置账号</Button>}</Empty></div> : <>
        <div className="border-t border-border px-3"><Collapse ghost items={model.accountHealth.map(account => ({ key: `${account.platform}:${account.accountId}`, label: <div className="min-w-0 space-y-3 pr-1"><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><SocialPlatformIcon platform={account.platform} size={18}/><strong className="text-sm font-medium text-text-primary">{account.accountLabel}</strong></span><span className="flex items-center gap-2"><strong className="text-sm tabular-nums text-text-primary">{scoreLabel(account.currentScore)}</strong><Tag>{account.scoreCoverage}/{account.dimensions.length} 项已评估</Tag></span></div><div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">{account.currentScore === null ? <span className="text-xs text-text-muted">等待可核验的账号数据</span> : <LsGradientProgress percent={account.currentScore} showInfo={false} aria-label={`${account.accountLabel} 当前 ${scoreLabel(account.currentScore)}`}/>}<span className="text-xs text-text-muted">{account.milestones.filter(item => item.complete).length}/{account.milestones.length} 个阶段目标已达成</span></div></div>, children: <AccountJourney account={account}/> }))}/></div>
      </>}
    </section>}
    {detailsOnly && <section className="rounded-lg border border-border px-3"><Collapse ghost items={[{ key: 'method', label: '评分口径与数据覆盖', children: <HealthCriteriaVisualization dimensions={model.dimensions} selectedAccountId={selectedAccountId} generatedAt={model.generatedAt} accountLoadedAt={sources.performance?.loadedAt}/> }]}/></section>}
  </div>;
}
