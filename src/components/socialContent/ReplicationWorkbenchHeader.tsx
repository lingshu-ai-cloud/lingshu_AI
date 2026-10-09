import type { ReactNode } from 'react';
import { Steps } from 'antd';

const defaultSteps = ['口播替换与确认', '分镜匹配与制作', '成片渲染和导出'];
/** Stable navigation and task identity across the replication workflow. */
export default function ReplicationWorkbenchHeader({ activeStep, title, actions, onStepChange, navigationDisabled = false, stepLabels = defaultSteps }: {
  activeStep: number; title?: string; actions?: ReactNode; onStepChange?: (step: number) => void; navigationDisabled?: boolean; stepLabels?: readonly string[];
}) {
  const steps = stepLabels;
  const activeIndex = Math.max(0, Math.min(activeStep, steps.length - 1));
  return <header className="flex min-h-[88px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-white px-5 py-3">
    <div className="min-w-0 flex-1"><nav aria-label="内容制作步骤" className="max-w-3xl"><Steps size="small" current={activeIndex} onChange={onStepChange} items={steps.map(label => ({ title: label, disabled: navigationDisabled || !onStepChange }))} /></nav><h1 className="mt-3 truncate text-xl font-semibold text-text-primary">{steps[activeIndex]}</h1>{title && <p className="mt-1 truncate text-xs text-text-secondary">{title}</p>}</div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </header>;
}
