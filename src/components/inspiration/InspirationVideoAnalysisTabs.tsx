import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MATERIAL_TYPE_LABELS, SHOT_ROLE_LABELS, benchmarkShotRole, type BenchmarkAnalysis, type BenchmarkShot } from '../../../shared/benchmarkAnalysis';
import type { GeminiVideoAnalysis } from '../../lib/inspirationTypes';
import BenchmarkAnalysisSections from './BenchmarkAnalysisSections';

type AnalysisTab = 'structure' | 'storyboard' | 'viral';
const tabs: Array<{ id: AnalysisTab; label: string }> = [
  { id: 'structure', label: '内容结构和钩子' },
  { id: 'storyboard', label: '分镜与脚本' },
  { id: 'viral', label: '爆火原因分析' },
];
const roleColors: Record<string, string> = {
  hook: 'bg-rose-400', pain_point: 'bg-orange-400', capability_proof: 'bg-sky-500',
  product_intro: 'bg-cyan-500', effect_proof: 'bg-emerald-500', cta: 'bg-violet-500',
  transition: 'bg-slate-400', unknown: 'bg-slate-300',
};
const card = 'rounded-xl border border-border bg-white p-4';
const firstTenLabels: Array<[keyof NonNullable<GeminiVideoAnalysis['firstTenSeconds']>, string]> = [
  ['atmosphere', '氛围'], ['audioVisual', '音画'], ['camera', '运镜'], ['visuals', '画面'], ['voiceMusic', '人声与音乐'],
];

function cleanItems(values: unknown): string[] {
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map(value => value.trim()) : [];
}

function timelineShots(analysis: BenchmarkAnalysis): BenchmarkShot[] {
  return analysis.shots.filter(shot => shot.start !== null && shot.end !== null && shot.end > shot.start);
}

function TimelineRail({ analysis, duration }: { analysis: BenchmarkAnalysis; duration?: number }) {
  const shots = timelineShots(analysis);
  if (!shots.length) return null;
  const end = Math.max(Number.isFinite(duration) ? duration || 0 : 0, ...shots.map(shot => shot.end || 0));
  const segments: Array<{ start: number; end: number; shot: BenchmarkShot | null }> = [];
  let cursor = 0;
  for (const shot of [...shots].sort((left, right) => left.start! - right.start!)) {
    if (shot.start! > cursor) segments.push({ start: cursor, end: shot.start!, shot: null });
    if (shot.end! > cursor) segments.push({ start: Math.max(cursor, shot.start!), end: shot.end!, shot });
    cursor = Math.max(cursor, shot.end!);
  }
  if (end > cursor) segments.push({ start: cursor, end, shot: null });
  return <div className="mt-4" aria-label="原片镜头时间线">
    <div className="flex items-center justify-between text-[10px] font-semibold text-text-muted"><span>0s</span><span>{end.toFixed(1)}s</span></div>
    <div className="mt-1 flex h-3 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${shots.length} 个已记录片段的素材和叙事顺序；灰色表示缺少分析证据`}>
      {segments.map((segment, index) => <span key={`${segment.shot?.shotId || 'gap'}-${index}`} className={`min-w-0 border-r border-white/70 last:border-0 ${segment.shot ? roleColors[segment.shot.narrativeRole] : 'bg-slate-200'}`} style={{ flexGrow: segment.end - segment.start, flexBasis: 0 }} title={segment.shot ? `${segment.shot.time} · ${SHOT_ROLE_LABELS[segment.shot.narrativeRole]} · ${MATERIAL_TYPE_LABELS[segment.shot.materialType]}` : `${segment.start.toFixed(1)}–${segment.end.toFixed(1)}s · 暂无分析证据`} />)}
    </div>
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-muted">
      {Array.from(new Set(shots.map(shot => shot.narrativeRole))).map(role => <span key={role} className="inline-flex items-center gap-1"><i className={`h-2 w-2 rounded-full ${roleColors[role]}`} />{SHOT_ROLE_LABELS[role]}</span>)}
    </div>
  </div>;
}

function sourceStructure(gemini: GeminiVideoAnalysis | undefined, benchmark: BenchmarkAnalysis) {
  const coarse = (gemini?.coarseStructure || []).flatMap((item, index) => {
    const detail = String(item.description || item.desc || item.frame || '').trim();
    const rawLabel = String(item.label || `第 ${index + 1} 段`);
    const role = benchmarkShotRole(rawLabel);
    return detail ? [{ id: `coarse-${index}`, time: String(item.time || '').trim(), label: role === 'unknown' ? rawLabel : SHOT_ROLE_LABELS[role], detail }] : [];
  });
  if (coarse.length) return coarse;
  return benchmark.structure.map((group, index) => {
    const first = benchmark.shots.find(shot => shot.shotId === group.shotIds[0]);
    const last = benchmark.shots.find(shot => shot.shotId === group.shotIds.at(-1));
    return { id: `group-${index}`, time: first && last ? `${first.start ?? '?'}–${last.end ?? '?'}s` : '',
      label: SHOT_ROLE_LABELS[group.narrativeRole] !== '待判断' ? SHOT_ROLE_LABELS[group.narrativeRole] : MATERIAL_TYPE_LABELS[group.materialType],
      detail: first?.visual || `${MATERIAL_TYPE_LABELS[group.materialType]} · ${group.shotIds.length} 个片段` };
  });
}

export function ContentStructureTab({ benchmark, gemini, pending, duration }: { benchmark: BenchmarkAnalysis; gemini?: GeminiVideoAnalysis; pending: boolean; duration?: number }) {
  const hooks = cleanItems(gemini?.hooks);
  const firstShot = benchmark.shots[0];
  const structure = sourceStructure(gemini, benchmark);
  return <div className="space-y-4">
    <section className={card} aria-label="开场钩子证据">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-black text-text-primary">开场钩子</h3><span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700">抓住注意</span></div>
      {hooks.length ? <div className="mt-3 space-y-2">{hooks.slice(0, 3).map((hook, index) => <p key={`${hook}-${index}`} className="rounded-lg border-l-2 border-rose-400 bg-rose-50/60 px-3 py-2 text-xs leading-5 text-text-secondary">{hook}</p>)}</div>
        : firstShot?.visual ? <p className="mt-3 text-xs leading-5 text-text-secondary">原片首段画面：{firstShot.visual}</p>
          : <p className="mt-3 text-xs text-text-muted">{pending ? '正在提取开场画面与钩子。' : '当前分析尚无可核对的开场钩子。'}</p>}
      {firstShot?.visual && hooks.length > 0 && <p className="mt-3 text-[11px] leading-5 text-text-muted">对应原片首段（{firstShot.time || '时间待确认'}）：{firstShot.visual}</p>}
    </section>
    <section className={card} aria-label="全片内容结构">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-black text-text-primary">全片内容结构</h3><span className="text-[11px] text-text-muted">{benchmark.totalShots === null ? `${benchmark.shots.length} 个分析片段 · 实际切镜数待确认` : `${benchmark.totalShots} 个镜头`}</span></div>
      <TimelineRail analysis={benchmark} duration={duration} />
      {structure.length ? <ol className="mt-4 grid gap-2 sm:grid-cols-2">{structure.slice(0, 12).map((item, index) => <li key={item.id} className="relative rounded-lg border border-border bg-[#fbfcfa] px-3 py-3 text-xs"><div className="flex items-center gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-glow text-[10px] font-black text-accent">{index + 1}</span><strong className="min-w-0 break-words text-text-primary">{item.label}</strong><span className="ml-auto shrink-0 text-[10px] text-text-muted">{item.time}</span></div><p className="mt-2 break-words leading-5 text-text-secondary">{item.detail}</p></li>)}</ol>
        : <p className="mt-3 text-xs text-text-muted">{pending ? '正在拆解全片内容顺序。' : '当前分析尚无可核对的结构段。'}</p>}
      {structure.length > 12 && <p className="mt-2 text-[11px] text-text-muted">另有 {structure.length - 12} 段；完整逐镜内容见“分镜与脚本”。</p>}
      {benchmark.shots.length > 0 && !benchmark.timelineComplete && <p className="mt-3 text-[11px] leading-5 text-amber-800">时间线尚未确认覆盖整片；这些结构仅代表已有分析片段。</p>}
    </section>
  </div>;
}

function synthesisShots(analysis: BenchmarkAnalysis): BenchmarkShot[] {
  const shots = analysis.shots;
  const keyShots = [shots.find(shot => shot.narrativeRole === 'hook'), shots.find(shot => ['pain_point', 'capability_proof', 'effect_proof', 'product_intro'].includes(shot.narrativeRole)), shots.find(shot => shot.narrativeRole === 'cta')].filter((shot): shot is BenchmarkShot => Boolean(shot));
  const selected = Array.from(new Map(keyShots.map(shot => [shot.shotId, shot])).values());
  return selected.length >= 2 ? selected : shots.slice(0, Math.min(3, shots.length));
}

export function ViralSynthesisTab({ benchmark, gemini, pending, adaptTip, baseRequirements, duration }: { benchmark: BenchmarkAnalysis; gemini?: GeminiVideoAnalysis; pending: boolean; adaptTip?: string; baseRequirements?: string; duration?: number }) {
  const shots = synthesisShots(benchmark);
  const hooks = cleanItems(gemini?.hooks);
  const sellingPoints = cleanItems(gemini?.sellingPoints);
  const firstTen = firstTenLabels.flatMap(([key, label]) => {
    const detail = gemini?.firstTenSeconds?.[key]?.trim();
    return detail ? [{ label, detail }] : [];
  });
  const hypotheses = benchmark.shots.filter(shot => shot.effectivenessHypothesis).slice(0, 3);
  const hasEvidence = shots.length > 0 || hooks.length > 0 || sellingPoints.length > 0 || firstTen.length > 0;
  return <div className="space-y-4">
    <section className={card} aria-label="爆点证据链">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-black text-text-primary">从钩子到行动的证据链</h3><span className="text-[10px] text-text-muted">画面与台词来自原片分析 · 效果原因属于推断</span></div>
      {hooks[0] && <p className="mt-3 rounded-lg border-l-2 border-rose-400 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-900"><strong>模型识别的注意力入口：</strong>{hooks[0]}</p>}
      <TimelineRail analysis={benchmark} duration={duration} />
      {shots.length ? <ol className="mt-4 grid gap-2 md:grid-cols-3">{shots.map((shot, index) => <li key={shot.shotId} className="relative min-w-0 rounded-lg border border-border bg-[#fbfcfa] p-3 text-xs">
        <div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${roleColors[shot.narrativeRole]}`} /><strong className="text-text-primary">{SHOT_ROLE_LABELS[shot.narrativeRole] === '待判断' ? `第 ${shot.index} 段` : SHOT_ROLE_LABELS[shot.narrativeRole]}</strong><span className="ml-auto text-[10px] text-text-muted">{shot.time || '时间待确认'}</span></div>
        <p className="mt-2 leading-5 text-text-secondary">{shot.visual || '画面待分析'}</p>
        {(shot.dialogue || shot.onScreenText) && <p className="mt-2 rounded-md bg-white px-2 py-1.5 leading-5 text-text-primary"><span className="font-bold">{shot.dialogue ? '口播' : '屏幕文字'}：</span>{shot.dialogue || shot.onScreenText}</p>}
        {shot.effectivenessHypothesis && <p className="mt-2 leading-5 text-amber-800"><span className="font-bold">可能奏效的原因：</span>{shot.effectivenessHypothesis}</p>}
        {index < shots.length - 1 && <span aria-hidden="true" className="absolute -right-2 top-1/2 z-10 hidden rounded-full bg-accent px-1 text-white md:block">→</span>}
      </li>)}</ol> : <p className="mt-3 text-xs text-text-muted">{pending ? '正在关联画面、叙事作用与台词。' : '尚无逐镜证据，完成导演级分镜分析后展示证据链。'}</p>}
    </section>
    {hasEvidence ? <div className="grid gap-4 sm:grid-cols-2">
      <section className={card} aria-label="前十秒音画原因"><h3 className="text-sm font-black text-text-primary">前 10 秒如何留住观看</h3>{firstTen.length ? <dl className="mt-3 space-y-2">{firstTen.map(item => <div key={item.label} className="rounded-lg bg-surface-2 px-3 py-2 text-xs leading-5"><dt className="font-bold text-accent">{item.label}</dt><dd className="mt-1 text-text-secondary">{item.detail}</dd></div>)}</dl> : <p className="mt-3 text-xs text-text-muted">暂无前 10 秒音画证据。</p>}</section>
      <section className={card} aria-label="传播机制与可复用点"><h3 className="text-sm font-black text-text-primary">可复用的表达机制</h3>
        {hypotheses.length > 0 && <ul className="mt-3 space-y-2">{hypotheses.map(shot => <li key={shot.shotId} className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"><strong>{shot.time || `第 ${shot.index} 段`}：</strong>{shot.effectivenessHypothesis}</li>)}</ul>}
        {sellingPoints.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{sellingPoints.slice(0, 6).map((point, index) => <span key={`${point}-${index}`} className="rounded-lg bg-accent-glow px-2 py-1 text-[11px] leading-5 text-accent">{point}</span>)}</div>}
        {hypotheses.length === 0 && sellingPoints.length === 0 && <p className="mt-3 text-xs text-text-muted">尚未识别可核对的表达机制。</p>}
      </section>
    </div> : <section className={card}><p className="text-xs text-text-muted">{pending ? '正在分析爆点证据。' : '当前尚无足够的原片证据解释传播原因。'}</p></section>}
    {adaptTip && hasEvidence && <section className={card}><h3 className="text-sm font-black text-text-primary">编导改编建议</h3><p className="mt-2 text-xs leading-6 text-text-secondary">{adaptTip}</p>{baseRequirements && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[11px] leading-5 text-text-muted">制作约束：{baseRequirements}</p>}</section>}
  </div>;
}

type ShotAnalysisStatusProps = {
  benchmark: BenchmarkAnalysis; pending: boolean; detailedReady: boolean; detailedReason: string;
  onAnalyze: () => void; onReanalyze: () => void; analysisActionAvailable?: boolean;
};

export function DirectorShotAnalysisStatus({ benchmark, pending, detailedReady, detailedReason, onAnalyze, onReanalyze, analysisActionAvailable = true }: ShotAnalysisStatusProps) {
  const exact = benchmark.source.analysisMode === 'exact';
  const reviewCount = benchmark.shots.filter(shot => shot.needsReview).length;
  const detailedComplete = detailedReady && benchmark.totalShots !== null && benchmark.timelineComplete;
  const statusTitle = !analysisActionAvailable ? '分析快照 · 只读' : pending ? '导演级分镜分析中' : detailedComplete ? '导演级逐镜分析已完成' : benchmark.status === 'failed' ? '导演级分镜分析失败' : exact ? '精确分析已返回，镜头边界待复核' : benchmark.shots.length ? '当前为策略级片段分析' : '导演级分镜尚未开始';
  const statusDetail = !analysisActionAvailable ? detailedReason : pending ? '正在处理原片，已有内容可能来自上一次分析。'
    : exact && detailedReady && !detailedComplete ? '全片分析已有结果，但当前片段还不能确认为完整的逐镜切点。'
      : benchmark.shots.length || exact ? detailedReason : '完成全片精确分析后，将显示镜头时间线、画面、台词和待复核数量。';
  return <section className={card} aria-label="导演级分镜分析状态">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-black text-text-primary">{statusTitle}</h3><p className="mt-1 text-[11px] leading-5 text-text-secondary">{statusDetail}</p></div>
      {!pending && analysisActionAvailable && <button type="button" onClick={exact ? onReanalyze : onAnalyze} className="min-h-9 rounded-lg border border-accent px-3 text-[11px] font-black text-accent">{exact ? '重新分析分镜' : '开始导演级分镜分析'}</button>}
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3"><div className="rounded-lg bg-surface-2 px-3 py-2"><span className="block text-text-muted">分镜证据</span><strong className="mt-1 block text-text-primary">{benchmark.totalShots === null ? `${benchmark.shots.length} 个分析片段` : `${benchmark.totalShots} 个镜头`}</strong></div><div className="rounded-lg bg-surface-2 px-3 py-2"><span className="block text-text-muted">全片时间线</span><strong className="mt-1 block text-text-primary">{benchmark.timelineComplete ? '已覆盖' : '待核对'}</strong></div><div className="col-span-2 rounded-lg bg-surface-2 px-3 py-2 sm:col-span-1"><span className="block text-text-muted">待复核镜头</span><strong className="mt-1 block text-text-primary">{reviewCount} 个</strong></div></div>
  </section>;
}

export default function InspirationVideoAnalysisTabs({ benchmark, gemini, pending, detailedReady, detailedReason, onAnalyze, onReanalyze, analysisActionAvailable = true, renderClip, adaptTip, baseRequirements, duration }: {
  benchmark: BenchmarkAnalysis; gemini?: GeminiVideoAnalysis; pending: boolean; detailedReady: boolean; detailedReason: string; duration?: number;
  onAnalyze: () => void; onReanalyze: () => void; analysisActionAvailable?: boolean;
  renderClip?: (url: string) => ReactNode; adaptTip?: string; baseRequirements?: string;
}) {
  const [activeTab, setActiveTab] = useState<AnalysisTab>('structure');
  const id = useId();
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: AnalysisTab) => {
    const index = tabs.findIndex(tab => tab.id === current);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setActiveTab(tabs[next]!.id);
    document.getElementById(`${id}-${tabs[next]!.id}-tab`)?.focus();
  };
  return <section className="mt-4" aria-label="视频分析详情">
    <div className="overflow-x-auto border-b border-border"><div role="tablist" aria-label="视频分析维度" className="flex min-w-max gap-1">
      {tabs.map(tab => <button key={tab.id} id={`${id}-${tab.id}-tab`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={activeTab === tab.id ? `${id}-${tab.id}-panel` : undefined} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => setActiveTab(tab.id)} onKeyDown={event => onTabKeyDown(event, tab.id)} className={`min-h-11 whitespace-nowrap border-b-2 px-3 text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${activeTab === tab.id ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'}`}>{tab.label}</button>)}
    </div></div>
    <div id={`${id}-${activeTab}-panel`} role="tabpanel" aria-labelledby={`${id}-${activeTab}-tab`} tabIndex={0} className="mt-4 focus-visible:outline-none">
      {activeTab === 'structure' && <ContentStructureTab benchmark={benchmark} gemini={gemini} pending={pending} duration={duration} />}
      {activeTab === 'storyboard' && <div className="space-y-4">
        <DirectorShotAnalysisStatus benchmark={benchmark} pending={pending} detailedReady={detailedReady} detailedReason={detailedReason} onAnalyze={onAnalyze} onReanalyze={onReanalyze} analysisActionAvailable={analysisActionAvailable} />
        <BenchmarkAnalysisSections analysis={benchmark} pending={pending} renderClip={renderClip} mode="shots" />
      </div>}
      {activeTab === 'viral' && <ViralSynthesisTab benchmark={benchmark} gemini={gemini} pending={pending} adaptTip={adaptTip} baseRequirements={baseRequirements} duration={duration} />}
    </div>
  </section>;
}
