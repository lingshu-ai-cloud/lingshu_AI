import type { ReactNode } from 'react';

const steps = ['确认新口播', '分镜匹配与制作', '成片渲染和导出'];
/** Stable navigation and task identity across the replication workflow. */
export default function ReplicationWorkbenchHeader({ activeStep, title, actions, onStepChange, navigationDisabled = false, maxNavigableStep = steps.length - 1 }: {
  activeStep: number; title?: string; actions?: ReactNode; onStepChange?: (step: number) => void; navigationDisabled?: boolean; maxNavigableStep?: number;
}) {
  return <header className="flex min-h-[88px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-white px-5 py-3">
    <div className="min-w-0"><nav aria-label="内容制作步骤"><ol className="flex flex-wrap gap-3 text-xs text-text-muted">{steps.map((label, index) => <li key={label} className="flex items-center gap-3"><button type="button" aria-current={index === activeStep ? 'step' : undefined} disabled={navigationDisabled || index > maxNavigableStep} onClick={() => { if (index !== activeStep) onStepChange?.(index); }} className={`rounded px-1 py-1 transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:opacity-50 ${index === activeStep ? 'font-bold text-emerald-700' : 'hover:text-emerald-700'}`}>{index + 1} {label}{index < activeStep ? ' ✓' : ''}</button>{index < steps.length - 1 && <span aria-hidden="true">/</span>}</li>)}</ol></nav><h1 className="mt-2 truncate text-lg font-black text-text-primary">{steps[activeStep]}</h1>{title && <p className="mt-1 truncate text-xs text-text-muted">{title}</p>}</div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </header>;
}
