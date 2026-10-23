import { registerStudioVariationBatchRoutes as mountVariationBatchRoutes } from './studioVariationBatchRoutes.js';
import { registerStudioPublishLinkRoutes as mountPublishLinkRoutes } from './studioPublishLinkRoutes.js';
import { createStudioProjectReadRouter } from './studioProjectReadRoutes.js';
import { createStudioProjectSaveRouter } from './studioProjectSaveRoutes.js';
import { createStudioProjectReviewRouter } from './studioProjectReviewRoutes.js';
import { store } from '../storage/index.js';
import { type AuthLocals } from '../middleware/auth.js';
import { listPublishRecords, recommendPublish, type PublishPlatform } from '../lib/publishHistory.js';

import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioProjectWorkspaceRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'loadMaterials' | 'storyboardKbAssignmentIssuesForSpec' | 'appendCompletedPosterMaterialUsage' | 'unpublishableGenerationReasons'>) {
  const studioRouter = deps.studioRouter;
  const loadMaterials: StudioApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const storyboardKbAssignmentIssuesForSpec: StudioApplicationPorts['storyboardKbAssignmentIssuesForSpec'] = (...args) => deps.storyboardKbAssignmentIssuesForSpec(...args);
  const appendCompletedPosterMaterialUsage: StudioApplicationPorts['appendCompletedPosterMaterialUsage'] = (...args) => deps.appendCompletedPosterMaterialUsage(...args);
  const unpublishableGenerationReasons: StudioApplicationPorts['unpublishableGenerationReasons'] = (...args) => deps.unpublishableGenerationReasons(...args);

  function registerStudioProjectReadRouter() {
    studioRouter.use('/projects', createStudioProjectReadRouter(loadMaterials, store));
  }

  function registerStudioProjectSaveRouter() {
    studioRouter.use('/projects', createStudioProjectSaveRouter({
      dataStore: store,
      loadMaterials,
      kbAssignmentIssues: storyboardKbAssignmentIssuesForSpec,
      appendCompletedPosterMaterialUsage,
      unpublishableGenerationReasons,
    }));
  }

  function registerStudioProjectReviewRouter() {
    studioRouter.use('/projects', createStudioProjectReviewRouter(store));
  }

  function registerStudioVariationBatchRoutes() {
    mountVariationBatchRoutes(studioRouter);
  }

  function registerGetPublishRecords() {
    studioRouter.get('/publish-records', (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      res.json(listPublishRecords(tenantId, req.query.accountId ? String(req.query.accountId) : undefined));
    });
  }

  function registerPostPublishRecommendations() {
    studioRouter.post('/publish-recommendations', (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];
      const recommendations = targets
        .filter((target: any) => ['youtube', 'tiktok', 'instagram', 'facebook'].includes(String(target?.platform)))
        .map((target: any) => ({
          accountId: String(target.accountId || ''),
          platform: String(target.platform),
          ...recommendPublish({
            tenantId,
            platform: String(target.platform) as PublishPlatform,
            accountId: String(target.accountId || ''),
            videoPath: String(req.body?.videoPath || ''),
            projectId: req.body?.projectId ? String(req.body.projectId) : undefined,
            generationVersionId: req.body?.generationVersionId ? String(req.body.generationVersionId) : undefined,
            title: String(req.body?.title || ''),
            ratio: req.body?.ratio ? String(req.body.ratio) : undefined,
            language: req.body?.language ? String(req.body.language) : undefined,
          }),
        }));
      res.json({ recommendations });
    });
  }

  function registerStudioPublishLinkRoutes() {
    mountPublishLinkRoutes(studioRouter);
  }

  return { registerStudioProjectReadRouter, registerStudioProjectSaveRouter, registerStudioProjectReviewRouter, registerStudioVariationBatchRoutes, registerGetPublishRecords, registerPostPublishRecommendations, registerStudioPublishLinkRoutes };
}
