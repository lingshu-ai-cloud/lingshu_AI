import type { Router } from 'express';
import type { AuthLocals } from '../middleware/auth.js';
import type { WeeklyReviewApplication } from '../digitalEmployees/weeklyReviewApplication.js';
import { reviewTodoService } from '../digitalEmployees/reviewTodos.js';

interface WeeklyReviewRouteDependencies {
  application: Pick<WeeklyReviewApplication, 'generateRunReview'>;
  buildOverview(tenantId: string, goalId?: string): Promise<unknown>;
}

export function registerWeeklyReviewGenerationRoutes(digitalEmployeesRouter: Router, deps: WeeklyReviewRouteDependencies): void {
  const { generateRunReview } = deps.application;
  const { buildOverview } = deps;
  digitalEmployeesRouter.post('/runs/:runId/reviews/generate', async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    try {
      const { goal } = await generateRunReview(tenantId, userId, req.params.runId);
      res.json(await buildOverview(tenantId, goal.id));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'review_generation_failed';
      res.status(code === 'run_not_found' ? 404 : 409).json({ error: code });
    }
  });
  digitalEmployeesRouter.post('/reviews/generate', async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const runId = String(req.body?.runId || '').trim();
    if (!runId) { res.status(400).json({ error: 'run_id_required' }); return; }
    try {
      const { goal } = await generateRunReview(tenantId, userId, runId);
      res.json(await buildOverview(tenantId, goal.id));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'review_generation_failed';
      res.status(code === 'run_not_found' ? 404 : 409).json({ error: code });
    }
  });
}

export function registerReviewTodoRoutes(digitalEmployeesRouter: Router, application: Pick<WeeklyReviewApplication, 'allocateReviewTodos'>,
  service: Pick<typeof reviewTodoService, 'get' | 'save' | 'dispatch'> = reviewTodoService): void {
  const { allocateReviewTodos } = application;
  digitalEmployeesRouter.get('/review-todos', async (req, res) => {
    try { res.json(await service.get((res.locals as AuthLocals).tenantId, typeof req.query.week === 'string' ? req.query.week : undefined)); }
    catch (error) { res.status(503).json({ error: (error as Error).message }); }
  });
  digitalEmployeesRouter.put('/review-todos', async (req, res) => {
    try { res.json(await service.save((res.locals as AuthLocals).tenantId, req.body, (res.locals as AuthLocals).userId)); }
    catch (error) { res.status(409).json({ error: (error as Error).message }); }
  });
  digitalEmployeesRouter.post('/review-todos/dispatch', async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    try { res.json(await service.dispatch(tenantId, userId, String(req.body.week || ''), allocateReviewTodos, Number(req.body.revision))); }
    catch (error) { res.status(409).json({ error: (error as Error).message }); }
  });
}
