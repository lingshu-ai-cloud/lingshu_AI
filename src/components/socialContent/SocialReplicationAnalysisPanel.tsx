import {
  CheckCircle2,
  Clock3,
  Film,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type {
  SocialContentTaskDetail,
  SocialContentExecutionScenePlan,
  SocialReplicationScriptShot,
  SocialShotMaterialMapEntry,
  SocialThreeSecondHook,
} from '../../../shared/contracts/socialContentWorkflow';
import {
  socialShotFunctionLabel,
  socialShotMaterialCountsLabel,
  socialShotSourceStrategyLabel,
} from '../../lib/socialContentModel';

function secondsRange(start: number, end: number): string {
  return `${start.toFixed(1)}–${end.toFixed(1)} 秒`;
}

function PointList({ title, items, tone }: { title: string; items: string[]; tone: 'keep' | 'change' }) {
  const style = tone === 'keep'
    ? 'border-emerald-100 bg-emerald-50/70 text-emerald-900'
    : 'border-amber-100 bg-amber-50/70 text-amber-950';
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${style}`}>
      <p className="text-[10px] font-semibold">{title}</p>
      {items.length > 0
        ? <ul className="mt-1.5 space-y-1 text-[10px] leading-4">{items.map((item, index) => <li key={`${index}:${item}`} className="flex gap-1.5"><span aria-hidden>•</span><span>{item}</span></li>)}</ul>
        : <p className="mt-1.5 text-[10px] opacity-70">编导分析中</p>}
    </div>
  );
}

function HookPanel({ hook, confirmed }: { hook: SocialThreeSecondHook; confirmed: boolean }) {
  return (
    <section className="rounded-lg border border-emerald-200 bg-surface-2 p-4" aria-labelledby="social-primary-hook-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><Sparkles size={15} /></span><div><p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-violet-600">黄金前三秒</p><h4 id="social-primary-hook-title" className="text-sm font-semibold text-text-primary">主钩子方案</h4></div></div>
        <span className="rounded-full bg-white px-2.5 py-1 text-[9px] font-semibold text-blue-700 shadow-none">{confirmed || hook.status === 'confirmed' ? '已确认' : hook.status === 'recommended' ? '编导推荐' : '待确认'}</span>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {[
          ['第一帧看到什么', hook.firstFrame],
          ['第一秒怎么动', hook.firstSecondAction],
          ['开场怎么说', hook.spokenLine || hook.caption || '无口播，用画面建立注意力'],
          ['声音和画面怎么配合', hook.audiovisualPlan],
        ].map(([label, value]) => <div key={label} className="rounded-lg bg-white px-3 py-2.5 shadow-none"><dt className="text-[9px] font-semibold text-text-muted">{label}</dt><dd className="mt-1 text-xs leading-5 text-text-primary">{value}</dd></div>)}
      </dl>
      <p className="mt-3 text-[10px] leading-4 text-text-secondary"><span className="font-semibold">为什么能抓人：</span>{hook.mechanism}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <PointList title="需要保留的钩子作用" items={hook.referencePoints} tone="keep" />
        <PointList title="为了原创必须改动" items={hook.mustDifferPoints} tone="change" />
      </div>
    </section>
  );
}

function AlternativeHooks({ hooks }: { hooks: SocialThreeSecondHook[] }) {
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-2/55 p-3">
      <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-semibold text-text-secondary">两个备选钩子</p><span className="text-[9px] font-semibold text-text-muted">不选择时采用编导推荐方案</span></div>
      {hooks.length > 0 ? <div className="mt-2 grid gap-2 md:grid-cols-2">{hooks.slice(0, 2).map((hook, index) => (
        <article key={hook.hookId} className="rounded-lg border border-border bg-white px-3 py-2.5">
          <p className="text-[9px] font-semibold text-amber-800">备选 {index + 1}</p>
          <p className="mt-1 text-xs font-bold leading-5 text-text-primary">{hook.firstFrame}</p>
          <p className="mt-1 text-[10px] leading-4 text-text-secondary">{hook.spokenLine || hook.caption || hook.firstSecondAction}</p>
          <p className="mt-1 text-[9px] leading-4 text-text-muted">{hook.mechanism}</p>
        </article>
      ))}</div> : <p className="mt-2 text-[10px] text-text-muted">备选钩子正在生成</p>}
    </div>
  );
}

function MaterialSource({ shot, material, execution }: { shot: SocialReplicationScriptShot; material: SocialShotMaterialMapEntry | undefined; execution: SocialContentExecutionScenePlan | undefined }) {
  const strategy = execution?.selectedSourceStrategy ?? material?.sourceStrategy ?? shot.materialPlan.sourceStrategy;
  const counts = material ? socialShotMaterialCountsLabel(material) : [];
  const replacement = material?.functionalEquivalentReplacement ?? shot.materialPlan.functionalEquivalentReplacement;
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/65 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-semibold text-blue-950">内容 Agent 推荐路线</span><span className="rounded-full bg-white px-2 py-1 text-[9px] font-semibold text-blue-800">{socialShotSourceStrategyLabel(strategy)}</span>{counts.map(item => <span key={item} className="rounded-full bg-white px-2 py-1 text-[9px] font-semibold text-blue-700">{item}</span>)}{execution && <span className="rounded-full bg-white px-2 py-1 text-[9px] font-semibold text-blue-700">候选 {execution.candidates.length} 个</span>}</div>
      <p className="mt-1.5 text-[10px] leading-4 text-blue-900">{execution?.feasibilityReason || shot.materialPlan.productionInstruction}</p>
      {replacement.required && <p className="mt-1.5 text-[10px] leading-4 text-amber-800"><span className="font-semibold">等效替换：</span>{replacement.description || replacement.reason || '编导正在确定安全替代画面'}</p>}
    </div>
  );
}

export default function SocialReplicationAnalysisPanel({ task }: { task: SocialContentTaskDetail }) {
  if (task.brief.creationMode !== 'viral_replication') return null;

  const analysis = task.referenceVideoAnalysis;
  const script = task.replicationScript;
  if (analysis?.status === 'blocked') {
    return (
      <section data-social-replication-analysis className="rounded-lg border border-amber-200 bg-amber-50 p-5 shadow-none">
        <div className="flex items-start gap-3"><ShieldCheck size={20} className="mt-0.5 shrink-0 text-amber-700" /><div><h3 className="text-sm font-semibold text-amber-950">参考视频暂时无法分析</h3><p className="mt-1 text-xs leading-5 text-amber-800">{analysis.rightsNotice || '请确认参考视频可以用于分析，系统不会直接复制原视频文件。'}</p></div></div>
      </section>
    );
  }

  if (analysis?.status !== 'ready' || !script) {
    return (
      <section data-social-replication-analysis className="rounded-lg border border-border bg-white p-5 shadow-none">
        <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Clock3 size={19} /></span><div><p className="text-[10px] font-semibold tracking-[0.08em] text-text-muted">爆款复刻</p><h3 className="mt-1 text-base font-semibold text-text-primary">编导分析中</h3><p className="mt-1 text-xs leading-5 text-text-muted">正在分析前三秒、逐镜结构和素材替换方式。分析完成后，这里会显示真实结果。</p></div></div>
      </section>
    );
  }

  const materialByShot = new Map((task.shotMaterialMap || []).map(item => [item.shotId, item]));
  const executionByShot = new Map((task.agentWorkflow?.executionPlan.scenes || []).map(item => [item.sceneId, item]));
  const analysisByShot = new Map(analysis.shots.map(item => [item.shotId, item]));
  const primaryHook = script.hookOptions.find(item => item.hookId === script.primaryHookId)
    ?? analysis.hookAnalysis;
  const alternativeHooks = script.hookOptions.filter(item => item.hookId !== primaryHook?.hookId);

  return (
    <section data-social-replication-analysis className="rounded-lg border border-border bg-white p-5 shadow-none" aria-labelledby="social-replication-analysis-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-[10px] font-semibold tracking-[0.08em] text-accent">爆款复刻 · 编导方案</p><h3 id="social-replication-analysis-title" className="mt-1 text-base font-semibold text-text-primary">参考视频和新视频逐镜对照</h3><p className="mt-1 text-xs leading-5 text-text-muted">保留有效结构和节奏，同时更换真实内容与表达，避免机械复制。</p></div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-semibold text-emerald-800"><CheckCircle2 size={13} />编导分析完成</span>
      </div>

      {primaryHook && <div className="mt-4 rounded-lg border border-violet-100 bg-violet-50/40 p-4"><p className="text-[10px] font-semibold text-violet-600">前三秒预演</p><p className="mt-1 text-sm font-semibold text-text-primary">{primaryHook.firstFrame}</p><p className="mt-1 text-xs leading-5 text-text-secondary">{primaryHook.spokenLine || primaryHook.caption || primaryHook.firstSecondAction}</p></div>}

      <details className="mt-3 overflow-hidden rounded-lg border border-border bg-surface-2/30">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-white px-4 py-3 text-xs font-semibold text-text-primary"><span>查看完整逐镜分析</span><span className="text-[10px] font-bold text-text-muted">{script.shots.length} 个镜头 · 默认收起</span></summary>
        <div className="border-t border-border p-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-surface-2 px-3 py-2.5"><p className="text-[9px] font-semibold text-text-muted">结构怎么保留</p><p className="mt-1 text-xs leading-5 text-text-primary">{script.structureFidelitySummary || '编导分析中'}</p></div>
        <div className="rounded-lg bg-surface-2 px-3 py-2.5"><p className="text-[9px] font-semibold text-text-muted">原创差异怎么做</p><p className="mt-1 text-xs leading-5 text-text-primary">{script.originalityDifferenceSummary || '编导分析中'}</p></div>
      </div>

      <div className="mt-4">
        {primaryHook ? <><HookPanel hook={primaryHook} confirmed={script.status === 'confirmed'} /><AlternativeHooks hooks={alternativeHooks} /><p className="mt-2 text-[10px] leading-4 text-text-muted">确认并开始自动制作时，会同时确认当前推荐开头；备选方案保留给后续变体测试。</p></> : <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-xs font-semibold text-text-muted">前三秒钩子正在分析</div>}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold tracking-[0.08em] text-text-muted">逐镜复刻清单</p><h4 className="mt-1 text-sm font-semibold text-text-primary">每个镜头怎么复刻、哪里必须改</h4></div><span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-bold text-text-muted">{script.shots.length} 个镜头</span></div>

      {script.shots.length === 0 ? <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs font-semibold text-text-muted">逐镜复刻清单正在生成</div> : <div className="mt-3 max-h-[48rem] space-y-3 overflow-y-auto pr-1">{script.shots.map((shot, index) => {
        const reference = shot.referenceShotId ? analysisByShot.get(shot.referenceShotId) : undefined;
        return (
          <article key={shot.shotId} className="rounded-lg border border-border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-[10px] font-semibold text-white">{index + 1}</span><div><p className="text-xs font-semibold text-text-primary">{socialShotFunctionLabel(shot.purpose, index)}</p><p className="text-[9px] text-text-muted">新视频 {secondsRange(shot.startSeconds, shot.endSeconds)}{reference ? ` · 参考 ${secondsRange(reference.startSeconds, reference.endSeconds)}` : ''}</p></div></div><Film size={16} className="text-text-muted" /></div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface-2/60 px-3 py-2.5"><p className="text-[9px] font-semibold text-text-muted">参考视频在做什么</p><p className="mt-1 text-xs leading-5 text-text-primary">{reference?.visualDescription || '编导分析中'}</p>{reference?.rhythmDescription && <p className="mt-1 text-[10px] leading-4 text-text-muted">节奏：{reference.rhythmDescription}</p>}</div>
              <div className="rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2.5"><p className="text-[9px] font-semibold text-blue-700">你的版本怎么拍或生成</p><p className="mt-1 text-xs leading-5 text-text-primary">{shot.visualInstruction}</p>{(shot.spokenText || shot.captionText) && <p className="mt-1 text-[10px] leading-4 text-text-secondary">{shot.spokenText ? `口播：${shot.spokenText}` : ''}{shot.spokenText && shot.captionText ? ' · ' : ''}{shot.captionText ? `字幕：${shot.captionText}` : ''}</p>}</div>
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-2"><PointList title="需要保留" items={shot.fidelityPoints} tone="keep" /><PointList title="必须改动" items={shot.mustDifferPoints} tone="change" /></div>
            <div className="mt-2"><MaterialSource shot={shot} material={materialByShot.get(shot.shotId)} execution={executionByShot.get(shot.shotId)} /></div>
            {shot.lockedRegions.length > 0 && <p className="mt-2 text-[10px] leading-4 text-text-secondary"><span className="font-semibold">不可随意改动：</span>{shot.lockedRegions.join('、')}</p>}
            {shot.risks.length > 0 && <p className="mt-1 text-[10px] leading-4 text-amber-800"><span className="font-semibold">制作注意：</span>{shot.risks.join('、')}</p>}
          </article>
        );
      })}</div>}

      {analysis.rightsNotice && <p className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-4 text-slate-600"><ShieldCheck size={13} className="mt-0.5 shrink-0" />{analysis.rightsNotice}</p>}
        </div>
      </details>
    </section>
  );
}
