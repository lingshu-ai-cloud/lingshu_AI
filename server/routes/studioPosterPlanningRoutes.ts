import { consumeDemoQuota } from '../lib/demo.js';
import { store } from '../storage/index.js';
import type { AuthLocals } from '../middleware/auth.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';
import { planStudioPoster, PosterPlanningError } from '../socialImage/studioPosterPlanning.js';
import { ImageQuotaResponseHandled } from '../socialImage/socialImageWorkflowCommands.js';
import { readTenantEnterpriseProfile } from './enterpriseProfileStore.js';
export function createStudioPosterPlanningRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'enterpriseCtx'>) {
    return { registerPostFbPoster() {
            deps.studioRouter.post('/fb-poster', async (req, res) => {
                try {
                    const result = await planStudioPoster({ store, tenantId: (res.locals as AuthLocals).tenantId, body: req.body || {}, enterpriseCtx: () => deps.enterpriseCtx(), enterpriseProfile: readTenantEnterpriseProfile, allowPaidCall: async () => { if (!await consumeDemoQuota(req, res, 'generation'))
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
                    res.status(503).json({ ok: false, code: 'social_image_planning_failed', error: error instanceof Error ? error.message : '策划失败' });
                }
            });
        } };
}
