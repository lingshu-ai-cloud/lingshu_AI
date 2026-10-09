import { useEffect, useState, type ReactNode } from 'react';
import { MATERIAL_TYPE_LABELS, SHOT_ROLE_LABELS, type BenchmarkAnalysis, type BenchmarkShot } from '../../../shared/benchmarkAnalysis';
import { authHeader } from '../../lib/auth';

const detailLabels: Record<string, string> = { angle: '视角', composition: '构图', ambientSound: '环境声音', bgm: '背景音乐', soundEffects: '音效', observedFacts: '观察事实', inferredIntent: '意图推断', causalGap: '未展示的因果动作', startState: '起始状态', endState: '结束状态', transitionToNext: '衔接下一镜' };
const panel = 'rounded-xl border border-border bg-white p-4';
function ShotFrame({ shot }: { shot: BenchmarkShot }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUrl(''); setFailed(false);
    if (!shot.firstFrameRef) return;
    const controller = new AbortController(); let blobUrl = '';
    void fetch(shot.firstFrameRef, { headers: authHeader(), signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('frame_unavailable'); return response.blob(); })
      .then(blob => { if (!controller.signal.aborted) { blobUrl = URL.createObjectURL(blob); setUrl(blobUrl); } })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [shot.firstFrameRef]);
  return <div className="flex aspect-[9/16] w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-center text-[10px] text-text-muted sm:w-20">
    {url && !failed ? <img src={url} alt={`第 ${shot.index} 镜原片首帧`} className="h-full w-full object-cover" onError={() => setFailed(true)} />
      : <span className="px-1">{shot.firstFrameRef && !failed ? '首帧加载中' : '首帧未取得'}</span>}
  </div>;
}
function ShotCard({ shot, renderClip }: { shot: BenchmarkShot; renderClip?: (url: string) => ReactNode }) {
  return <article className="min-w-0 rounded-xl border border-border bg-[#fbfcfa] p-3" aria-label={`第 ${shot.index} 镜`}>
    <div className="flex items-start gap-3"><ShotFrame shot={shot} /><div className="min-w-0 flex-1 break-words">
      <div className="flex flex-wrap items-center gap-2"><strong className="rounded bg-accent px-2 py-1 text-xs text-white">{shot.index}</strong><span className="text-xs font-semibold text-text-muted">{shot.time || '时间待确认'}</span></div>
      <div className="mt-2 flex flex-wrap gap-1 text-[10px]"><span className="rounded bg-emerald-50 px-2 py-1 text-emerald-800">{MATERIAL_TYPE_LABELS[shot.materialType]}</span>{shot.narrativeRole !== 'unknown' && <span className="rounded bg-sky-50 px-2 py-1 text-sky-800">{SHOT_ROLE_LABELS[shot.narrativeRole]}</span>}{shot.classificationSource === 'legacy_evidence' && <span className="rounded bg-amber-50 px-2 py-1 text-amber-800">依据已有描述整理</span>}{shot.needsReview && <span className="rounded bg-amber-50 px-2 py-1 text-amber-800">待复核</span>}</div>
      <p className="mt-2 text-xs leading-5 text-text-secondary">画面：{shot.visual || '待分析'}</p>
      {shot.dialogue && <p className="mt-1 text-xs leading-5 text-text-primary">口播：{shot.dialogue}</p>}
      {shot.onScreenText && <p className="mt-1 text-[11px] leading-5 text-text-muted">屏幕文字：{shot.onScreenText}</p>}
    </div></div>
    <details open={shot.index === 1} className="mt-2 break-words text-[11px]"><summary className="cursor-pointer font-semibold text-accent">分类依据与镜头细节</summary><p className="mt-2 leading-5">{shot.classificationEvidence || '分类依据待补齐'}</p><p className="leading-5 text-text-muted">{shot.purpose || '镜头作用待补齐'}</p>
      {(shot.framing || shot.camera || shot.environment) && <p className="mt-1 leading-5">{[shot.framing, shot.camera, shot.environment].filter(Boolean).join(' · ')}</p>}
      {Object.entries(shot.detailedAnalysis || {}).map(([key, value]) => <p key={key} className="mt-1 leading-5">{detailLabels[key]}：{value}</p>)}
      {shot.audio && <p className="mt-1 leading-5">声音：{shot.audio}</p>}
      {shot.effectivenessHypothesis && <p className="mt-1 leading-5 text-amber-800">有效性判断：{shot.effectivenessHypothesis}</p>}
      {shot.authenticity && <p className="mt-1 leading-5 text-text-muted">真实性要求：{shot.authenticity}</p>}
    </details>
    {shot.clipRef && renderClip && <details className="mt-2 text-[11px]"><summary className="cursor-pointer font-semibold text-accent">核对原片切片</summary><div className="mt-2">{renderClip(shot.clipRef)}</div></details>}
  </article>;
}
export default function BenchmarkAnalysisSections({ analysis, pending = false, renderClip, mode = 'all' }: {
  analysis: BenchmarkAnalysis; pending?: boolean; renderClip?: (url: string) => ReactNode; mode?: 'all' | 'shots';
}) {
  const [view, setView] = useState<'shots' | 'speech'>('shots');
  const groupedIds = new Set(analysis.speechGroups.flatMap(group => group.shotIds));
  return <div className="mb-4 space-y-4" data-benchmark-analysis>
    <section className={panel} aria-labelledby="benchmark-structure-title">
      <h3 id="benchmark-structure-title" className="text-sm font-black text-text-primary">{mode === 'shots' ? '原片逐镜画面与脚本' : '全片结构与素材拆解'}</h3>
      <p className="mt-2 text-xs font-semibold text-text-secondary">{analysis.totalShots === null ? `已分析 ${analysis.shots.length} 个片段 · 实际镜头数待确认` : `已拆解 ${analysis.totalShots} 个镜头`}{analysis.speechGroups.length > 0 ? ` · ${analysis.speechGroups.length} 个口播段` : ''}</p>
      {analysis.shots.length > 0 ? <>
        {mode === 'all' && <><div className="mt-3 flex flex-wrap gap-2">{Object.entries(analysis.materialCounts).filter(([, count]) => count > 0).map(([type, count]) => <span key={type} className="rounded-lg bg-surface-2 px-2 py-1 text-[10px] font-semibold">{MATERIAL_TYPE_LABELS[type as keyof typeof MATERIAL_TYPE_LABELS]} {count}</span>)}</div>
        <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs leading-6 text-emerald-900"><strong>结构顺序</strong><div className="mt-1 flex flex-wrap items-center gap-1">{analysis.structure.map((item, index) => <span key={index}>{index > 0 && <span className="mx-1 text-text-muted">→</span>}{MATERIAL_TYPE_LABELS[item.materialType]}<span className="text-[10px]">（{item.shotIds.includes(analysis.hookShotId || '') ? '首镜钩子 · ' : ''}{item.shotIds.length} 镜头）</span></span>)}</div></div></>}
        {!analysis.timelineComplete && <p className="mt-2 text-[11px] text-amber-800">全片覆盖尚待核对，当前结构仅代表已有分析片段。</p>}
        {analysis.speechGroups.length > 0 && <div role="group" aria-label="分镜阅读方式" className="mt-4 flex flex-wrap gap-2">{(['shots', 'speech'] as const).map(mode => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${view === mode ? 'border-accent bg-accent-glow text-accent' : 'border-border text-text-secondary'}`}>{mode === 'shots' ? '按镜头查看' : '按口播段查看'}</button>)}</div>}
        <div className="mt-3 space-y-3">{view === 'shots' ? analysis.shots.map(shot => <ShotCard key={shot.shotId} shot={shot} renderClip={renderClip} />) : <>
          {analysis.speechGroups.map(group => <details key={group.groupId} className="rounded-xl border border-border bg-[#fbfcfa] p-3"><summary className="cursor-pointer break-words text-xs leading-6"><strong>{group.text}</strong><span className="block text-text-muted">{group.start.toFixed(2)}–{group.end.toFixed(2)}s · {group.timingPrecision === 'phrase' ? '句级时间码' : '估计时间码'}{group.needsReview ? ' · 待复核' : ''}</span><span className="block font-semibold text-accent">{group.timingPrecision === 'phrase' ? '覆盖' : '估计关联'} {group.shotIds.length} 个镜头</span></summary><div className="mt-3 space-y-3">{analysis.shots.filter(shot => group.shotIds.includes(shot.shotId)).map(shot => <ShotCard key={shot.shotId} shot={shot} renderClip={renderClip} />)}</div></details>)}
          {analysis.shots.filter(shot => !groupedIds.has(shot.shotId)).map(shot => <ShotCard key={shot.shotId} shot={shot} renderClip={renderClip} />)}
        </>}</div>
      </> : <p className="mt-3 text-xs leading-5 text-text-muted">{pending ? '正在拆解原片镜头与素材类型。' : '尚无逐镜数据，完成原片分析后展示结构与镜头卡片。'}</p>}
    </section>
  </div>;
}
