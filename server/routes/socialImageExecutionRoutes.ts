import {entitlementGate} from '../middleware/subscription.js';
import { socialImageRunId } from '../socialImage/socialImageProductionHash.js';
import type { Router } from 'express';
import { z } from 'zod';
import type { AuthLocals } from '../middleware/auth.js';
import type { DataStore } from '../storage/datastore.js';
import { enqueueImageExecution, imageExecutionReceipt, readImageExecutionJob } from '../socialImage/socialImageExecutionQueue.js';
import { readSocialImageTask } from '../socialImage/socialImageTask.js';
import { SocialImageProductionRunError } from '../socialImage/socialImageProductionRun.js';
const admission = z.object({ expectedVersion: z.number().int().positive() }).strict();
export function registerSocialImageExecutionRoutes(router: Router, store: DataStore) {
    router.post('/tasks/:id/execution', entitlementGate(), async (req, res) => {
        const parsed = admission.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ ok: false, code: 'social_image_execution_input_invalid', error: '缺少有效任务版本' });
            return;
        }
        try {
            const { tenantId, userId } = res.locals as AuthLocals;
            const result = await enqueueImageExecution({ store, tenantId, userId, taskId: req.params.id, ...parsed.data });
            res.setHeader('Cache-Control', 'private, no-store');
            res.status(202).json({ ok: true, ...result });
        }
        catch (error) {
            const failure = error instanceof SocialImageProductionRunError ? error : new SocialImageProductionRunError('social_image_queue_admission_failed', 503);
            res.status(failure.status).json({ ok: false, code: failure.code, error: failure.code });
        }
    });
    router.get(['/tasks/:id/execution', '/content-tasks/:contentId/execution'], async (req, res) => {
        try {
            const { tenantId } = res.locals as AuthLocals;
            const task = await readSocialImageTask(store, tenantId, req.params.contentId ? socialImageRunId(tenantId, req.params.contentId) : req.params.id);
            if (!task || (req.params.contentId && task.productionRuntime?.binding?.contentTaskId !== req.params.contentId)) {
                res.status(404).json({ ok: false, code: 'social_image_task_missing' });
                return;
            }
            const job = await readImageExecutionJob(store, tenantId, task);
            res.setHeader('Cache-Control', 'private, no-store');
            res.json({ ok: true, task, execution: job ? imageExecutionReceipt(job) : null });
        }
        catch {
            res.status(503).json({ ok: false, code: 'social_image_queue_read_failed', error: '调度回执读取失败' });
        }
    });
}
