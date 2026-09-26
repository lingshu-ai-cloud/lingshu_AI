import type { SocialPlatform, VersionedSocialRef } from './socialProgram.js';

export const BUSINESS_GOAL_RULE_VERSION = 'business-content-goal/1.0.0' as const;

export type KnowledgeState = 'fact' | 'inference' | 'unknown';

export interface DecisionEvidence {
  key: string;
  state: KnowledgeState;
  value: string | string[] | number | null;
  sourceRefs: VersionedSocialRef[];
  explanation: string;
}

export type OperatingImpactArea =
  | 'business_goal'
  | 'account_strategy'
  | 'discovery_scope'
  | 'weekly_planning'
  | 'content_facts'
  | 'conversion_routes'
  | 'capacity_plan'
  | 'authorization_review';

export interface DecisionImpact {
  area: OperatingImpactArea;
  reason: string;
  handling: 'new_work_only' | 'review_required';
}

export interface DecisionBlocker {
  code: 'public_facts_required' | 'conversion_route_required' | 'sales_owner_required' | 'account_required';
  field: string;
  message: string;
  recoverable: true;
}

export interface BusinessGoalAccountBoundary {
  accountId: string;
  accountVersion: number;
  platform: SocialPlatform;
  role: string;
  conversionRouteId: string | null;
}

export interface BusinessContentGoal {
  goalId: string;
  programId: string;
  version: number;
  status: 'ready' | 'blocked';
  objective: string;
  products: string[];
  markets: string[];
  audiences: string[];
  languages: string[];
  accountBoundaries: BusinessGoalAccountBoundary[];
  conversionRouteIds: string[];
  publicFactRefs: VersionedSocialRef[];
  prohibitedClaims: string[];
  weeklyBudgetCny: number | null;
  evidence: DecisionEvidence[];
  blockers: DecisionBlocker[];
  inputRefs: VersionedSocialRef[];
  inputFingerprint: string;
  ruleVersion: typeof BUSINESS_GOAL_RULE_VERSION;
  decisionRecordRef: VersionedSocialRef;
  createdBy: string;
  createdAt: string;
}

export interface DecisionRecord<TOutput = VersionedSocialRef> {
  decisionId: string;
  decisionType: 'business_content_goal';
  subjectRef: VersionedSocialRef;
  version: number;
  outcome: 'accepted' | 'blocked';
  ruleVersion: string;
  inputRefs: VersionedSocialRef[];
  inputFingerprint: string;
  evidence: DecisionEvidence[];
  blockers: DecisionBlocker[];
  impacts: DecisionImpact[];
  output: TOutput;
  operator: { type: 'user' | 'agent' | 'system'; id: string };
  decidedAt: string;
}

export interface EnterpriseOperatingInput {
  ref: VersionedSocialRef;
  products: string[];
  markets: string[];
  audiences: string[];
  languages: string[];
  publicFacts: Array<{ ref: VersionedSocialRef; statement: string }>;
  prohibitedClaims: string[];
  weeklyBudgetCny: number | null;
  salesOwnerId: string | null;
}

export interface OperatingAccountInput {
  ref: VersionedSocialRef;
  accountId: string;
  platform: SocialPlatform;
  role: string;
  status: 'planned' | 'active' | 'paused' | 'retired';
  conversionRouteId: string | null;
}

export interface ConversionRouteInput {
  ref: VersionedSocialRef;
  routeId: string;
  kind: 'website' | 'whatsapp' | 'direct_message' | 'form' | 'other';
  target: string | null;
  verified: boolean;
}

export interface BusinessGoalBuildInput {
  programRef: VersionedSocialRef;
  enterprise: EnterpriseOperatingInput;
  accounts: OperatingAccountInput[];
  conversionRoutes: ConversionRouteInput[];
  objective?: string | null;
}

export interface EnterpriseOperatingChange {
  previous: EnterpriseOperatingInput;
  next: EnterpriseOperatingInput;
}
