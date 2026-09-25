import { routeLabel, type ShotRoutingDecision } from '../../lib/shotRoutingPresentation';

export default function ShotRoutingRecommendation({ decision, onSelect }: { decision: ShotRoutingDecision; onSelect: (source: 'material' | 'avatar' | 'ai' | 'shoot') => void }) {
  return <section className="rounded-xl border border-blue-100 bg-blue-50/60 p-3" aria-label="系统推荐制作方案">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[10px] font-black text-blue-800">系统推荐</p><h4 className="mt-0.5 text-xs font-black text-text-primary">{routeLabel(decision.route)}</h4></div><span className="rounded-full bg-white px-2 py-1 text-[9px] font-bold text-blue-800">置信度 {Math.round(decision.confidence * 100)}%{decision.requiresUserConfirmation ? ' · 待确认' : ''}</span></div>
    <ul className="mt-2 space-y-1 text-[10px] leading-4 text-blue-950">{decision.reasons.map(reason => <li key={reason}>• {reason}</li>)}</ul>
    {decision.missing.length > 0 && <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900"><b>还需补齐：</b>{decision.missing.join('；')}</div>}
    <details className="mt-2 text-[10px]"><summary className="cursor-pointer font-bold text-blue-800">查看备选制作方式</summary><div className="mt-2 space-y-1.5">{decision.alternatives.map((alternative, index) => <div key={`${alternative.label}:${index}`} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5"><p><b>{alternative.label}</b><span className="block text-text-muted">{alternative.description}</span></p><button type="button" onClick={() => onSelect(alternative.source)} className="shrink-0 rounded border border-blue-200 px-2 py-1 font-bold text-blue-800">采用</button></div>)}</div></details>
  </section>;
}
