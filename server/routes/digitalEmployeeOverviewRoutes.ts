import { type AuthLocals } from '../middleware/auth.js';
import { readTenantEnterpriseProfile } from './enterprise.js';
import { listConnectedPublishingAccounts } from '../digitalEmployees/publishingTargets.js';
import { isDigitalEmployeeOperatingGoal } from '../digitalEmployees/overviewGoalScope.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, type GoalRecord, type StoredRecord } from '../digitalEmployees/records.js';
import type { DigitalEmployeeApplicationPorts } from '../digitalEmployees/applicationPorts.js';

export function createDigitalEmployeeOverviewRoutes(deps: Pick<DigitalEmployeeApplicationPorts, 'digitalEmployeesRouter' | 'tenantRecord' | 'weeklyGoalFactRebuildTargetCommitted' | 'buildOverview'>) {
  const digitalEmployeesRouter = deps.digitalEmployeesRouter;

  function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
    return deps.tenantRecord<T>(collection, id, tenantId);
  }

  const weeklyGoalFactRebuildTargetCommitted: DigitalEmployeeApplicationPorts['weeklyGoalFactRebuildTargetCommitted'] = (...args) => deps.weeklyGoalFactRebuildTargetCommitted(...args);

  const buildOverview: DigitalEmployeeApplicationPorts['buildOverview'] = (...args) => deps.buildOverview(...args);

  function registerGetPublishingAccounts() {
    digitalEmployeesRouter.get('/publishing-accounts', async (_req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const enterprise = await readTenantEnterpriseProfile(tenantId);
      res.json({ items: await listConnectedPublishingAccounts(tenantId, enterprise.company.name) });
    });
  }

  function registerGetOverview() {
    digitalEmployeesRouter.get('/overview', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const goalId = String(req.query.goalId || '').trim();
      if (goalId) {
        const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, goalId, tenantId);
        if (!goal || !isDigitalEmployeeOperatingGoal(goal) || !await weeklyGoalFactRebuildTargetCommitted(tenantId, goal)) {
          res.status(404).json({ error: 'goal_not_found' }); return;
        }
      }
      const startsAt = String(req.query.startsAt || '').trim();
      const endsAt = String(req.query.endsAt || '').trim();
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      const requestedRange = startsAt && endsAt && datePattern.test(startsAt) && datePattern.test(endsAt) && startsAt <= endsAt
        ? { startsAt, endsAt }
        : undefined;
      res.json(await buildOverview(tenantId, goalId, requestedRange));
    });
  }

  return { registerGetPublishingAccounts, registerGetOverview };
}
