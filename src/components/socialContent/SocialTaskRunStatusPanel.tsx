import { Loader2 } from 'lucide-react';
import type { SocialContentTaskDetail } from '../../../shared/contracts/socialContentWorkflow';

function estimatedTime(task: SocialContentTaskDetail): string {
  const seconds = task.productionProgress?.estimatedRemainingSeconds
    ?? task.agentWorkflow?.executionPlan.estimatedTotalSeconds
    ?? null;
  if (seconds === null || !Number.isFinite(seconds)) return '正在计算';
  if (seconds <= 60) return '约 1 分钟';
  return `约 ${Math.ceil(seconds / 60)} 分钟`;
}

function currentStep(task: SocialContentTaskDetail): string {
  if (task.productionProgress?.step) return task.productionProgress.step;
  if (task.status === 'packaging') return '整理发布内容';
  if (task.agentWorkflow?.directorBrief.status !== 'ready') return '整理脚本与镜头';
  return '制作视频';
}

function currentActivity(task: SocialContentTaskDetail): string {
  const step = task.productionProgress?.step;
  if (step === '准备执行') return '正在检查本次制作所需内容';
  if (step === '编导方案') return '正在整理口播、字幕和镜头安排';
  if (step === '素材匹配') return '正在选择适合本条内容的画面';
  if (step === '内容制作') return '正在合成画面、配音和字幕';
  if (step === '口播校准') return '正在调整口播与画面节奏';
  if (step === '剪辑合成') return '正在剪辑并合成成片';
  if (step === '成片质检') return '正在检查画面、声音和字幕';
  if (step === '复刻评估') return '正在对比参考内容与成片效果';
  if (step === '编导复核') return '正在进行最后一次内容检查';
  if (task.status === 'packaging') return '正在整理成片、封面和发布内容';
  if (task.agentWorkflow?.directorBrief.status !== 'ready') return '正在分析内容并准备镜头方案';
  return '正在推进本条内容的制作';
}

export function isLiveSocialProduction(task: SocialContentTaskDetail): boolean {
  return task.status === 'producing'
    || task.status === 'packaging'
    || (task.status === 'attention' && Boolean(task.productionProgress));
}

export default function SocialTaskRunStatusPanel({ task }: { task: SocialContentTaskDetail }) {
  if (!isLiveSocialProduction(task)) return null;
  const rows = [
    ['预计生成耗时', estimatedTime(task)],
    ['当前步骤', currentStep(task)],
    ['系统正在做什么', currentActivity(task)],
  ] as const;

  return (
    <section className="mx-auto w-full max-w-2xl rounded-2xl border border-emerald-200 bg-white px-5 py-8 shadow-sm sm:px-8" aria-labelledby="social-task-running-title">
      <div className="text-center">
        <span className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-700" aria-hidden>
          <Loader2 size={42} className="animate-spin motion-reduce:animate-none" />
        </span>
        <p className="mt-5 text-sm font-black text-emerald-700">正在制作</p>
        <h2 id="social-task-running-title" className="mt-2 text-xl font-black text-text-primary sm:text-2xl">{task.brief.title}</h2>
      </div>

      <dl className="mt-7 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-2" aria-live="polite">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 px-4 py-3.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start sm:gap-4">
            <dt className="text-sm font-bold text-text-muted">{label}</dt>
            <dd className="text-sm font-black leading-6 text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
