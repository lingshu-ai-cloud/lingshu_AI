import { Router, type RequestHandler } from 'express';
import { requireAuth, enforceSupportSessionReadOnly, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';
import { createSocialProgramService, SocialProgramError } from '../socialPrograms/service.js';
import { createWeeklyOperatingPackageService } from '../socialPrograms/weeklyOperatingPackages.js';

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function createSocialProgramsRouter(dataStore: DataStore = store, authenticate = true): Router {
  const router = Router();
  if (authenticate) router.use(requireAuth, enforceSupportSessionReadOnly);
  const service = createSocialProgramService(dataStore);
  const weeklyPackages = createWeeklyOperatingPackageService(dataStore);

  router.get('/', asyncRoute(async (_req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ items: await service.listPrograms(tenantId) });
  }));

  router.post('/', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.createProgram(tenantId, userId, req.body || {});
    res.status(201).json({ item });
  }));

  router.get('/:programId', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ item: await service.getProgram(tenantId, String(req.params.programId || '')) });
  }));

  router.patch('/:programId', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.updateProgram(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.json({ item });
  }));

  router.get('/:programId/accounts', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ items: await service.listAccounts(tenantId, String(req.params.programId || '')) });
  }));

  router.post('/:programId/accounts', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.createAccount(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.status(201).json({ item });
  }));

  router.put('/:programId/accounts/:accountId/playbook', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.savePlaybook(
      tenantId, userId, String(req.params.programId || ''), String(req.params.accountId || ''), req.body || {},
    );
    res.status(201).json({ item });
  }));

  router.post('/:programId/plans/monthly', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.saveMonthlyPlan(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.status(201).json({ item });
  }));

  router.post('/:programId/plans/weekly', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.saveWeeklyPlan(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.status(201).json({ item });
  }));

  router.get('/:programId/operating-packages', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const items = await weeklyPackages.list(
      tenantId,
      String(req.params.programId || ''),
      typeof req.query.weekStart === 'string' ? req.query.weekStart : undefined,
    );
    res.json({ items });
  }));

  router.post('/:programId/operating-packages', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await weeklyPackages.create(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.status(201).json({ item });
  }));

  router.get('/:programId/operating-packages/:packageId', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const item = await weeklyPackages.get(
      tenantId, String(req.params.programId || ''), String(req.params.packageId || ''),
    );
    res.json({ item });
  }));

  router.put('/:programId/operating-packages/:packageId', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await weeklyPackages.revise(
      tenantId, userId, String(req.params.programId || ''), String(req.params.packageId || ''), req.body || {},
    );
    res.status(201).json({ item });
  }));

  router.post('/:programId/operating-packages/:packageId/activate', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await weeklyPackages.activate(
      tenantId, userId, String(req.params.programId || ''), String(req.params.packageId || ''), req.body || {},
    );
    res.json({ item });
  }));

  router.use(((error, _req, res, next) => {
    if (!(error instanceof SocialProgramError)) {
      next(error);
      return;
    }
    res.status(error.status).json({ error: error.code, message: error.message });
  }) as import('express').ErrorRequestHandler);

  return router;
}

export const socialProgramsRouter = createSocialProgramsRouter();
