export type VisibleDigitalEmployeeAgentRole = 'business' | 'director' | 'content' | 'customer';

export const VISIBLE_DIGITAL_EMPLOYEE_AGENT_ROLES: readonly VisibleDigitalEmployeeAgentRole[] = [
  'business',
  'director',
  'content',
  'customer',
];

const DIRECTOR_TASK_KEYS = new Set(['scheduled_source_collection', 'viral_analysis']);
const CONTENT_TASK_KEYS = new Set(['content_production', 'content_quality_gate']);
const BUSINESS_TASK_KEYS = new Set(['goal_decomposition', 'content_mode_routing', 'content_release_approval', 'publishing_calendar', 'platform_publish', 'weekly_review']);
const CUSTOMER_TASK_KEYS = new Set(['customer_attribution', 'customer_segmentation', 'followup_batch_draft', 'followup_batch_approval', 'followup_dispatch']);

/**
 * Public read-model ownership. Task identity wins over stale persisted roles,
 * while the historical `industry` value is accepted only as a read alias.
 */
export function visibleDigitalEmployeeAgentRole(role: string, taskKey = ''): VisibleDigitalEmployeeAgentRole {
  // `orchestrator` is retained only as a persisted runtime alias. Supervisor
  // Runtime owns context readiness and scheduling; it is not a fifth expert.
  if (taskKey === 'context_readiness') return 'business';
  if (DIRECTOR_TASK_KEYS.has(taskKey)) return 'director';
  if (CONTENT_TASK_KEYS.has(taskKey)) return 'content';
  if (BUSINESS_TASK_KEYS.has(taskKey)) return 'business';
  if (CUSTOMER_TASK_KEYS.has(taskKey) || taskKey.startsWith('followup_')) return 'customer';
  if (role === 'industry' || role === 'director') return 'director';
  if (VISIBLE_DIGITAL_EMPLOYEE_AGENT_ROLES.includes(role as VisibleDigitalEmployeeAgentRole)) return role as VisibleDigitalEmployeeAgentRole;
  if (['orchestrator', 'knowledge', 'planner'].includes(role)) return 'business';
  if (role === 'review') return 'business';
  if (role === 'channel') return 'director';
  if (role === 'risk') return 'content';
  return 'business';
}
