import { normalizeTodo } from '../../src/lib/reviewTodos.js';
import { normalizeAssessment, maturityProfiles, taskGuidance } from '../../shared/contracts/operatingMaturity.js';
import { normalizeVideoPlan, videoPlanErrors } from '../../shared/contracts/videoCreationPlan.js';
import { normalizeMatrixPlan, matrixScopeIssues } from '../../src/lib/weeklyMatrix.js';
import { TASK_TEMPLATES, packageIssues, type WeeklyPackage, type PackageTask } from '../../src/lib/weeklyPackage.js';
import { defaultDirectorPlan, normalizeDirectorPlan } from '../../src/lib/contentDirector.js';
import { buildWeeklyPlan, type DigitalEmployeeConfig, type WeeklyGoalInput, type WeeklyPlanDraft } from './domain.js';

export function recommendPackage(goal: WeeklyGoalInput, config: DigitalEmployeeConfig, ownerId = '', ownerName = ''): WeeklyPackage {
  const base = buildWeeklyPlan(goal, config);
  const maturity = config.operatingMaturity || 'growing';
  const participation = config.defaultParticipation || 'agent';
  const keys = new Set(base.tasks.map(t => t.key));
  const tasks = TASK_TEMPLATES.filter(t => !['collection', 'inspiration'].includes(t.id) && t.keys.some(key => keys.has(key)) && (maturity !== 'starting' || ['readiness', 'director', 'production', 'publishing', 'customers', 'followup', 'review'].includes(t.id))).map(template => ({
    templateId: template.id, title: template.title,
    ownerId: participation === 'team' && !['review'].includes(template.id) ? ownerId : '',
    ownerName: participation === 'team' && ownerId ? ownerName : '', dueAt: goal.endsAt, notes: taskGuidance(maturity, template.id, config.operatingAssessment), sourceProjectIds: [],
    ...(template.id === 'production' ? { videoPlans: goal.videoPlans?.length ? goal.videoPlans : [normalizeVideoPlan({ ...config.videoDefaults, productName: config.focusProducts.split(/[、，,；;]/)[0], theme: '介绍产品的用途与特点', platform: goal.contentPlatforms[0] })] } : {}),
  }));
  const contentCount = tasks.find(t => t.templateId === 'production')?.videoPlans?.length || 0;
  const publishAccountCount = config.publishingTargets.filter(target => goal.contentPlatforms.includes(target.platform)).length;
  const defaultPublishActions = contentCount * Math.max(1, publishAccountCount);
  return { revision: 1, maturity, operatingAssessment: normalizeAssessment(config.operatingAssessment), participation, tasks,
    directorPlan: defaultDirectorPlan(contentCount),
    // Approving the weekly package is the single human authorization event.
    // Every actual publish still has to pass the frozen account/week/count/hash
    // boundary and the existing quality, connection and receipt safeguards.
    authorization: { mode: 'bounded', accountIds: config.publishingTargets.map(t => t.accountId), maxPublishItems: Math.max(1, defaultPublishActions), customerIds: [], maxCustomerMessages: 1 } };
}

export function normalizePackage(raw: WeeklyPackage): WeeklyPackage {
  if (!raw || !Array.isArray(raw.tasks) || raw.tasks.length > TASK_TEMPLATES.length) throw Error('任务包格式无效');
  const clean = (s: unknown, max = 500) => String(s || '').trim().slice(0, max);
  const ids = (x: unknown) => Array.isArray(x) ? [...new Set(x.map(v => clean(v, 160)).filter(Boolean))].slice(0, 100) : [];
  const a = raw.authorization;
  return {
    ...(raw.directorPlan !== undefined ? { directorPlan: normalizeDirectorPlan(raw.directorPlan) } : {}),
    ...(raw.matrixPlan !== undefined ? { matrixPlan: normalizeMatrixPlan(raw.matrixPlan) } : {}),
    ...(Array.isArray(raw.reviewTodos) ? { reviewTodos: raw.reviewTodos.slice(0, 50).map(t => normalizeTodo(t)) } : {}),
    revision: Number.isInteger(raw.revision) ? raw.revision : 0,
    maturity: ['starting', 'growing', 'established'].includes(raw.maturity) ? raw.maturity : 'growing',
    operatingAssessment: normalizeAssessment(raw.operatingAssessment),
    participation: raw.participation === 'team' ? 'team' : 'agent',
    tasks: raw.tasks.map(t => ({ templateId: t.templateId, title: clean(t.title, 160), ownerId: clean(t.ownerId, 160), ownerName: clean(t.ownerName, 160), dueAt: clean(t.dueAt, 10), notes: clean(t.notes, 1000), sourceProjectIds: ids(t.sourceProjectIds), ...(t.templateId === 'production' ? { videoPlans: (t.videoPlans || []).slice(0, 30).map(normalizeVideoPlan) } : {}) })),
    authorization: { mode: a?.mode === 'bounded' ? 'bounded' : 'each', accountIds: ids(a?.accountIds), customerIds: ids(a?.customerIds), maxPublishItems: Math.min(100, Math.max(0, Math.floor(Number(a?.maxPublishItems) || 0))), maxCustomerMessages: Math.min(100, Math.max(0, Math.floor(Number(a?.maxCustomerMessages) || 0))) },
  };
}

export function validatePackage(pack: WeeklyPackage, goal: WeeklyGoalInput, config?: DigitalEmployeeConfig): string[] {
  const videoPlans = pack.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
  const plannedVersions = config ? videoPlans.reduce((sum, plan) => sum + (plan.matrix ? 1 : Math.max(1, config.videoLanguages?.length || 1)), 0) : 0;
  const versionIssues = config && pack.directorPlan && plannedVersions !== pack.directorPlan.platformVersionTarget
    ? [`编导目标为 ${pack.directorPlan.platformVersionTarget} 个平台版本，但当前语言与账号计划将生成 ${plannedVersions} 个版本`]
    : [];
  return [...packageIssues(pack, goal.startsAt, goal.endsAt), ...versionIssues, ...(config ? matrixScopeIssues(pack, config.publishingTargets, goal.contentPlatforms) : []), ...pack.tasks.flatMap(t => (t.videoPlans || []).flatMap((p, i) => videoPlanErrors(p).map(e => `第 ${i + 1} 条视频：${e}`)))];
}

export function packageConfig(pack: WeeklyPackage, config: DigitalEmployeeConfig): DigitalEmployeeConfig {
  const selected = new Set(pack.tasks.map(t => t.templateId));
  const workflows: DigitalEmployeeConfig['enabledWorkflows'] = [];
  if (selected.has('director') || selected.has('collection')) workflows.push('scheduled_social');
  if (selected.has('director') || selected.has('inspiration')) workflows.push('viral_clone');
  if (selected.has('production')) workflows.push('product_content');
  if (selected.has('publishing')) workflows.push('content_publish');
  if (selected.has('customers')) workflows.push('customer_segmentation');
  if (selected.has('followup')) workflows.push('batch_followup');
  return { ...config, enabledWorkflows: workflows, publishingTargets: config.publishingTargets.filter(t => pack.authorization.accountIds.includes(t.accountId) && (!pack.matrixPlan || pack.matrixPlan.some(row => row.accountId === t.accountId))) };
}

export function compilePackage(pack: WeeklyPackage, goal: WeeklyGoalInput, config: DigitalEmployeeConfig): WeeklyPlanDraft & { businessPackage: WeeklyPackage } {
  const selected = new Set(pack.tasks.map(t => t.templateId));
  const base = buildWeeklyPlan({ ...goal, businessLine: 'full_funnel' }, packageConfig(pack, config));
  const allowed = new Set<string>(['context_readiness', 'goal_decomposition']);
  for (const t of TASK_TEMPLATES.filter(t => selected.has(t.id))) for (const key of t.keys) allowed.add(key);
  const tasks = base.tasks.filter(t => allowed.has(t.key));
  const included = new Set(tasks.map(t => t.key));
  for (const todo of pack.reviewTodos || []) {
    if (todo.kind === 'video') continue;
    tasks.push({ key: `review_todo_${todo.id}`, title: todo.title,
      description: `来源洞察：${todo.sourceTitle}\n执行要求：${todo.requirements}\n参考依据：${todo.reference}\n所需资料：${todo.materials}\n验收条件：${todo.acceptance}`,
      agentRole: todo.kind === 'followup' ? 'customer' : 'business', kind: 'planning', sequence: tasks.length + 1, priority: 'high', requiresApproval: false, dependsOn: [], expectedMinutes: 10,
      businessDomain: todo.kind === 'followup' ? 'customer' : 'foundation', capabilityKey: 'review.todo',
      destination: todo.kind === 'knowledge' ? 'enterprise' : todo.kind === 'followup' ? 'conversion' : 'digitalEmployees', statusSource: '人工完成确认及业务记录', executionMode: 'observe', externalEffect: 'none', automaticExecutionAllowed: false, policySource: 'effective_runtime_policy' });
  }
  const review = tasks.find(t => t.key === 'weekly_review');
  for (const task of tasks.filter(t => t.key.startsWith('review_todo_'))) { included.add(task.key); if (review) review.dependsOn = [...new Set([...review.dependsOn, task.key])]; }
  return { ...base, businessPackage: pack,
    strategy: maturityProfiles[pack.maturity].strategy,
    successCriteria: [...base.successCriteria, maturityProfiles[pack.maturity].criteria],
    tasks: tasks.map((t, index) => ({ ...t, description: [t.description, packageTaskForKey(pack, t.key)?.notes].filter(Boolean).join('\n本周工作说明：'), sequence: index + 1, dependsOn: t.dependsOn.filter(k => included.has(k)) })),
  };
}
export function packageTaskForKey(pack: WeeklyPackage | undefined, key: string): PackageTask | undefined {
  const template = TASK_TEMPLATES.find(t => (t.keys as readonly string[]).includes(key));
  return pack?.tasks.find(t => t.templateId === template?.id);
}

// A package grant authorizes only the frozen scope. A later content edit is
// separately detected by the existing content hash and quality preflight.
export function grantCovers(pack: WeeklyPackage, effect: 'publish' | 'send', ids: string[], count: number, now: string, endsAt: string): boolean {
  const a = pack.authorization;
  if (a.mode !== 'bounded' || now.slice(0, 10) > endsAt || count < 1) return false;
  const scope = effect === 'publish' ? a.accountIds : a.customerIds;
  const limit = effect === 'publish' ? a.maxPublishItems : a.maxCustomerMessages;
  return count <= limit && ids.length > 0 && ids.every(id => scope.includes(id));
}
