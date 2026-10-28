import {entitlementGate} from '../middleware/subscription.js';
import { socialImageRunId } from '../socialImage/socialImageProductionHash.js';
import type { Router } from 'express';
import { z } from 'zod';
import type { AuthLocals } from '../middleware/auth.js';
import type { DataStore } from '../storage/datastore.js';
import { enqueueImageExecution, imageExecutionReceipt, readImageExecutionJob } from '../socialImage/socialImageExecutionQueue.js';
import { readSocialImageTask } from '../socialImage/socialImageTask.js';
import { SocialImageProductionRunError } from '../socialImage/socialImageProductionRun.js';
import { controlContentExecutionJob } from '../contentExecution/durableQueue.js';
import { confirmReferenceProduct } from '../socialImage/socialImageReferenceProductCheck.js';
import type { readSocialImageReferenceBytes } from '../socialImage/socialImageReferenceBytes.js';
const admission = z.object({ expectedVersion: z.number().int().positive() }).strict();
const referenceCheck = admission.extend({ decision: z.literal('auto') }).strict();
export function registerSocialImageExecutionRoutes(router: Router, store: DataStore, ports: { readReference?: typeof readSocialImageReferenceBytes } = {}) {
    router.post('/tasks/:id/reference-product-check', async (req, res) => {
        const parsed = referenceCheck.safeParse(req.body);
        if (!parsed.success) { res.status(400).json({ ok: false, code: 'social_image_reference_check_invalid' }); return; }
        try {
            const { tenantId, userId } = res.locals as AuthLocals;
            const task = await confirmReferenceProduct({ store, tenantId, userId, taskId: req.params.id, ...parsed.data, ...ports });
            res.setHeader('Cache-Control', 'private, no-store'); res.json({ ok: true, task });
        } catch (error) {
            const failure = error instanceof SocialImageProductionRunError ? error : new SocialImageProductionRunError('social_image_reference_check_failed', 503);
            res.status(failure.status).json({ ok: false, code: failure.code, error: failure.code });
        }
    });
    router.post('/tasks/:id/execution', entitlementGate(), async (req, res) => {
        const parsed = admission.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ ok: false, code: 'social_image_execution_input_invalid', error: '缺少有效任务版本' });
            return;
        }
        try {
            const { tenantId, userId } = res.locals as AuthLocals;
            const result = await enqueueImageExecution({ store, tenantId, userId, taskId: req.params.id, ...parsed.data, ...ports });
            res.setHeader('Cache-Control', 'private, no-store');
            res.status(202).json({ ok: true, ...result });
        }
        catch (error) {
            const failure = error instanceof SocialImageProductionRunError ? error : new SocialImageProductionRunError(
                error instanceof Error && /local_store_atomic_lock_busy_reconciliation_required|durable_lease_storage_unavailable/.test(error.message)
                    ? 'local_store_reconciliation_required' : 'social_image_queue_admission_failed', 503);
            const reason = failure.code === 'social_image_reference_bytes_unreadable' ? '参考图暂时无法使用，请重新选择。'
                : failure.code === 'social_image_reference_product_confirmation_required' ? '暂时无法判断图片中是否有产品，请重新确认。'
                : failure.code === 'social_image_reference_product_shoot_required' ? '参考图中未发现产品，请拍摄并上传包含产品的图片后继续。' : failure.code;
            res.status(failure.status).json({ ok: false, code: failure.code, error: reason });
        }
    });
    router.post('/tasks/:id/execution/retry', entitlementGate(), async (req, res) => {
        const parsed = admission.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ ok: false, code: 'social_image_execution_input_invalid', error: '缺少有效任务版本' });
            return;
        }
        try {
            const { tenantId } = res.locals as AuthLocals;
            const task = await readSocialImageTask(store, tenantId, req.params.id);
            if (!task) throw new SocialImageProductionRunError('social_image_task_missing', 404);
            if (task.version !== parsed.data.expectedVersion)
                throw new SocialImageProductionRunError('social_image_version_conflict', 409);
            const job = await readImageExecutionJob(store, tenantId, task);
            if (!job) throw new SocialImageProductionRunError('social_image_execution_missing', 404);
            const retried = await controlContentExecutionJob({ dataStore: store, tenantId, jobId: job.id, action: 'retry' });
            res.setHeader('Cache-Control', 'private, no-store');
            res.status(202).json({ ok: true, task, execution: imageExecutionReceipt(retried) });
        }
        catch (error) {
            const known = error instanceof SocialImageProductionRunError ? error : null;
            const message = error instanceof Error ? error.message : '';
            const retryConflict = /content_execution_job_(not_retryable|control_busy|original_worker_not_settled)/.test(message);
            const failure = known || new SocialImageProductionRunError(retryConflict
                ? 'social_image_execution_retry_conflict' : 'social_image_execution_retry_failed', retryConflict ? 409 : 503);
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
