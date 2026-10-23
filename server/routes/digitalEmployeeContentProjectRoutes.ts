import { reviseContent } from '../digitalEmployees/contentRevision.js';
import { automationBgmCatalog } from './studioBgmCatalog.js';
import { spokenLanguageMatches } from '../../shared/contracts/videoCreationPlan.js';
import { invalidatePublishingApprovalForProject, invalidatePublishingAuthorizationForRun } from '../digitalEmployees/publishingExecution.js';
import { contentAcceptanceHash, contentAccepted } from '../digitalEmployees/contentAcceptance.js';
import fs from 'node:fs';
import path from 'node:path';
import { type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { signAssetUrl } from '../lib/assetAccess.js';
import { freezeStoryboardNarration, CONTENT_SCRIPT_QUALITY_RULE_VERSION } from '../digitalEmployees/contentProduction.js';
import { contentProjectLineageFields } from '../digitalEmployees/contentProjectLineage.js';
import { withDigitalEmployeeRunLock } from '../digitalEmployees/runControl.js';
import { studioProjectRendered } from '../digitalEmployees/taskEvidenceProjection.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type PlanRecord, type RunRecord, type StoredRecord, type TaskRecord } from '../digitalEmployees/records.js';
import type { DigitalEmployeeApplicationPorts } from '../digitalEmployees/applicationPorts.js';

export function createDigitalEmployeeContentProjectRoutes(deps: Pick<DigitalEmployeeApplicationPorts, 'digitalEmployeesRouter' | 'tenantRecord' | 'appendAudit' | 'appendAuthorizationRequiredEvent' | 'advanceRun' | 'buildOverview'>) {
  const digitalEmployeesRouter = deps.digitalEmployeesRouter;

  function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
    return deps.tenantRecord<T>(collection, id, tenantId);
  }

  const appendAudit: DigitalEmployeeApplicationPorts['appendAudit'] = (...args) => deps.appendAudit(...args);

  const appendAuthorizationRequiredEvent: DigitalEmployeeApplicationPorts['appendAuthorizationRequiredEvent'] = (...args) => deps.appendAuthorizationRequiredEvent(...args);

  const advanceRun: DigitalEmployeeApplicationPorts['advanceRun'] = (...args) => deps.advanceRun(...args);

  const buildOverview: DigitalEmployeeApplicationPorts['buildOverview'] = (...args) => deps.buildOverview(...args);

  function registerGetContentProjectsProjectIdProduction() {
    digitalEmployeesRouter.get('/content-projects/:projectId/production', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const project = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', req.params.projectId, tenantId);
      if (!project) { res.status(404).json({ error: 'project_not_found' }); return; }
      const spec = jsonObject<Record<string, any>>(project.spec, {});
      const outputPath = String(spec.automation?.renderOutputPath || spec.renderOutputPath || '').trim();
      const assetRoot = path.resolve(process.cwd(), 'data', 'publishing-uploads', tenantId.replace(/[^\w.-]+/g, '-'));
      const resolvedOutput = outputPath ? path.resolve(outputPath) : '';
      const outputAccessible = Boolean(resolvedOutput && fs.existsSync(assetRoot) && fs.existsSync(resolvedOutput)
        && fs.statSync(resolvedOutput).isFile() && path.dirname(resolvedOutput) === assetRoot
        && path.dirname(fs.realpathSync(resolvedOutput)) === fs.realpathSync(assetRoot));
      const videoUrl = outputAccessible
        ? signAssetUrl(`/api/overseas/publishing/local-videos/${encodeURIComponent(path.basename(resolvedOutput))}`, tenantId)
        : '';
      const hash = contentAcceptanceHash(spec);
      res.json({ projectId: project.id, hash, videoUrl, approved: contentAccepted(spec), qualityPassed: spec.automation?.quality?.passed === true, spec: { lang: spec.lang, duration: spec.duration, voice: spec.contentOrder?.videoPlan?.voice || spec.voice, voiceStyle: spec.voiceStyle, voiceoverUrl: spec.voiceoverUrl, bgm: spec.bgm, bgmVol: spec.bgmVol, bgmSelection: spec.bgmSelection, voiceSelection: spec.voiceSelection, scenePlan: spec.contentOrder?.videoPlan?.scenePlan, sceneSourcePlan: spec.sceneSourcePlan, materialIds: spec.automation?.routePlan?.assetIds || [], sceneOverrides: spec.sceneOverrides, cues: spec.alignedCuesByLang?.[spec.lang] || [], subtitleStyle: spec.subtitleStyle, subtitleAlignmentSource: spec.subtitleAlignmentSource, coverTitle: spec.coverTitle, coverFrameTime: spec.coverFrameTime, exportSpec: spec.exportSpec, ratio: spec.ratio, stage: spec.automation?.stage }, managed: spec.automation?.managedBy === 'digital_employee' });
    });
  }

  function registerPostContentProjectsProjectIdRevise() {
    digitalEmployeesRouter.post('/content-projects/:projectId/revise', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const original = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', req.params.projectId, tenantId);
      const initial = jsonObject<Record<string, any>>(original?.spec, {});
      if (!original || !initial.workflowRunId) { res.status(404).json({ error: 'project_not_found' }); return; }
      await withDigitalEmployeeRunLock(tenantId, initial.workflowRunId, async () => {
        try {
          const project = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', req.params.projectId, tenantId);
          const spec = jsonObject<Record<string, any>>(project?.spec, {});
          const run = await tenantRecord<RunRecord>(COLLECTION.runs, initial.workflowRunId, tenantId);
          if (!project || !run || run.status === 'cancelled' || spec.publishedAt || spec.publishingReceipt) { res.status(409).json({ error: '已发布或已取消的任务请复制为新计划' }); return; }
          const posted = await store.list<any>('posts', { where: { tenant_id: tenantId }, perPage: 500 });
          if (posted.items.some(post => { const stats=jsonObject<Record<string, any>>(post.stats, {}); return stats.sourceProjectId===project.id && ['published','partial'].includes(stats.status); })) { res.status(409).json({ error: '该项目已有真实发布结果，请复制为新计划' }); return; }
          if (req.body.hash !== contentAcceptanceHash(spec)) { res.status(409).json({ error: '后台已更新项目，请刷新后修改' }); return; }
          if (req.body.node === 'music' && req.body.values?.bgm && !automationBgmCatalog(tenantId).some(track => track.id === req.body.values.bgm)) throw Error('配乐不属于当前企业可用曲库');
          const next = reviseContent(spec, req.body.node, req.body.values || {});
          const now = new Date().toISOString();
          if (!await store.update('studio_projects', project.id, {
            status: 'draft', spec: next,
            ...contentProjectLineageFields({ tenantId, spec: next, current: project }),
            updated_at: now,
          })) throw Error('项目保存失败');
          await invalidatePublishingApprovalForProject(tenantId, project.id);
          const tasks = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 });
          for (const task of tasks.items.filter(t => ['content_production', 'content_quality_gate', 'weekly_review'].includes(t.task_key))) await store.update(COLLECTION.tasks, task.id, { status: 'pending', blocked_reason: '', output: {}, updated_at: now });
          await store.update(COLLECTION.runs, run.id, { status: 'running', current_controller: 'agent', completed_at: '', pause_reason: '' });
          if (run.goal_id) await store.update(COLLECTION.goals, run.goal_id, { status: 'active', updated_at: now });
          await appendAudit({ tenantId, userId, action: 'content.node_revised', targetType: 'studio_project', targetId: project.id, metadata: { node: req.body.node, version: next.automation.contentVersion } });
          res.json({ ok: true, stage: next.automation.stage });
        } catch (error) { res.status(400).json({ error: (error as Error).message }); }
      });
    });
  }

  function registerPostContentProjectsProjectIdNarration() {
    digitalEmployeesRouter.post('/content-projects/:projectId/narration', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const original = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', req.params.projectId, tenantId);
      const originalSpec = jsonObject<Record<string, any>>(original?.spec, {});
      if (!original || !originalSpec.workflowRunId) { res.status(404).json({ error: 'project_not_found' }); return; }
      await withDigitalEmployeeRunLock(tenantId, originalSpec.workflowRunId, async () => {
        const project = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', req.params.projectId, tenantId);
        const spec = jsonObject<Record<string, any>>(project?.spec, {});
        const run = await tenantRecord<RunRecord>(COLLECTION.runs, originalSpec.workflowRunId, tenantId);
        if (!project || !run || ['cancelled', 'succeeded'].includes(run.status) || project.status === 'published') { res.status(409).json({ error: '当前运行不能修改，请复制为新的制作计划' }); return; }
        if (req.body?.hash !== contentAcceptanceHash(spec)) { res.status(409).json({ error: '口播版本已变化，请刷新' }); return; }
        const lines = req.body?.lines;
        if (!Array.isArray(lines) || lines.length < 3 || lines.length > 8 || lines.some(line => typeof line !== 'string' || !line.trim() || /[\r\n]/.test(line)) || lines.join(' ').length > 5000 || !spokenLanguageMatches(lines.join(' '), String(spec.lang))) { res.status(400).json({ error: '请保留每段完整口播，使用制作计划的语言，总长不超过 5000 字符' }); return; }
        try {
          const script = freezeStoryboardNarration(String(spec.script || ''), lines.map(line => line.trim()));
          const now = new Date().toISOString();
          const nextSpec = { ...spec, script, narrationHistory: [...(Array.isArray(spec.narrationHistory) ? spec.narrationHistory : []), { script: spec.script, version: Number(spec.automation?.contentVersion || 1), changedAt: now }].slice(-20), contentAcceptance: null, productionDirection: null, subtitleAlignmentSource: '', voiceoverUrl: '', voiceoverDur: 0, alignedCuesByLang: {}, renderOutputPath: '', automation: { ...spec.automation, contentVersion: Number(spec.automation?.contentVersion || 1) + 1, stage: 'voice_subtitles', status: 'queued', blocker: '', narrationFeedback: '', narrationReviewPassed: false, heygenJobId: '', voiceLocalPath: '', quality: {}, renderOutputPath: '', renderedAt: '', completedAt: '' } };
          await store.update('studio_projects', project.id, {
            status: 'draft', updated_at: now, spec: nextSpec,
            ...contentProjectLineageFields({ tenantId, spec: nextSpec, current: project }),
          });
          await invalidatePublishingApprovalForProject(tenantId, project.id);
          const tasks = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 });
          for (const task of tasks.items.filter(task => ['content_production', 'content_quality_gate', 'weekly_review'].includes(task.task_key))) await store.update(COLLECTION.tasks, task.id, { status: 'pending', blocked_reason: '', output: {}, updated_at: now });
          await store.update(COLLECTION.runs, run.id, { status: 'running', current_controller: 'agent', completed_at: '', pause_reason: '' });
          if (run.goal_id) await store.update(COLLECTION.goals, run.goal_id, { status: 'active', updated_at: now });
          await appendAudit({ tenantId, userId, action: 'content.narration_revised', targetType: 'studio_project', targetId: project.id, metadata: { priorHash: contentAcceptanceHash(spec), version: Number(spec.automation?.contentVersion || 1) + 1 } });
          res.json({ ok: true });
        } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '口播修改失败' }); }
      });
    });
  }

  function registerPostContentProjectsProjectIdApprove() {
    digitalEmployeesRouter.post('/content-projects/:projectId/approve', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const initial = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', req.params.projectId, tenantId);
      if (!initial) { res.status(404).json({ error: 'project_not_found' }); return; }
      const initialSpec = jsonObject<Record<string, any>>(initial.spec, {});
      await withDigitalEmployeeRunLock(tenantId, initialSpec.workflowRunId || initial.id, async () => {
        const project = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', req.params.projectId, tenantId);
        if (!project) { res.status(404).json({ error: 'project_not_found' }); return; }
        const spec = jsonObject<Record<string, any>>(project.spec, {});
        if (spec.automation?.stage !== 'completed' || spec.automation?.quality?.passed !== true || spec.automation?.quality?.ruleVersion !== CONTENT_SCRIPT_QUALITY_RULE_VERSION) { res.status(409).json({ error: '成片质检尚未通过' }); return; }
        const hash = contentAcceptanceHash(spec);
        if (req.body?.hash !== hash) { res.status(409).json({ error: '成片版本已变化，请刷新并重新预览' }); return; }
        const nextSpec = { ...spec, contentAcceptance: { hash, approvedBy: userId, approvedAt: new Date().toISOString() } };
        const saved = await store.update('studio_projects', project.id, {
          spec: nextSpec,
          ...contentProjectLineageFields({ tenantId, spec: nextSpec, current: project }),
        });
        if (!saved) { res.status(503).json({ error: '审批保存失败' }); return; }
        await appendAudit({ tenantId, userId, action: 'content.accepted', targetType: 'studio_project', targetId: project.id, metadata: { hash } });
        res.json({ ok: true });
      });
    });
  }

  function registerPostRunsRunIdTasksTaskIdLinkProject() {
    digitalEmployeesRouter.post('/runs/:runId/tasks/:taskId/link-project', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
      const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId);
      const project = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', String(req.body?.projectId || ''), tenantId);
      if (!run || !task || task.run_id !== run.id || !project) { res.status(404).json({ error: 'resource_not_found' }); return; }
      await withDigitalEmployeeRunLock(tenantId, run.id, async () => {
        const current = await tenantRecord<TaskRecord>(COLLECTION.tasks, task.id, tenantId);
        if (!current || !['content_production', 'content_quality_gate', 'content_release_approval'].includes(current.task_key) || ['succeeded', 'cancelled', 'failed'].includes(run.status) || current.status === 'succeeded') { res.status(409).json({ error: 'task_locked' }); return; }
        if (!studioProjectRendered(project)) { res.status(400).json({ error: 'project_not_ready', message: '请先完成作品制作。' }); return; }
        const refs = jsonObject<Array<Record<string, unknown>>>(current.business_refs, []);
        if (!refs.some(r => r.type === 'studio_project' && r.id === project.id)) refs.push({ type: 'studio_project', id: project.id });
        await store.update(COLLECTION.tasks, current.id, { business_refs: refs, updated_at: new Date().toISOString() });
        const linkedPlan = await tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId);
        if (linkedPlan) {
          await store.update(COLLECTION.plans, linkedPlan.id, { plan: { ...jsonObject<Record<string, unknown>>(linkedPlan.plan, {}), packageApprovedBy: '', packageGrantInvalidatedAt: new Date().toISOString() } });
          await invalidatePublishingAuthorizationForRun(tenantId, run.id);
          await appendAuthorizationRequiredEvent({ tenantId, runId: run.id, taskId: current.id, reason: 'content_changed', changedFields: ['sourceProjectIds'] });
        }
        await appendAudit({ tenantId, userId, action: 'weekly_task.project_linked', targetType: 'workflow_task', targetId: current.id, metadata: { projectId: project.id } });
      });
      if (res.headersSent) return;
      await advanceRun(tenantId, run.id);
      res.json(await buildOverview(tenantId, run.goal_id));
    });
  }

  return { registerGetContentProjectsProjectIdProduction, registerPostContentProjectsProjectIdRevise, registerPostContentProjectsProjectIdNarration, registerPostContentProjectsProjectIdApprove, registerPostRunsRunIdTasksTaskIdLinkProject };
}
