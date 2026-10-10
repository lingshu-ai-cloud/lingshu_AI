import { Alert, Button, Collapse, Empty, Tag } from 'antd';
import { Activity, ArrowRight, CheckCircle2, CircleDollarSign, Clapperboard, MessageSquareText, RefreshCcw, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { authHeader } from '../../lib/auth';
import { loadConnectedSocialPerformance } from '../../lib/socialPerformance';
import type { Page } from '../../pageRegistry';
import { SocialPlatformIcon } from '../SocialPlatformIcon';
import LsDataChart, { chartPalette } from '../ui/LsDataChart';
import { LsGradientProgress } from '../ui/LsExperiencePrimitives';
import { buildBusinessHealthModel, businessHealthStatus, type BusinessHealthSources, type HealthCriterion } from './businessHealthModel';
import type { AccountHealthResult } from './AccountHealthPanel';

const icons = { accounts: Users, inquiries: MessageSquareText, content: Clapperboard, advertising: CircleDollarSign };
const platformLabels = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };
const scoreLabel = (value: number | null) => value === null ? '待评估' : `${value} 分`;

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

export default function BusinessHealthOverview({ data, selectedAccountId = '', onNavigate }: { data: DigitalEmployeeOverview; selectedAccountId?: string; onNavigate?: (page: Page) => void }) {
  const [sources, setSources] = useState<BusinessHealthSources>({ performance: null, channelsLoaded: false, whatsappConnected: false, messengerPages: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const refresh = async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
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
    const failedSources = results.flatMap((result, index) => result.status === 'rejected' ? [['账号表现同步', 'WhatsApp 承接状态', 'Messenger 承接状态'][index]] : []);
    if (performance.status === 'fulfilled') {
      failedSources.push(...performance.value.unavailable.map(item => item.accountId
        ? `${platformLabels[item.platform]} · ${performance.value.accounts.find(account => account.id === item.accountId)?.title || '账号内容'}`
        : item.platform === 'facebook' ? '社媒账号（TikTok / Instagram / Facebook）' : `${platformLabels[item.platform]} 账号`));
    }
    if (failedSources.length) setError(`${[...new Set(failedSources)].join('、')}暂不可用，已保留上次确认结果；缺失项不计作 0 分。`);
    setLoading(false);
  };
  useEffect(() => { void refresh(); return () => { requestId.current += 1; }; }, []);
  const model = useMemo(() => buildBusinessHealthModel(data, sources, selectedAccountId), [data, sources, selectedAccountId]);
  const knownCriteria = model.dimensions.reduce((sum, dimension) => sum + dimension.criteria.filter(item => item.score !== null).length, 0);
  const allCriteria = model.dimensions.reduce((sum, dimension) => sum + dimension.criteria.length, 0);
  const prioritized = [...model.dimensions].sort((a, b) => (a.score ?? -1) - (b.score ?? -1));

  return <div className="space-y-6">
    <section className="overflow-hidden rounded-lg border border-border bg-white" aria-labelledby="business-health-title">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-3"><h2 id="business-health-title" className="ls-type-title-medium text-text-primary">经营资产健康度</h2><span className="text-xs text-text-muted">{model.startsAt.slice(0, 10) || '当前'} — {model.endsAt.slice(0, 10) || '当前'} · {data.businessSnapshot?.range.timeZone || 'Asia/Shanghai'}</span></div>
        <Button icon={<RefreshCcw size={14}/>} loading={loading} onClick={() => void refresh()}>同步健康度</Button>
      </header>
      {error && <div className="px-4 pt-4"><Alert showIcon type="warning" title={error}/></div>}
      <div className="grid grid-cols-2 gap-px bg-border xl:grid-cols-5" aria-label="经营健康指标">
        <div className="col-span-2 min-w-0 bg-white p-4 xl:col-span-1">
          <h3 className="flex items-center gap-2 text-sm text-text-secondary"><Activity size={16} className="text-accent"/>总经营分 <span className="text-xs">已评估项</span></h3>
          <p className="mt-2 flex items-baseline gap-1"><strong className="ls-type-metric text-accent">{model.totalScore ?? '—'}</strong><span className="text-xs text-text-muted">/ 100</span></p>
          <p className="mt-2 text-xs text-text-secondary">{model.scoreCoverage}/4 个领域 · {model.scoreCoverage < 4 ? '待完整评估' : '已覆盖全领域'}</p>
        </div>
        {model.dimensions.map((dimension, index) => { const Icon = icons[dimension.key]; return <div key={dimension.key} className="min-w-0 bg-white p-4">
          <h3 className="flex items-center gap-2 text-sm text-text-secondary"><Icon size={16} style={{ color: chartPalette[index] }}/>{dimension.label}</h3>
          <p className="mt-2 flex items-baseline gap-1"><strong className="ls-type-metric" style={{ color: chartPalette[index] }}>{dimension.score ?? '—'}</strong><span className="text-xs text-text-muted">/ 100</span></p>
          <p className="mt-2 text-xs text-text-secondary">{businessHealthStatus(dimension.score, dimension.criteria.filter(item => item.score !== null).length, dimension.criteria.length)} · {dimension.criteria.filter(item => item.score !== null).length}/{dimension.criteria.length} 项已评估</p>
        </div>; })}
      </div>
      <div className="grid border-t border-border lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 border-b border-border p-4 lg:border-b-0 lg:border-r"><LsDataChart title="经营健康度与完善目标" unit="分" percent horizontal kind="bar" labels={model.dimensions.map(item => item.label)} series={[{ label: '当前已评估得分', values: model.dimensions.map(item => item.score), color: chartPalette[0] }, { label: '完善目标', values: model.dimensions.map(item => item.score === null ? null : 100), color: chartPalette[2] }]} height={260}/></div>
        <section className="min-w-0 p-4" aria-labelledby="health-actions-title"><div className="flex flex-wrap items-center justify-between gap-2"><h3 id="health-actions-title" className="ls-type-title-small text-text-primary">优先补齐</h3><span className="text-xs text-text-muted">数据覆盖 {knownCriteria}/{allCriteria} 项</span></div>
          <ol className="mt-3 divide-y divide-border">{prioritized.map((dimension, index) => <li key={dimension.key} className="flex min-w-0 items-start gap-3 py-3"><span className="pt-0.5 text-xs tabular-nums text-text-muted">0{index + 1}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium text-text-primary">{dimension.label}<span className="ml-2 text-xs font-normal text-text-secondary">{scoreLabel(dimension.score)}</span></p><p className="mt-1 text-xs leading-5 text-text-secondary">{dimension.action}</p></div>{onNavigate && <Button type="text" aria-label={dimension.action} icon={<ArrowRight size={16}/>} onClick={() => onNavigate(dimension.page)}/>}</li>)}</ol>
        </section>
      </div>
      <div className="border-t border-border px-3"><Collapse ghost items={[{ key: 'method', label: '评分口径与数据覆盖', children: <div className="space-y-4"><p className="text-sm leading-6 text-text-secondary">总经营分为已评估领域的等权平均；缺失领域不填 0，也不补 100。各领域只计算有分母、有证据的指标，当前不包含收入或 ROI 判断。{selectedAccountId ? '当前筛选账号；缺少账号级归因的数据不以全公司数值代替。' : ''}</p>{model.dimensions.map(dimension => <section key={dimension.key}><h4 className="text-sm font-semibold text-text-primary">{dimension.label}</h4><Criteria items={dimension.criteria}/></section>)}<p className="text-xs text-text-muted">经营快照：{model.generatedAt ? new Date(model.generatedAt).toLocaleString('zh-CN') : '待同步'} · 账号同步：{sources.performance?.loadedAt ? new Date(sources.performance.loadedAt).toLocaleString('zh-CN') : '待读取'}</p></div> }]}/></div>
    </section>

    <section className="overflow-hidden rounded-lg border border-border bg-white" aria-labelledby="account-growth-title">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3"><h2 id="account-growth-title" className="ls-type-title-medium text-text-primary">账号健康与阶段目标</h2><span className="text-xs text-text-muted">{model.accountHealth.length} 个真实配置账号 · 目标来自账号自身</span></header>
      {!model.accountHealth.length ? <div className="p-4"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置经营账号">{onNavigate && <Button onClick={() => onNavigate('socialAccounts')}>配置账号</Button>}</Empty></div> : <>
        <div className="p-4"><LsDataChart title="各账号当前健康度" kind="bar" horizontal percent unit="分" labels={model.accountHealth.map(account => `${platformLabels[account.platform]} · ${account.accountLabel}`)} series={[{ label: '当前', values: model.accountHealth.map(account => account.currentScore), color: chartPalette[0] }, { label: '阶段目标', values: model.accountHealth.map(account => account.targetScore), color: chartPalette[2] }]} height={Math.max(240, Math.min(model.accountHealth.length, 10) * 64)}/></div>
        <div className="border-t border-border px-3"><Collapse ghost items={model.accountHealth.map(account => ({ key: `${account.platform}:${account.accountId}`, label: <div className="min-w-0 space-y-3 pr-1"><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2"><SocialPlatformIcon platform={account.platform} size={18}/><strong className="text-sm font-medium text-text-primary">{account.accountLabel}</strong></span><span className="flex items-center gap-2"><strong className="text-sm tabular-nums text-text-primary">{scoreLabel(account.currentScore)}</strong><Tag>{account.scoreCoverage}/{account.dimensions.length} 项已评估</Tag></span></div><div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">{account.currentScore === null ? <span className="text-xs text-text-muted">等待可核验的账号数据</span> : <LsGradientProgress percent={account.currentScore} showInfo={false} aria-label={`${account.accountLabel} 当前 ${scoreLabel(account.currentScore)}`}/>}<span className="text-xs text-text-muted">{account.milestones.filter(item => item.complete).length}/{account.milestones.length} 个阶段目标已达成</span></div></div>, children: <AccountJourney account={account}/> }))}/></div>
      </>}
    </section>
  </div>;
}
