import { Modal, Tabs } from 'antd';
import { ArrowUpRight, Expand, MessagesSquare, Megaphone, TrendingUp, UserRoundCog } from 'lucide-react';
import { useState } from 'react';
import { LsGradientProgress } from '../ui/LsExperiencePrimitives';
import type { AccountOperatingScore, AccountOperatingScoreDimension } from './accountOperatingScore';

const dimensionIcons = {
  setup: UserRoundCog,
  conversion: TrendingUp,
  traffic: Megaphone,
  inquiries: MessagesSquare,
};

function scoreStatus(score: number | null) {
  if (score === null) return '等待过程数据';
  if (score >= 80) return '过程执行稳健';
  if (score >= 60) return '持续优化中';
  return '需要优先补齐';
}

function dimensionLabel(dimension: AccountOperatingScoreDimension) {
  return <span className="inline-flex items-center gap-1.5"><span>{dimension.label}</span><strong className="tabular-nums">{dimension.points ?? '—'}/{dimension.maxPoints}</strong></span>;
}

function DimensionDetails({ dimension }: { dimension: AccountOperatingScoreDimension }) {
  return <div className="space-y-4 pt-1">
    <div className="rounded-lg border border-border bg-surface-2 p-4">
      <div className="flex items-start justify-between gap-3"><div><h3 className="text-base font-semibold text-text-primary">{dimension.label}</h3><p className="mt-1 text-sm leading-6 text-text-secondary">{dimension.summary}</p></div><strong className="shrink-0 text-2xl font-semibold tabular-nums text-text-primary">{dimension.points ?? '—'}<span className="ml-1 text-xs font-normal text-text-muted">/ 25</span></strong></div>
      {dimension.score === null ? <p className="mt-3 text-xs text-text-muted">暂无可核验过程数据，不按 0 分处理。</p> : <div className="mt-3"><LsGradientProgress percent={dimension.score} showInfo={false} aria-label={`${dimension.label} ${dimension.points}/25 分`}/></div>}
    </div>
    <dl className="divide-y divide-border rounded-lg border border-border px-4">
      {dimension.criteria.map(criterion => {
        const weight = 25 / dimension.criteria.length;
        const points = criterion.score === null ? null : Math.round(criterion.score / 100 * weight * 10) / 10;
        return <div key={criterion.label} className="py-4">
          <div className="flex min-w-0 items-start justify-between gap-3"><dt className="text-sm font-semibold text-text-primary">{criterion.label}</dt><dd className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">{points === null ? '待数据' : `${points}/${weight.toFixed(1)} 分`}</dd></div>
          <p className="mt-1 text-xs leading-5 text-text-secondary">{criterion.current}</p>
          <p className="mt-1 text-xs leading-5 text-text-muted">评分依据：{criterion.evidence}</p>
          {criterion.score !== null && criterion.score < 100 ? <p className="mt-2 flex items-start gap-1 text-xs leading-5 text-accent"><ArrowUpRight size={13} className="mt-0.5 shrink-0" aria-hidden="true"/>下一步：{criterion.action}</p> : null}
        </div>;
      })}
    </dl>
  </div>;
}

export default function AccountOperatingScoreCard({ companyName, score, preview = false }: {
  companyName: string;
  score: AccountOperatingScore;
  preview?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <section className="overflow-hidden rounded-lg border border-border bg-white" aria-labelledby="account-operating-score-title">
      <header className="flex items-start justify-between gap-3 px-6 pb-3 pt-5">
        <div className="min-w-0"><h2 id="account-operating-score-title" className="break-words text-xl font-semibold leading-8 text-text-primary">{companyName || '企业名称待完善'}</h2><p className="mt-1 text-xs text-text-secondary">账号分 · 过程健康</p></div>
        <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="group inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-accent outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"><Expand size={15} aria-hidden="true"/>展开</button>
      </header>
      <div className="px-6 pb-5">
        <div className="flex flex-wrap items-end justify-between gap-3"><p className="flex items-baseline gap-1"><strong className="text-[38px] font-semibold leading-none tabular-nums text-text-primary">{score.totalScore ?? '—'}</strong><span className="text-xs text-text-muted">/ 100</span></p><div className="text-right"><p className="text-xs font-medium text-text-primary">{scoreStatus(score.totalScore)}</p><p className="mt-1 text-xs text-text-muted">{score.evaluatedCriteria}/{score.totalCriteria} 项已评估</p></div></div>
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border" aria-label="账号分四个过程维度">
          {score.dimensions.map(dimension => { const Icon = dimensionIcons[dimension.key]; return <button key={dimension.key} type="button" onClick={() => setOpen(true)} className="min-w-0 bg-surface p-3 text-left outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"><span className="flex items-center gap-1.5 text-xs text-text-secondary"><Icon size={14} className="text-accent" aria-hidden="true"/>{dimension.label}</span><strong className="mt-1 block text-lg font-semibold tabular-nums text-text-primary">{dimension.points ?? '—'}<span className="ml-1 text-[11px] font-normal text-text-muted">/ 25</span></strong></button>; })}
        </div>
        <p className="mt-3 text-xs leading-5 text-text-secondary">评价持续经营动作，不以单次播放量、订单量或询盘量直接打分；待数据不记为 0 分。</p>
      </div>
    </section>
    <Modal open={open} onCancel={() => setOpen(false)} footer={null} width={800} destroyOnHidden title="账号分 · 过程健康详情" aria-describedby="account-operating-score-description">
      <div className="pt-1" id="account-operating-score-description">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-surface-2 p-4"><div><p className="text-sm text-text-secondary">当前账号分</p><p className="mt-1 text-xs leading-5 text-text-muted">四个维度各 25 分；总分只使用已有证据折算，待数据不扣分。</p></div><div className="text-right"><strong className="text-3xl font-semibold tabular-nums text-text-primary">{score.totalScore ?? '—'}<span className="ml-1 text-xs font-normal text-text-muted">/ 100</span></strong><p className="mt-1 text-xs text-text-secondary">{score.evaluatedCriteria}/{score.totalCriteria} 项已评估{preview ? ' · 界面预览' : ''}</p></div></div>
        <Tabs items={score.dimensions.map(dimension => ({ key: dimension.key, label: dimensionLabel(dimension), children: <DimensionDetails dimension={dimension}/> }))}/>
      </div>
    </Modal>
  </>;
}
