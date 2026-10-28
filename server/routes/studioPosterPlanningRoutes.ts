import { consumeDemoQuota } from '../lib/demo.js';
import { store } from '../storage/index.js';
import type { AuthLocals } from '../middleware/auth.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';
import { planStudioPoster, PosterPlanningError } from '../socialImage/studioPosterPlanning.js';
import { ImageQuotaResponseHandled } from '../socialImage/socialImageWorkflowCommands.js';
import { readTenantEnterpriseProfile } from './enterpriseProfileStore.js';
import { readSocialImageTask } from '../socialImage/socialImageTask.js';
export function createStudioPosterPlanningRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'enterpriseCtx'>) {
    return { registerPostFbPoster() {
            deps.studioRouter.post('/fb-poster', async (req, res) => {
                try {
                    const tenantId = (res.locals as AuthLocals).tenantId;
                    const result = await planStudioPoster({ store, tenantId, body: req.body || {}, enterpriseCtx: () => deps.enterpriseCtx(), enterpriseProfile: readTenantEnterpriseProfile, allowPaidCall: async () => {
                            if (req.body?.imageTaskId) {
                                const task = await readSocialImageTask(store, tenantId, String(req.body.imageTaskId));
                                if (!task) throw new Error('social_image_task_missing');
                            }
                            if (!await consumeDemoQuota(req, res, 'generation'))
                            throw new ImageQuotaResponseHandled(); return true; } });
                    res.setHeader('Cache-Control', 'private, no-store');
                    res.json(result);
                }
                catch (error) {
                    if (error instanceof ImageQuotaResponseHandled)
                        return;
                    if (error instanceof PosterPlanningError) {
                        res.status(error.status).json(error.body);
                        return;
                    }
                    const code = error instanceof Error && error.message.startsWith('social_image_') ? error.message : 'social_image_planning_failed';
                    res.status(503).json({ ok: false, code, error: error instanceof Error ? error.message : '策划失败' });
                }
            });
        } };
}
