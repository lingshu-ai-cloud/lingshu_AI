import type { AssistantDecisionDeepLink } from '../../shared/contracts/assistantDecisionCenter';
import type {
  ProductionAllowedCommand,
  ProductionInputKind,
  ProductionInputRequirement,
  ProductionShotReadModelV1,
} from '../../shared/contracts/productionReadModel';
import type { ProductionReadView } from './productionReadModel';
import { productionIdentityLabel, productionRouteLabel, productionStatusLabel } from './productionReadModel';

export const ASSISTANT_PRODUCTION_CONTEXT_EVENT = 'lingshu:assistant-production-context' as const;

export type AssistantProductionDecisionKind = 'input_required' | 'budget' | 'quality_review' | 'fallback' | 'recovery';

export type AssistantProductionCommand = {
  command: ProductionAllowedCommand;
  label: string;
  shotId: string | null;
  /** Safe destination used when this client has no mutation handler. */
  deepLink?: AssistantDecisionDeepLink;
};

export const ASSISTANT_PRODUCTION_NAVIGATION_NOTICE = '当前入口只会打开对应页面，不会直接执行生产操作。' as const;

/**
 * Keeps navigation-only surfaces from presenting a deep link as a completed
 * production mutation. Execution copy is reserved for a wired command handler.
 */
export function assistantProductionCommandLabel(
  command: AssistantProductionCommand,
  canExecute: boolean,
  primary: boolean,
): string {
  if (canExecute) return command.label;
  return primary ? '前往处理' : '查看并处理';
}

export type AssistantProductionDecision = {
  id: string;
  kind: AssistantProductionDecisionKind;
  priority: number;
  title: string;
  summary: string;
  facts: Array<{ label: string; value: string; tone?: 'default' | 'info' | 'warning' | 'danger' }>;
  subjectVersion: string;
  shotId: string | null;
  commands: AssistantProductionCommand[];
};

export type AssistantProductionContext = {
  view: ProductionReadView;
  deepLink: AssistantDecisionDeepLink & { socialContentTaskId?: string };
};

export type AssistantProductionContextEventDetail = {
  context?: AssistantProductionContext;
  clearProjectId?: string;
};

function firstShot(view: ProductionReadView, predicate: (shot: ProductionShotReadModelV1) => boolean) {
  return view.shots.find(predicate) || null;
}

function costFacts(view: ProductionReadView): AssistantProductionDecision['facts'] {
  const cost = view.aggregate.cost;
  const facts: AssistantProductionDecision['facts'] = [];
  if (cost.expectedCny != null) facts.push({ label: '预计成本', value: `¥${cost.expectedCny.toFixed(2)}`, tone: 'info' });
  if (cost.upperBoundCny != null) facts.push({ label: '费用上限', value: `¥${cost.upperBoundCny.toFixed(2)}`, tone: 'warning' });
  return facts;
}

function shotFacts(shot: ProductionShotReadModelV1 | null): AssistantProductionDecision['facts'] {
  if (!shot) return [];
  const identity = productionIdentityLabel(shot);
  return [
    { label: '分镜', value: `${shot.order}. ${shot.title}` },
    { label: '生产路线', value: productionRouteLabel(shot), tone: 'info' },
    ...(identity ? [{ label: '真实产品精度', value: identity }] : []),
  ];
}

function commandTarget(shot: ProductionShotReadModelV1 | null, view: ProductionReadView, command: ProductionAllowedCommand): string | null | undefined {
  if (shot?.allowedCommands.includes(command)) return shot.shotId;
  if (view.aggregate.allowedCommands.includes(command)) return null;
  return undefined;
}

function command(
  shot: ProductionShotReadModelV1 | null,
  view: ProductionReadView,
  id: ProductionAllowedCommand,
  label: string,
  deepLink?: AssistantDecisionDeepLink,
): AssistantProductionCommand[] {
  const shotId = commandTarget(shot, view, id);
  return shotId === undefined ? [] : [{ command: id, label, shotId, ...(deepLink ? { deepLink } : {}) }];
}

type InputCommandRoute = {
  command: ProductionAllowedCommand;
  label: string;
  deepLink: AssistantDecisionDeepLink;
};

const studioLink = (taskKey = 'content_production'): AssistantDecisionDeepLink => ({
  page: 'smartAssets', view: 'create', businessRef: { taskKey },
});
const enterpriseLink = (): AssistantDecisionDeepLink => ({
  page: 'enterprise', businessRef: { taskKey: 'context_readiness' },
});

const inputCommandRoutes: Partial<Record<ProductionInputKind, InputCommandRoute[]>> = {
  material: [{ command: 'select_material', label: '选择生产素材', deepLink: studioLink() }],
  product_asset: [{ command: 'upload_product_asset', label: '补充产品素材', deepLink: enterpriseLink() }],
  presenter_asset: [{ command: 'select_presenter', label: '选择数字人资产', deepLink: studioLink() }],
  reference_media: [{ command: 'select_material', label: '补充参考素材', deepLink: studioLink() }],
  fact_confirmation: [{ command: 'confirm_facts', label: '确认企业事实', deepLink: enterpriseLink() }],
  rights_confirmation: [{ command: 'confirm_rights', label: '确认素材授权', deepLink: enterpriseLink() }],
  account_authorization: [{ command: 'connect_account', label: '连接发布账号', deepLink: { page: 'accountManagement' } }],
  production_choice: [{ command: 'confirm_production_choice', label: '确认生产方案', deepLink: studioLink() }],
  shooting_media: [
    { command: 'select_material', label: '上传已拍素材', deepLink: studioLink() },
    { command: 'request_shoot', label: '安排补拍', deepLink: studioLink() },
  ],
  quality_review: [{ command: 'review_output', label: '检查生产结果', deepLink: studioLink() }],
};

function commandsForInputs(
  inputs: ProductionInputRequirement[],
  shot: ProductionShotReadModelV1 | null,
  view: ProductionReadView,
): AssistantProductionCommand[] {
  const commands: AssistantProductionCommand[] = [];
  for (const input of inputs) {
    for (const route of inputCommandRoutes[input.kind] || []) {
      if (commands.some(item => item.command === route.command)) continue;
      commands.push(...command(shot, view, route.command, route.label, route.deepLink));
      if (commands.length >= 2) return commands;
    }
  }
  return commands;
}

/**
 * Returns one highest-priority production decision. It never guesses an action
 * from copy: command buttons are sourced exclusively from allowedCommands.
 */
export function productionDecisionFromReadView(view: ProductionReadView): AssistantProductionDecision | null {
  if (view.source !== 'canonical_task' || !view.project.version) return null;
  const version = view.project.version;
  const budgetInput = view.aggregate.inputs.items.find(item => item.kind === 'budget_confirmation' && item.status !== 'provided');
  if (budgetInput) {
    const shot = firstShot(view, item => item.inputs.items.some(input => input.id === budgetInput.id));
    return {
      id: `production:budget:${shot?.shotId || view.project.id}`,
      kind: 'budget',
      priority: 780,
      title: '确认生产预算',
      summary: budgetInput.reason || budgetInput.label || '当前生产路线需要确认费用上限。',
      facts: [...costFacts(view), ...shotFacts(shot)].slice(0, 6),
      subjectVersion: version,
      shotId: shot?.shotId || null,
      commands: command(shot, view, 'confirm_budget', '确认预算'),
    };
  }

  const missingShot = firstShot(view, shot => shot.inputs.missing.length > 0 || shot.status === 'needs_input');
  if (missingShot || view.aggregate.inputs.missing.length) {
    const missing = missingShot?.inputs.missing.length ? missingShot.inputs.missing : view.aggregate.inputs.missing;
    const missingInputs = [...(missingShot?.inputs.items || []), ...view.aggregate.inputs.items]
      .filter((item, index, items) => item.status !== 'provided' && item.status !== 'not_applicable'
        && items.findIndex(candidate => candidate.id === item.id) === index);
    return {
      id: `production:input:${missingShot?.shotId || view.project.id}`,
      kind: 'input_required',
      priority: 760,
      title: '补齐生产输入',
      summary: missing.slice(0, 3).join('、') || '需要补齐资料后才能继续。',
      facts: [
        { label: '缺失项', value: `${missing.length} 项`, tone: 'warning' as const },
        ...shotFacts(missingShot),
      ].slice(0, 6),
      subjectVersion: version,
      shotId: missingShot?.shotId || null,
      commands: commandsForInputs(missingInputs, missingShot, view),
    };
  }

  const recoveryShot = firstShot(view, shot => shot.status === 'failed'
    || (shot.status === 'blocked' && shot.allowedCommands.includes('retry') && !shot.route.fallbacks.length));
  if (recoveryShot || view.aggregate.status === 'failed') {
    const blocker = recoveryShot?.blockers[0] || view.aggregate.blockers[0];
    return {
      id: `production:recovery:${recoveryShot?.shotId || view.project.id}`,
      kind: 'recovery',
      priority: 750,
      title: '恢复失败的生产任务',
      summary: blocker?.message || '任务失败，需要按原任务恢复或重试。',
      facts: [
        { label: '当前状态', value: productionStatusLabel(recoveryShot?.status || view.aggregate.status), tone: 'danger' as const },
        ...shotFacts(recoveryShot),
      ].slice(0, 6),
      subjectVersion: version,
      shotId: recoveryShot?.shotId || null,
      commands: command(recoveryShot, view, 'retry', '恢复原任务'),
    };
  }

  const fallbackShot = firstShot(view, shot => shot.status === 'blocked'
    && (shot.route.fallbacks.length > 0 || shot.allowedCommands.includes('use_fallback')));
  if (fallbackShot) {
    const fallback = fallbackShot.route.fallbacks.find(item => item.executable) || fallbackShot.route.fallbacks[0];
    return {
      id: `production:fallback:${fallbackShot.shotId}`,
      kind: 'fallback',
      priority: 740,
      title: '选择稳定降级路线',
      summary: fallback?.reason || fallbackShot.blockers[0]?.message || '当前路线受阻，可切换到已验证的备选路线。',
      facts: [
        ...shotFacts(fallbackShot),
        ...(fallback ? [{ label: '备选路线', value: fallback.label, tone: 'warning' as const }] : []),
      ].slice(0, 6),
      subjectVersion: version,
      shotId: fallbackShot.shotId,
      commands: command(fallbackShot, view, 'use_fallback', '使用备选路线'),
    };
  }

  const reviewShot = firstShot(view, shot => ['quality_review', 'review_ready'].includes(shot.status));
  if (reviewShot || ['quality_review', 'review_ready'].includes(view.aggregate.status)) {
    const target = reviewShot;
    return {
      id: `production:qa:${target?.shotId || view.project.id}`,
      kind: 'quality_review',
      priority: 700,
      title: '验收生产结果',
      summary: '检查产品、人物、事实与音画质量后，再确认是否通过。',
      facts: [
        { label: '待验收', value: `${view.aggregate.counts.review} 镜`, tone: 'warning' as const },
        ...shotFacts(target),
      ].slice(0, 6),
      subjectVersion: version,
      shotId: target?.shotId || null,
      commands: [
        ...command(target, view, 'review_output', '开始验收'),
        ...command(target, view, 'approve_output', '通过验收'),
      ],
    };
  }
  return null;
}

export function publishAssistantProductionContext(detail: AssistantProductionContextEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ASSISTANT_PRODUCTION_CONTEXT_EVENT, { detail }));
}
