import { previewInformationScope } from '../assistantContext/previewInformationScope.js';
import type { Router } from 'express';
import { ZodError } from 'zod';
import { isBusinessScene } from '../../shared/contracts/assistantBusinessScene.js';
import type { AuthLocals } from '../middleware/auth.js';
import { enforceSupportSessionReadOnly } from '../middleware/auth.js';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';
import { businessSceneOptions, type BusinessSceneScope } from '../assistantContext/businessScenes/service.js';
import { BusinessSceneError } from '../assistantContext/businessScenes/readScope.js';
import { platformRewriteService } from '../scripts/platformRewrite.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { dailyFollowups } from '../assistantContext/businessScenes/dailyFollowups.js';
export function registerAssistantBusinessScenes(router: Router) {
  const scope = async (req: Parameters<typeof requestOrganizationRoleStrict>[0], locals: AuthLocals): Promise<BusinessSceneScope> => ({ tenantId: locals.tenantId, userId: locals.userId,
    role: locals.browserReadRole ?? await requestOrganizationRoleStrict(req, locals.userId) });
  const fail = (res: import('express').Response, error: unknown) => res.status(error instanceof BusinessSceneError ? error.status : error instanceof ZodError ? 400 : 503).json({
    error: error instanceof BusinessSceneError ? error.code : error instanceof ZodError ? 'scene_input_invalid' : 'scene_unavailable',
    message: error instanceof BusinessSceneError ? error.message : error instanceof ZodError ? '请补齐有效的对象和查询条件。' : '场景资料暂时无法核验，请稍后重试。',
  });
  router.get('/business-scene-options', async (req, res) => {
    if (typeof req.query.sceneId !== 'string' || !isBusinessScene(req.query.sceneId)) { res.status(400).json({ error: 'scene_input_invalid' }); return; }
    try { res.json(await businessSceneOptions(await scope(req.headers.authorization, res.locals as AuthLocals), req.query.sceneId)); }
    catch (error) { fail(res, error); }
  });
  router.get('/daily-followups', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await dailyFollowups(await scope(req.headers.authorization, res.locals as AuthLocals))); }
    catch (error) { fail(res, error); }
  });
  router.post('/platform-rewrite', enforceSupportSessionReadOnly, previewInformationScope, async (req, res) => {
    try {
      const current = await scope(req.headers.authorization, res.locals as AuthLocals);
      if (!await consumeDemoQuota(req, res, 'aiChat')) return;
      res.json(await platformRewriteService.generate(current, req.body));
    } catch (error) { fail(res, error); }
  });
  router.post('/platform-rewrite/save', enforceSupportSessionReadOnly, async (req, res) => {
    try { res.json(await platformRewriteService.save(await scope(req.headers.authorization, res.locals as AuthLocals), req.body)); }
    catch (error) { fail(res, error); }
  });
}
