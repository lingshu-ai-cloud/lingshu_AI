import type { Router } from 'express';
import { createHash } from 'node:crypto';
import type { AuthLocals } from '../middleware/auth.js';
import type { DataStore } from '../storage/datastore.js';
import { readSocialImageTask } from '../socialImage/socialImageTask.js';
import { socialImageV3PaidPrerequisiteIssue } from '../socialImage/socialImagePaidPrerequisites.js';
import { SocialImagePaidJobError } from '../socialImage/socialImagePaidJob.js';
import { abandonSocialImageMultiUnitPlan, persistSocialImageMultiUnitPlan } from '../socialImage/socialImageDurablePlan.js';
import { compileSocialImageV3PaidPlan } from '../socialImage/socialImageFormalPlan.js';
import { SocialImageProductionRunError } from '../socialImage/socialImageProductionRun.js';
import { projectSocialImageProductionSnapshot } from '../socialImage/socialImageProductionRuntime.js';

/** A browser can request compilation, but only the server's persisted facts and plan are used. */
export function registerSocialImageFormalPlanRoutes(
  router: Router, store: DataStore, readProductBytes: (tenantId: string, productId: string) => Promise<Buffer | null>,
): void {
  /** Persist bounded multi-output units before any paid call. */
  router.post('/tasks/:id/plan-units', async (req, res) => {
    try {
      const { tenantId } = res.locals as AuthLocals;
      const expectedVersion = Number(req.body?.expectedVersion);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) { res.status(400).json({ ok: false, error: '缺少有效任务版本' }); return; }
      const current = await readSocialImageTask(store, tenantId, req.params.id);
      if (!current) { res.status(404).json({ ok: false, code: 'social_image_task_missing', error: '图片任务不存在' }); return; }
      const gate = socialImageV3PaidPrerequisiteIssue(current, 'queue');
      if (gate) { res.status(422).json({ ok: false, code: gate, error: '图片证据和编导方案尚未完成，不会冻结付费计划' }); return; }
      const productHashes: Record<string, string> = {};
      for (const id of current.contentBrief.productRefs) {
        const bytes = await readProductBytes(tenantId, id);
        if (!bytes?.length) throw new SocialImagePaidJobError('social_image_product_asset_unavailable');
        productHashes[id] = createHash('sha256').update(bytes).digest('hex');
      }
      let task = await persistSocialImageMultiUnitPlan({ store, tenantId, taskId: req.params.id, expectedVersion, productHashes });
      if (task.schemaVersion === 'social-image-creation.v3') task = await compileSocialImageV3PaidPlan({ store, tenantId,
        taskId: task.id, expectedVersion: task.version });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, task, paidExecutionEnabled: task.imageType === 'carousel' || task.imageType === 'gif_poster' });
    } catch (error) {
      const code = error instanceof SocialImagePaidJobError || error instanceof SocialImageProductionRunError
        ? error.code : 'social_image_plan_failed';
      const status = error instanceof SocialImageProductionRunError ? error.status
        : code === 'social_image_task_missing' ? 404 : code === 'social_image_atomic_store_required' ? 503 : 409;
      res.status(status).json({ ok: false, code, error: '多图单元计划无法安全持久化；未调用图片供应商' });
    }
  });

  /** Explicitly retire only known, non-running units; never infer a provider outcome. */
  router.post('/tasks/:id/abandon-plan', async (req, res) => {
    try {
      const { tenantId } = res.locals as AuthLocals;
      const expectedVersion = Number(req.body?.expectedVersion);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
        res.status(400).json({ ok: false, error: '缺少有效任务版本' }); return;
      }
      const task = await abandonSocialImageMultiUnitPlan({ store, tenantId, taskId: req.params.id, expectedVersion });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ ok: true, task });
    } catch (error) {
      const code = error instanceof SocialImagePaidJobError ? error.code : 'social_image_plan_abandon_failed';
      const status = code === 'social_image_task_missing' ? 404 : code === 'social_image_atomic_store_required' ? 503 : 409;
      res.status(status).json({ ok: false, code, error: '当前轮播/GIF 计划存在未确认的付费结果或版本冲突，未废弃计划' });
    }
  });

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
