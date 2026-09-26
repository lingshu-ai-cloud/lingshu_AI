import type { BusinessContentGoal, DecisionRecord } from '../../shared/contracts/socialOperatingDecision.js';
import type { DataStore } from '../storage/datastore.js';

const GOALS = 'social_business_content_goals';
const DECISIONS = 'social_operating_decisions';

type GoalRow = { id: string; tenant_id: string; program_id: string; goal_id: string; version: number; input_fingerprint: string; payload: BusinessContentGoal };
type DecisionRow = { id: string; tenant_id: string; program_id: string; decision_id: string; payload: DecisionRecord };

export function createSocialOperatingRepository(dataStore: DataStore) {
  return {
    async latestGoal(tenantId: string, programId: string): Promise<BusinessContentGoal | null> {
      const result = await dataStore.list<GoalRow>(GOALS, { where: { tenant_id: tenantId, program_id: programId }, sort: '-version', page: 1, perPage: 1 });
      return result.items[0]?.payload ?? null;
    },
    async getGoal(tenantId: string, programId: string, goalId: string, version?: number): Promise<BusinessContentGoal | null> {
      const where: Record<string, string | number> = { tenant_id: tenantId, program_id: programId, goal_id: goalId };
      if (version !== undefined) where.version = version;
      const result = await dataStore.list<GoalRow>(GOALS, { where, sort: '-version', page: 1, perPage: 1 });
      return result.items[0]?.payload ?? null;
    },
    async save(tenantId: string, goal: BusinessContentGoal, decision: DecisionRecord): Promise<void> {
      const storedDecision = await dataStore.create<DecisionRow>(DECISIONS, {
        tenant_id: tenantId, program_id: goal.programId, decision_id: decision.decisionId,
        subject_id: goal.goalId, subject_version: goal.version, outcome: decision.outcome,
        input_fingerprint: decision.inputFingerprint, payload: decision, decided_at: decision.decidedAt,
      });
      if (!storedDecision) throw new Error('decision_record_storage_unavailable');
      const storedGoal = await dataStore.create<GoalRow>(GOALS, {
        tenant_id: tenantId, program_id: goal.programId, goal_id: goal.goalId, version: goal.version,
        input_fingerprint: goal.inputFingerprint, status: goal.status, payload: goal, created_at: goal.createdAt,
      });
      if (!storedGoal) throw new Error('business_goal_storage_unavailable');
    },
    async getDecision(tenantId: string, programId: string, decisionId: string): Promise<DecisionRecord | null> {
      const result = await dataStore.list<DecisionRow>(DECISIONS, { where: { tenant_id: tenantId, program_id: programId, decision_id: decisionId }, page: 1, perPage: 1 });
      return result.items[0]?.payload ?? null;
    },
  };
}
