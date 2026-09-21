export type VisibleDigitalEmployeeAgentRole = 'orchestrator' | 'business' | 'director' | 'content' | 'customer';

export const VISIBLE_DIGITAL_EMPLOYEE_AGENT_ROLES: readonly VisibleDigitalEmployeeAgentRole[] = [
  'orchestrator',
  'business',
  'director',
  'content',
  'customer',
];

const ORCHESTRATOR_TASK_KEYS = new Set(['context_readiness', 'goal_decomposition']);
const DIRECTOR_TASK_KEYS = new Set(['scheduled_source_collection', 'viral_analysis', 'content_mode_routing']);
const CONTENT_TASK_KEYS = new Set(['content_production', 'content_quality_gate']);
const BUSINESS_TASK_KEYS = new Set(['content_release_approval', 'publishing_calendar', 'platform_publish', 'weekly_review']);
const CUSTOMER_TASK_KEYS = new Set(['customer_attribution', 'customer_segmentation', 'followup_batch_draft', 'followup_batch_approval', 'followup_dispatch']);

/**
 * Public read-model ownership. Task identity wins over stale persisted roles,
 * while the historical `industry` value is accepted only as a read alias.
 */
export function visibleDigitalEmployeeAgentRole(role: string, taskKey = ''): VisibleDigitalEmployeeAgentRole {
  if (ORCHESTRATOR_TASK_KEYS.has(taskKey)) return 'orchestrator';
  if (DIRECTOR_TASK_KEYS.has(taskKey)) return 'director';
  if (CONTENT_TASK_KEYS.has(taskKey)) return 'content';
  if (BUSINESS_TASK_KEYS.has(taskKey)) return 'business';
  if (CUSTOMER_TASK_KEYS.has(taskKey) || taskKey.startsWith('followup_')) return 'customer';
  if (role === 'industry' || role === 'director') return 'director';
  if (VISIBLE_DIGITAL_EMPLOYEE_AGENT_ROLES.includes(role as VisibleDigitalEmployeeAgentRole)) return role as VisibleDigitalEmployeeAgentRole;
  if (['knowledge', 'planner'].includes(role)) return 'orchestrator';
  if (role === 'review') return 'business';
  if (role === 'channel') return 'director';
  if (role === 'risk') return 'content';
  return 'business';
}
