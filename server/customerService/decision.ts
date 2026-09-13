import type { ActionRisk, AutonomyLevel } from '../autonomy/actionRules.js';

export type CustomerServiceExecution = 'none' | 'remind' | 'draft' | 'auto_send' | 'human_required';
export type CustomerHandlingMode = 'ai_auto' | 'ai_draft' | 'human_needed';
export type DecisionExplanationSource = 'service_policy' | 'knowledge' | 'sales' | 'risk' | 'autonomy' | 'guard' | 'verification' | 'delivery';

export interface DecisionExplanation {
  code: string;
  source: DecisionExplanationSource;
  severity: 'info' | 'warning' | 'blocking';
  summary: string;
  detail?: string;
  ruleId?: string;
  evidence?: string[];
}

export interface CustomerServiceDecision {
  schemaVersion: 1;
  action: { id: string; risk: ActionRisk; description: string };
  requestedAutonomy: AutonomyLevel;
  effectiveAutonomy: AutonomyLevel;
  execution: CustomerServiceExecution;
  handlingMode: CustomerHandlingMode;
  handoff: { required: boolean; reason?: string; safeBridgeAllowed: boolean };
  knowledge: {
    ready: boolean;
    miss: boolean;
    safetyMode: 'setup_required' | 'missing_knowledge' | 'grounded' | 'buyer_and_product_grounded';
    faq?: { matched: boolean; confidence?: number; ambiguous?: boolean; approvedForAuto?: boolean };
    fallbackCount: number;
  };
  sales: { actionIds: string[]; strategyIds: string[]; progressionGoal?: string; spinStage?: string; bantScore?: number };
  safety: { verificationStatus?: string; guardAllowed?: boolean; matchedRule?: string; issues: string[] };
  explanations: DecisionExplanation[];
}

export interface BuildCustomerServiceDecisionInput {
  action?: Partial<CustomerServiceDecision['action']>;
  requestedAutonomy?: AutonomyLevel;
  effectiveAutonomy?: AutonomyLevel;
  execution: CustomerServiceExecution;
  handlingMode?: CustomerHandlingMode;
  handoff?: Partial<CustomerServiceDecision['handoff']>;
  knowledge?: Partial<CustomerServiceDecision['knowledge']>;
  sales?: Partial<CustomerServiceDecision['sales']>;
  safety?: Partial<CustomerServiceDecision['safety']>;
  explanations?: DecisionExplanation[];
}

function defaultHandlingMode(execution: CustomerServiceExecution): CustomerHandlingMode {
  if (execution === 'auto_send') return 'ai_auto';
  if (execution === 'human_required') return 'human_needed';
  return 'ai_draft';
}

export function buildCustomerServiceDecision(input: BuildCustomerServiceDecisionInput): CustomerServiceDecision {
  const requestedAutonomy = input.requestedAutonomy ?? 'draft';
  const effectiveAutonomy = input.effectiveAutonomy ?? requestedAutonomy;
  const handoffRequired = input.handoff?.required ?? input.execution === 'human_required';
  return {
    schemaVersion: 1,
    action: {
      id: input.action?.id || 'draft_reply',
      risk: input.action?.risk || (handoffRequired ? 'L4' : 'L2'),
      description: input.action?.description || '生成客户回复',
    },
    requestedAutonomy,
    effectiveAutonomy,
    execution: input.execution,
    handlingMode: input.handlingMode ?? defaultHandlingMode(input.execution),
    handoff: {
      required: handoffRequired,
      reason: input.handoff?.reason,
      safeBridgeAllowed: Boolean(input.handoff?.safeBridgeAllowed),
    },
    knowledge: {
      ready: input.knowledge?.ready ?? false,
      miss: input.knowledge?.miss ?? false,
      safetyMode: input.knowledge?.safetyMode ?? 'setup_required',
      faq: input.knowledge?.faq,
      fallbackCount: Math.max(0, Number(input.knowledge?.fallbackCount || 0)),
    },
    sales: {
      actionIds: input.sales?.actionIds ?? [],
      strategyIds: input.sales?.strategyIds ?? [],
      progressionGoal: input.sales?.progressionGoal,
      spinStage: input.sales?.spinStage,
      bantScore: input.sales?.bantScore,
    },
    safety: {
      verificationStatus: input.safety?.verificationStatus,
      guardAllowed: input.safety?.guardAllowed,
      matchedRule: input.safety?.matchedRule,
      issues: input.safety?.issues ?? [],
    },
    explanations: input.explanations ?? [],
  };
}

export function executionForActionRisk(risk: ActionRisk, autonomy: AutonomyLevel, autoSendEligible = false): CustomerServiceExecution {
  if (risk === 'L1') return 'remind';
  if (risk === 'L4') return 'human_required';
  if (autonomy === 'remind') return 'remind';
  if (autonomy === 'auto' && autoSendEligible) return 'auto_send';
  return 'draft';
}
