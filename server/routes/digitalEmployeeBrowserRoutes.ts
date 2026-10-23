import { productionQualitySummary } from '../digitalEmployees/productionQualitySummary.js';
import { buildDeliveryResources } from '../digitalEmployees/deliveryResources.js';
import { buildTaskDeepLink, type WorkflowTask } from '../../src/lib/digitalEmployees.js';
import { type Response } from 'express';
import { agentBrowserSessions, browserExecutionEnabled, type BrowserScope, type BrowserProductionTarget } from '../digitalEmployees/browserSessions.js';
import { listRunEventsAfter } from '../digitalEmployees/runEventReplay.js';
import { type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { currentDataAuthority } from '../storage/dataAuthority.js';
import { contentPlanCoverage } from '../digitalEmployees/contentBatchPlan.js';
import { goalInput } from '../digitalEmployees/overviewProjection.js';
import { getCustomerSegmentMembers } from '../digitalEmployees/customerWorkflow.js';
import { normalizeDigitalEmployeeConfig } from '../digitalEmployees/domain.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type EventRecord, type GoalRecord, type RunRecord, type StoredRecord, type TaskRecord } from '../digitalEmployees/records.js';
import type { DigitalEmployeeApplicationPorts } from '../digitalEmployees/applicationPorts.js';

export function createDigitalEmployeeBrowserRoutes(deps: Pick<DigitalEmployeeApplicationPorts, 'appendEvent' | 'tenantRecord' | 'first' | 'digitalEmployeesRouter' | 'configForTenant' | 'streamClients' | 'sendEvent'>) {
  const appendEvent: DigitalEmployeeApplicationPorts['appendEvent'] = (...args) => deps.appendEvent(...args);

  function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
    return deps.tenantRecord<T>(collection, id, tenantId);
  }

  function first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort = '-created_at'): Promise<T | null> {
    return deps.first<T>(collection, where, sort);
  }

  const digitalEmployeesRouter = deps.digitalEmployeesRouter;

  const configForTenant: DigitalEmployeeApplicationPorts['configForTenant'] = (...args) => deps.configForTenant(...args);

  const streamClients = deps.streamClients;

  const sendEvent: DigitalEmployeeApplicationPorts['sendEvent'] = (...args) => deps.sendEvent(...args);

  function registerBrowserTelemetry() {
    agentBrowserSessions.setTelemetry(async (scope, action) => {
      await appendEvent({ ...scope, type: `agent.ui.${action.kind}`, summary: action.label,
        payload: { uiAction: { ...action, page: 'agent-task-workspace' }, source: 'browser_worker' } });
    });
  }

  async function browserTaskWorkspace(scope: BrowserScope): Promise<BrowserProductionTarget> {
    const [run, tasks] = await Promise.all([
      tenantRecord<RunRecord>(COLLECTION.runs, scope.runId, scope.tenantId),
      store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: scope.tenantId, run_id: scope.runId }, sort: 'sequence', perPage: 100 }),
    ]);
    const task = tasks.items.find(item => item.id === scope.taskId);
    if (!run || !task) throw new Error('task_run_not_found');
    const normalized = tasks.items.map(item => ({ ...item, business_refs: jsonObject(item.business_refs, []), depends_on: jsonObject(item.depends_on, []), output: jsonObject(item.output, {}) })) as WorkflowTask[];
    // Workspace lookup needs this task's delivery family, not the entire run.
    const families = [
      ['content_mode_routing', 'content_production', 'content_quality_gate'],
      ['followup_batch_draft', 'followup_batch_approval', 'followup_dispatch'],
    ];
    const family = families.find(keys => keys.includes(task.task_key));
    const workspaceTasks = normalized.filter(item => family ? family.includes(item.task_key) : item.id === task.id);
    const resources = await buildDeliveryResources(scope.tenantId, workspaceTasks, '');
    const linked = resources.filter(resource => resource.taskIds.includes(task.id));
    const selected = linked.find(resource => resource.column === 'active' && resource.link) || linked.find(resource => resource.link);
    const customerTask = task.agent_role === 'customer' || task.business_domain === 'customer';
    const mappedLink = buildTaskDeepLink(normalized.find(item => item.id === task.id)!, undefined, run.id);
    const page = customerTask ? 'conversion' : selected?.link?.page || mappedLink.page;
    const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, scope.tenantId);
    const projectId = page === 'smartAssets' && selected?.id.startsWith('studio_project:') ? selected.id.slice('studio_project:'.length) : undefined;
    const project = projectId ? await store.getById<StoredRecord>('studio_projects', projectId) : null;
    const spec = jsonObject<Record<string, unknown>>(project?.spec, {});
    const automation = jsonObject<Record<string, unknown>>(spec.automation, {});
    const taskRefs = jsonObject<Array<Record<string, unknown>>>(task.business_refs, []);
    const customerRef = taskRefs.find(ref => ref.type === 'customer');
    const scheduledRef = taskRefs.find(ref => ref.type === 'scheduled_task');
    let customerId = customerTask ? String(selected?.link?.businessRef.entityId || customerRef?.id || '') || undefined : undefined;
    if (customerTask && !customerId) {
      const segment = await first<StoredRecord & { tenant_id: string }>(COLLECTION.segments, { tenant_id: scope.tenantId, run_id: scope.runId }, '-version');
      if (segment) customerId = (await getCustomerSegmentMembers(scope.tenantId, segment.id)).find(member => member.membership === 'included')?.customer_id;
    }
    return { userId: goal?.owner_id || 'digital_employee_agent', projectId, customerId,
      ...(automation.stage === 'blocked' && automation.retryPolicy === 'input_required' ? { inputBlocker: String(automation.blocker || '请补充制作资料') } : {}),
      stage: String(automation.stage || ''), revision: String(project?.updated_at || task.updated_at),
      link: { page, view: mappedLink.view || selected?.link?.view,
        ...(page === 'smartAssets' && projectId ? { studioPanel: 'projects' as const } : {}),
        runId: scope.runId, taskId: scope.taskId,
        businessRef: { ...selected?.link?.businessRef, taskKey: task.task_key, ...(projectId ? { entityId: projectId } : customerId ? { entityId: customerId } : scheduledRef ? { entityId: String(scheduledRef.id) } : {}) } } };
  }

  async function executeInTaskBrowser<T>(input: { tenantId: string; run: RunRecord; task: TaskRecord }, label: string, action: () => Promise<T>): Promise<T> {
    if (!browserExecutionEnabled()) return action();
    // Request-driven runs inherit their authenticated authority. Background runs
    // default to PB, which fails closed instead of turning an unbound worker into
    // a local-fallback browser identity.
    const scope = { tenantId: input.tenantId, runId: input.run.id, taskId: input.task.id, dataAuthority: currentDataAuthority() ?? 'pocketbase' as const };
    const read = () => browserTaskWorkspace(scope);
    if (input.task.task_key === 'content_production') {
      const target = await read();
      const stageLabels: Record<string, string> = { script: '生成脚本', material_match: '匹配分镜素材', voice_subtitles: '生成配音与字幕', heygen: '生成数字人口播', render: '生成成片', quality: '检查成片质量' };
      label = target.projectId ? stageLabels[target.stage || ''] || label : '创建制作项目';
    }
    return agentBrowserSessions.perform(scope, read, label, action);
  }

  function registerGetRunsRunIdEvents() {
    digitalEmployeesRouter.get('/runs/:runId/events', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
      if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
      const after = Math.max(0, Number(req.query.after || 0));
      res.json({ events: await listRunEventsAfter<EventRecord>(tenantId, run.id, after) });
    });
  }

  function registerGetRunsRunIdTasksTaskIdWorkspace() {
    digitalEmployeesRouter.get('/runs/:runId/tasks/:taskId/workspace', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      try {
        const target = await browserTaskWorkspace({
          tenantId,
          runId: req.params.runId,
          taskId: req.params.taskId,
          dataAuthority: currentDataAuthority() ?? 'pocketbase',
        });
        const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId);
        const events = await listRunEventsAfter<EventRecord>(tenantId, req.params.runId, 0);
        const output = jsonObject<Record<string, any>>(task?.output, {});
        if (task?.task_key === 'content_mode_routing' && Array.isArray(output.orders)) {
          const [goal, configRecord] = await Promise.all([tenantRecord<GoalRecord>(COLLECTION.goals, task.goal_id, tenantId), configForTenant(tenantId)]);
          if (goal && configRecord) output.coverage = contentPlanCoverage(normalizeDigitalEmployeeConfig(jsonObject(configRecord.config, {})), goalInput(goal), output.orders.length);
        }
        if (target.projectId && task && ['content_production', 'content_quality_gate'].includes(task.task_key)) {
          const project = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', target.projectId, tenantId);
          if (project) output.production = productionQualitySummary(jsonObject<Record<string, any>>(project.spec, {}));
        }
        res.json({ link: target.link, stage: target.stage, task: task ? { id: task.id, task_key: task.task_key, title: task.title, status: task.status, blocker_reason: task.blocked_reason || task.blocker_reason, output } : null, events: events.filter(event => event.task_id === req.params.taskId).slice(-80) });
      } catch (error) {
        res.status(error instanceof Error && error.message === 'task_run_not_found' ? 404 : 500).json({ error: '无法加载任务工作页面' });
      }
    });
  }

  function registerGetRunsRunIdTasksTaskIdBrowserStream() {
    digitalEmployeesRouter.get('/runs/:runId/tasks/:taskId/browser-stream', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const scope = { tenantId, runId: req.params.runId, taskId: req.params.taskId, dataAuthority: currentDataAuthority() ?? 'pocketbase' as const };
      const [run, task] = await Promise.all([
        tenantRecord<RunRecord>(COLLECTION.runs, scope.runId, tenantId),
        tenantRecord<TaskRecord>(COLLECTION.tasks, scope.taskId, tenantId),
      ]);
      if (!run || !task || task.run_id !== run.id) { res.status(404).json({ error: 'task_run_not_found' }); return; }
      if (!browserExecutionEnabled()) { res.status(503).json({ error: '此环境尚未启用浏览器执行与直播' }); return; }
      res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      let closed = false;
      let unwatch: (() => void) | undefined;
      const heartbeat = setInterval(() => { if (!closed) res.write(': heartbeat\n\n'); }, 10_000);
      res.on('close', () => { closed = true; clearInterval(heartbeat); unwatch?.(); });
      try {
        unwatch = await agentBrowserSessions.watch(scope, () => browserTaskWorkspace(scope), packet => {
          // Slow viewers skip intermediate frames instead of accumulating video in RAM.
          if (!closed && (packet.type !== 'frame' || res.writableLength < 512_000)) res.write(`data: ${JSON.stringify(packet)}\n\n`);
        });
        if (closed) unwatch();
      } catch (error) {
        if (!closed) { res.write(`data: ${JSON.stringify({ type: 'status', state: 'error', message: error instanceof Error ? error.message : '浏览器直播启动失败' })}\n\n`); res.end(); }
      }
    });
  }

  function registerPostRunsRunIdTasksTaskIdBrowserRefresh() {
    digitalEmployeesRouter.post('/runs/:runId/tasks/:taskId/browser-refresh', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const scope = { tenantId, runId: req.params.runId, taskId: req.params.taskId, dataAuthority: currentDataAuthority() ?? 'pocketbase' as const };
      const [run, task] = await Promise.all([
        tenantRecord<RunRecord>(COLLECTION.runs, scope.runId, tenantId),
        tenantRecord<TaskRecord>(COLLECTION.tasks, scope.taskId, tenantId),
      ]);
      if (!run || !task || task.run_id !== run.id) { res.status(404).json({ error: 'task_run_not_found' }); return; }
      if (!browserExecutionEnabled()) { res.status(503).json({ error: '此环境尚未启用浏览器执行与直播' }); return; }
      try {
        const frame = await agentBrowserSessions.forceRefresh(scope, () => browserTaskWorkspace(scope));
        res.json({ refreshedAt: frame.capturedAt, sequence: frame.sequence });
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : '任务工作页面刷新失败' });
      }
    });
  }

  function registerPostRunsRunIdTasksTaskIdUiEvents() {
    digitalEmployeesRouter.post('/runs/:runId/tasks/:taskId/ui-events', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const expectedWorkerToken = process.env.AGENT_WORKER_TOKEN || (process.env.NODE_ENV === 'production' ? '' : 'lingshu-local-agent-worker-token');
      const suppliedWorkerToken = String(req.headers['x-agent-worker-token'] || '');
      if (!expectedWorkerToken) {
        res.status(503).json({ error: 'agent_worker_token_not_configured' });
        return;
      }
      if (suppliedWorkerToken !== expectedWorkerToken) {
        res.status(403).json({ error: 'agent_worker_auth_failed' });
        return;
      }
      const [run, task] = await Promise.all([
        tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId),
        tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId),
      ]);
      if (!run || !task || task.run_id !== run.id) {
        res.status(404).json({ error: 'task_run_not_found' });
        return;
      }
      const kind = String(req.body?.kind || '');
      const allowedKinds = new Set(['action_started', 'navigation', 'click', 'input', 'screenshot']);
      if (!allowedKinds.has(kind)) {
        res.status(400).json({ error: 'invalid_ui_event_kind', allowed: [...allowedKinds] });
        return;
      }
      const label = String(req.body?.label || '').trim().slice(0, 300);
      if (!label) {
        res.status(400).json({ error: 'ui_event_label_required' });
        return;
      }
      const page = String(req.body?.page || task.destination || '').trim().slice(0, 100);
      const rawScreenshotUrl = String(req.body?.screenshotUrl || '').trim().slice(0, 2000);
      const screenshotUrl = /^(https?:\/\/|\/api\/)/.test(rawScreenshotUrl) ? rawScreenshotUrl : '';
      if (kind === 'screenshot' && !screenshotUrl) {
        res.status(400).json({ error: 'trusted_screenshot_url_required' });
        return;
      }
      const finiteCoordinate = (value: unknown, maximum: number) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(0, Math.min(maximum, number)) : undefined;
      };
      const viewportWidth = finiteCoordinate(req.body?.viewportWidth, 100_000);
      const viewportHeight = finiteCoordinate(req.body?.viewportHeight, 100_000);
      const x = finiteCoordinate(req.body?.x, viewportWidth || 100);
      const y = finiteCoordinate(req.body?.y, viewportHeight || 100);
      if (kind === 'click' && (x === undefined || y === undefined || !viewportWidth || !viewportHeight)) {
        res.status(400).json({ error: 'ui_click_coordinates_required' });
        return;
      }
      const event = await appendEvent({
        tenantId,
        runId: run.id,
        taskId: task.id,
        type: `agent.ui.${kind}`,
        summary: label,
        payload: { uiAction: { kind, label, page, screenshotUrl, x, y, viewportWidth, viewportHeight } },
      });
      res.status(201).json(event);
    });
  }

  function registerGetRunsRunIdStream() {
    digitalEmployeesRouter.get('/runs/:runId/stream', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
      if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      const after = Math.max(0, Number(req.query.after || 0));
      const clients = streamClients.get(run.id) || new Set<Response>();
      clients.add(res);
      streamClients.set(run.id, clients);
      // Subscribe before reading persisted events; overlap is deduplicated by id
      // in the client, while events arriving during the read cannot fall in a gap.
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
      res.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(res);
        if (!clients.size) streamClients.delete(run.id);
      });
      try {
        const persisted = await listRunEventsAfter<EventRecord>(tenantId, run.id, after);
        for (const event of persisted.filter(item => Number(item.sequence) > after)) if (!res.destroyed) sendEvent(res, event);
      } catch { res.end(); }
    });
  }

  return { browserTaskWorkspace, executeInTaskBrowser, registerBrowserTelemetry, registerGetRunsRunIdEvents, registerGetRunsRunIdTasksTaskIdWorkspace, registerGetRunsRunIdTasksTaskIdBrowserStream, registerPostRunsRunIdTasksTaskIdBrowserRefresh, registerPostRunsRunIdTasksTaskIdUiEvents, registerGetRunsRunIdStream };
}
