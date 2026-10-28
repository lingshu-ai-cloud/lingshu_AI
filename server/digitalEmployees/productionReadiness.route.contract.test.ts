import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const application = fs.readFileSync('server/routes/digitalEmployeePackageRoutes.ts', 'utf8');
const router = fs.readFileSync('server/routes/digitalEmployees.ts', 'utf8');
const assistant = fs.readFileSync('src/components/assistant/useAssistantSend.ts', 'utf8');

test('assistant reads tenant-scoped production readiness without starting or mutating a weekly plan', () => {
  const route = application.match(/function registerGetGoalsGoalIdProductionReadiness\(\) \{([\s\S]*?)\n  function registerGetPlanningOptions/);
  assert.ok(route, 'a dedicated read-only endpoint must exist');
  assert.match(route[1], /digitalEmployeesRouter\.get\('\/goals\/:goalId\/production-readiness'/);
  assert.match(route[1], /tenantRecord<GoalRecord>\(COLLECTION\.goals, req\.params\.goalId, tenantId\)/);
  assert.match(route[1], /readServerProductionOnboardingReadiness\(/);
  assert.match(route[1], /materialGaps: weeklyMaterialGaps\(plans, readiness\.materialRequirementGaps/);
  assert.match(route[1], /savedFactsVersion !== currentFactsVersion[\s\S]*weeklyGoalFactRebuildRecovery\(goal, plan, savedFactsVersion, currentFactsVersion\)/);
  assert.doesNotMatch(route[1], /store\.(?:create|update|delete)|approveGoal|generatePackageDetails|startRun/);
  assert.match(router, /registerGetGoalsGoalIdProductionReadiness\(\)/);
  assert.match(assistant, /weeklyProductionReadiness\(overview\.goal\.id\)/);
});
