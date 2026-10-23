import type { Router, Request, Response } from 'express';
import type { AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { jsonObject } from './digitalEmployeeRecords.js';
import type { DigitalEmployeeConfig } from '../digitalEmployees/domain.js';
import type { DirectorDecision, DirectorDecisionReason } from '../../src/lib/directorDecision.js';
import { TaskControlError, type TaskControlAction, type TaskInterventionApplication } from '../digitalEmployees/taskInterventionApplication.js';
import { controlContentExecutionJob, type ContentExecutionControlAction } from '../contentExecution/durableQueue.js';

interface TaskInterventionRouteDependencies {
  application: TaskInterventionApplication;
  queueDigitalEmployeeRunAdvance(tenantId: string, runId: string): void;
  buildOverview(tenantId: string, goalId?: string): Promise<unknown>;
  registerProductionBudgetRoute(): void;
}

export function registerTaskInterventionRoutes(digitalEmployeesRouter: Router, deps: TaskInterventionRouteDependencies): void {
  const { application, queueDigitalEmployeeRunAdvance, buildOverview } = deps;
  const { applyTaskControl } = application;
  async function handleTaskControl(req: Request, res: Response, forcedAction?: TaskControlAction): Promise<void> {
    const { tenantId, userId } = res.locals as AuthLocals;
    const action = forcedAction || String(req.body?.action || 'retry') as TaskControlAction;
    if (!['retry', 'skip', 'manual_complete', 'replan'].includes(action)) {
      res.status(400).json({ error: 'invalid_correction_action', allowed: ['retry', 'skip', 'manual_complete', 'replan'] });
      return;
    }
    const scope = forcedAction ? 'one_off' : String(req.body?.scope || '') as 'one_off' | 'rule_candidate';
    if (!['one_off', 'rule_candidate'].includes(scope)) {
      res.status(400).json({ error: 'invalid_correction_scope', allowed: ['one_off', 'rule_candidate'] });
      return;
    }
    const providedNote = String(req.body?.instruction || req.body?.note || '').trim().slice(0, 5000);
    if (!providedNote && (!forcedAction || ['skip', 'manual_complete'].includes(forcedAction))) {
      res.status(400).json({ error: forcedAction ? 'task_control_note_required' : 'correction_instruction_required' });
      return;
    }
    const allowedWorkflows = new Set<DigitalEmployeeConfig['enabledWorkflows'][number]>(['scheduled_social', 'viral_clone', 'product_content', 'material_content', 'content_publish', 'customer_segmentation', 'batch_followup']);
    const rawWorkflows = req.body?.enabledWorkflows;
    if (rawWorkflows !== undefined && (!Array.isArray(rawWorkflows) || rawWorkflows.some(item => !allowedWorkflows.has(String(item) as DigitalEmployeeConfig['enabledWorkflows'][number])))) {
      res.status(400).json({ error: 'invalid_enabled_workflows' });
      return;
    }
    const instruction = providedNote || (action === 'retry' ? '重试当前任务并重置下游' : '根据当前配置重新规划');
    try {
      const result = await applyTaskControl({
        tenantId, userId, taskId: req.params.taskId, action, scope, instruction,
        rerunDownstream: req.body?.rerunDownstream !== false,
        output: jsonObject<Record<string, unknown>>(req.body?.output, {}),
        businessRefs: Array.isArray(req.body?.businessRefs) ? req.body.businessRefs : undefined,
        enabledWorkflows: Array.isArray(rawWorkflows) ? rawWorkflows as DigitalEmployeeConfig['enabledWorkflows'] : undefined,
      });
      queueDigitalEmployeeRunAdvance(tenantId, result.runId);
      res.json(await buildOverview(tenantId, result.goalId));
    } catch (error) {
      if (error instanceof TaskControlError) {
        res.status(error.status).json({ error: error.message, ...error.details });
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : 'task_control_failed' });
    }
  }
  digitalEmployeesRouter.post('/tasks/:taskId/corrections', async (req, res) => handleTaskControl(req, res));
  digitalEmployeesRouter.post('/tasks/:taskId/director-decision', async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    try {
      const result = await application.decideDirectorDirection({
        tenantId, userId, taskId: req.params.taskId,
        decision: String(req.body?.decision || '') as DirectorDecision,
        reason: String(req.body?.reason || '') as DirectorDecisionReason,
        contentId: String(req.body?.contentId || ''), applyToSimilar: req.body?.applyToSimilar === true,
      });
      res.json(await buildOverview(tenantId, result.goalId));
    } catch (error) {
      if (error instanceof TaskControlError) { res.status(error.status).json({ error: error.message, ...error.details }); return; }
      throw error;
    }
  });
  deps.registerProductionBudgetRoute();
  digitalEmployeesRouter.post('/tasks/:taskId/retry', async (req, res) => handleTaskControl(req, res, 'retry'));
  digitalEmployeesRouter.post('/tasks/:taskId/skip', async (req, res) => handleTaskControl(req, res, 'skip'));
  digitalEmployeesRouter.post('/tasks/:taskId/complete', async (req, res) => handleTaskControl(req, res, 'manual_complete'));
  digitalEmployeesRouter.post('/execution-jobs/:jobId/:action', async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const action = String(req.params.action || '') as ContentExecutionControlAction;
    if (!['pause', 'cancel', 'resume', 'retry'].includes(action)) {
      res.status(400).json({ error: 'content_execution_control_invalid' });
      return;
    }
    try {
      await controlContentExecutionJob({
        dataStore: store, tenantId, jobId: String(req.params.jobId || ''), action,
      });
      res.json(await buildOverview(tenantId));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'content_execution_job_control_failed';
      const status = code === 'content_execution_job_not_found' ? 404
        : code.includes('not_') || code.endsWith('_invalid') ? 409 : 500;
      res.status(status).json({ error: code });
    }
  });
  digitalEmployeesRouter.post('/tasks/:taskId/evidence', async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    try {
      const result = await application.attachTaskEvidence({ tenantId, userId, taskId: req.params.taskId,
        businessRefs: Array.isArray(req.body?.businessRefs) ? req.body.businessRefs : undefined });
      res.json(await buildOverview(tenantId, result.goalId));
    } catch (error) {
      if (error instanceof TaskControlError) { res.status(error.status).json({ error: error.message, ...error.details }); return; }
      throw error;
    }
  });
}
