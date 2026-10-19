import { Alert, Button, Divider, Tag } from 'antd';
import {
  ArrowRight,
  FileInput,
  RefreshCw,
  ShieldCheck,
  WalletCards,
  Wrench,
} from 'lucide-react';
import type { AssistantDecisionDeepLink } from '../../lib/assistantDecisionApi';
import {
  ASSISTANT_PRODUCTION_NAVIGATION_NOTICE,
  assistantProductionCommandLabel,
  type AssistantProductionCommand,
  type AssistantProductionContext,
  type AssistantProductionDecision,
} from '../../lib/assistantProductionDecision';
import type { ProductionAllowedCommand } from '../../../shared/contracts/productionReadModel';
import { LsBrandAction } from '../ui/LsExperiencePrimitives';

const productionKindMeta: Record<AssistantProductionDecision['kind'], {
  label: string;
  icon: typeof FileInput;
  tone: 'warning' | 'info' | 'danger';
}> = {
  input_required: { label: '需补资料', icon: FileInput, tone: 'danger' },
  budget: { label: '预算确认', icon: WalletCards, tone: 'warning' },
  quality_review: { label: '质量验收', icon: ShieldCheck, tone: 'info' },
  fallback: { label: '降级路线', icon: RefreshCw, tone: 'warning' },
  recovery: { label: '异常恢复', icon: Wrench, tone: 'danger' },
};

function dispatchDeepLink(link?: AssistantDecisionDeepLink): void {
  if (!link || typeof window === 'undefined') return;
  const detail = {
    ...link,
    ...(link.runId ? { workflowRunId: link.runId } : {}),
    ...(link.taskId ? { workflowTaskId: link.taskId } : {}),
  };
  window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail }));
}

function productionFactTone(tone: AssistantProductionDecision['facts'][number]['tone']): string {
  return tone ? `is-${tone}` : 'is-default';
}

export function ProductionDecisionSummary({
  decision,
  total,
  onOpenDetail,
}: {
  decision: AssistantProductionDecision;
  total: number;
  onOpenDetail?: (trigger?: HTMLButtonElement | null) => void;
}) {
  const Icon = productionKindMeta[decision.kind].icon;
  return (
    <button
      type="button"
      className="assistant-decision-summary"
      onClick={event => onOpenDetail?.(event.currentTarget)}
      aria-label={`查看待办详情：${decision.title}`}
    >
      <span className="assistant-decision-summary__icon" aria-hidden="true"><Icon size={18} /></span>
      <span className="assistant-decision-summary__content">
        <span className="assistant-decision-summary__eyebrow">
          <span>待你决定</span>
          {total > 1 ? <span>共 {total} 项</span> : null}
        </span>
        <strong>{decision.title}</strong>
        <span className="assistant-decision-summary__description">{decision.summary}</span>
      </span>
      <ArrowRight className="assistant-decision-summary__arrow" size={18} aria-hidden="true" />
    </button>
  );
}

export function ProductionDecisionCard({
  decision,
  total,
  deepLink,
  busyCommand,
  onCommand,
}: {
  decision: AssistantProductionDecision;
  total: number;
  deepLink: AssistantProductionContext['deepLink'];
  busyCommand: ProductionAllowedCommand | null;
  onCommand?: (command: AssistantProductionCommand) => void;
}) {
  const meta = productionKindMeta[decision.kind];
  const Icon = meta.icon;
  const executableCommands = onCommand ? decision.commands : [];
  const navigationCommands = onCommand ? [] : decision.commands;
  const primary = executableCommands[0];
  const primaryNavigation = navigationCommands[0];
  const linkFor = (action?: AssistantProductionCommand): AssistantDecisionDeepLink => ({
    ...deepLink,
    ...(action?.deepLink || {}),
    businessRef: {
      ...(deepLink.businessRef || {}),
      ...(action?.deepLink?.businessRef || {}),
      ...(decision.shotId ? { shotId: decision.shotId } : {}),
    },
  });
  return (
    <article className="assistant-decision-card" aria-labelledby={`assistant-production-title-${decision.id}`}>
      <header className="assistant-decision-card__header">
        <span className={`assistant-decision-card__icon is-${meta.tone}`} aria-hidden="true"><Icon size={19} /></span>
        <div className="assistant-decision-card__heading">
          <div className="assistant-decision-card__eyebrow">
            <Tag color={meta.tone}>{meta.label}</Tag>
            {total > 1 ? <span className="assistant-decision-card__queue">优先处理 · 共 {total} 项</span> : null}
          </div>
          <h3 id={`assistant-production-title-${decision.id}`}>{decision.title}</h3>
          <p>{decision.summary}</p>
        </div>
      </header>
      {decision.facts.length ? (
        <dl className="assistant-decision-card__facts">
          {decision.facts.map((fact, index) => (
            <div key={`${fact.label}:${index}`} className={productionFactTone(fact.tone)}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
          ))}
        </dl>
      ) : null}
      {!onCommand ? <Alert type="info" showIcon message="请前往对应页面处理" description={ASSISTANT_PRODUCTION_NAVIGATION_NOTICE} /> : null}
      <Divider className="assistant-decision-card__divider" />
      <footer className="assistant-decision-card__actions">
        <div className="assistant-decision-card__secondary-actions">
          {primary ? <Button icon={<ArrowRight size={15} />} disabled={Boolean(busyCommand)} onClick={() => dispatchDeepLink(linkFor(primary))}>打开对应任务</Button> : null}
          {executableCommands.slice(1).map(action => (
            <Button key={action.command} disabled={Boolean(busyCommand)} loading={busyCommand === action.command} onClick={() => onCommand?.(action)}>{assistantProductionCommandLabel(action, true, false)}</Button>
          ))}
          {navigationCommands.slice(1).map(action => (
            <Button key={action.command} icon={<ArrowRight size={15} />} onClick={() => dispatchDeepLink(linkFor(action))}>{assistantProductionCommandLabel(action, false, false)}</Button>
          ))}
        </div>
        {primary ? (
          <LsBrandAction loading={busyCommand === primary.command} disabled={Boolean(busyCommand)} onClick={() => onCommand?.(primary)}>{assistantProductionCommandLabel(primary, true, true)}</LsBrandAction>
        ) : primaryNavigation ? (
          <LsBrandAction icon={<ArrowRight size={15} />} onClick={() => dispatchDeepLink(linkFor(primaryNavigation))}>{assistantProductionCommandLabel(primaryNavigation, false, true)}</LsBrandAction>
        ) : (
          <LsBrandAction icon={<ArrowRight size={15} />} onClick={() => dispatchDeepLink(linkFor())}>前往处理</LsBrandAction>
        )}
      </footer>
    </article>
  );
}
