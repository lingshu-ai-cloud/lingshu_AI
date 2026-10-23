import type { Router } from 'express';
import type { AuthLocals } from '../middleware/auth.js';
import type { DataStore } from '../storage/datastore.js';
import { compileSocialImageV3PaidPlan } from '../socialImage/socialImageFormalPlan.js';
import { SocialImageProductionRunError } from '../socialImage/socialImageProductionRun.js';
import { projectSocialImageProductionSnapshot } from '../socialImage/socialImageProductionRuntime.js';

/** A browser can request compilation, but only the server's persisted facts and plan are used. */
export function registerSocialImageFormalPlanRoutes(router: Router, store: DataStore): void {
  router.post('/tasks/:id/compile-paid-plan', async (req, res) => {
    try {
      const { tenantId } = res.locals as AuthLocals;
      const task = await compileSocialImageV3PaidPlan({ store, tenantId, taskId: req.params.id,
        expectedVersion: Number(req.body?.expectedVersion) });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, task, snapshot: projectSocialImageProductionSnapshot(task) });
    } catch (error) {
      const failure = error instanceof SocialImageProductionRunError ? error
        : new SocialImageProductionRunError('social_image_paid_plan_compile_failed', 503);
      res.status(failure.status).json({ ok: false, code: failure.code, error: failure.code });
    }
  });
}
