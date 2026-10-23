import { useEffect, useRef, useState } from 'react';
import { productionApi } from '../../lib/productionApi';
import { automaticAvatarRefreshes, type AvatarJob, type ShotProduction, type PresenterAsset } from '../../lib/shotProduction';
import type { DigitalHumanPlanRecord, DigitalHumanExecutionRecord } from '../../lib/digitalHumanPlan';
import type { StudioProject } from '../../lib/studioApi';
import type { Clip } from './studioSourceMaterial';

export interface StudioProductionDraft {
  autosaveInFlightRef: { current: boolean };
  isCurrent(): boolean;
  save(): Promise<{ ok: boolean; project?: StudioProject | null; error?: string }>;
  onSaved(project: StudioProject): void;
}
interface StudioProductionIdentity {
  fingerprint: string; persistedShot: { id: string } | undefined;
  activeAssemblyId: string; shotKey: string;
}
export interface StudioProductionCommand {
  draft: StudioProductionDraft;
  prepareIdentity(): StudioProductionIdentity;
}
export interface StudioAvatarSubmission extends StudioProductionCommand {
  shot: ShotProduction; presenter: PresenterAsset; ratio: string;
}
export interface StudioProductionRefreshContext {
  currentProjectRef: { current: string | null };
  refreshMaterials(): Promise<Clip[]>;
  onCompleted(job: AvatarJob & { materialId: string }, materials: Clip[]): void;
}

/** State facets keep the original page Hook sequence, with one canonical record set. */
export function useStudioProductionRecords() {
  const [productionJobs, setProductionJobs] = useState<AvatarJob[]>([]);
  const [productionPlans, setProductionPlans] = useState<DigitalHumanPlanRecord[]>([]);
  const [productionExecutions, setProductionExecutions] = useState<DigitalHumanExecutionRecord[]>([]);
  return { productionJobs, setProductionJobs, productionPlans, setProductionPlans, productionExecutions, setProductionExecutions };
}
export function useStudioProductionRefreshState() {
  const productionRefreshInFlight = useRef(new Set<string>());
  const [productionRefreshingIds, setProductionRefreshingIds] = useState<string[]>([]);
  return { productionRefreshInFlight, productionRefreshingIds, setProductionRefreshingIds };
}
export function useStudioProductionRequestIdentity() {
  return useRef(new Map<string, string>());
}

export function createStudioProductionSession(input: {
  records: ReturnType<typeof useStudioProductionRecords>;
  refresh: ReturnType<typeof useStudioProductionRefreshState>;
  requestIds: ReturnType<typeof useStudioProductionRequestIdentity>;
  feedback: {
    setProductionBusy(busy: boolean): void;
    setProductionError(message: string): void;
    setDigitalHumanNotice(message: string): void;
  };
}) {
  const { productionJobs, setProductionJobs, setProductionPlans, setProductionExecutions } = input.records;
  const { productionRefreshInFlight, setProductionRefreshingIds } = input.refresh;
  const productionRequestIds = input.requestIds;
  const { setProductionBusy, setProductionError, setDigitalHumanNotice } = input.feedback;
  const refreshProductionJob = async (id: string, context: StudioProductionRefreshContext) => {
    const { currentProjectRef, refreshMaterials } = context;
    if (productionRefreshInFlight.current.has(id)) return;
    const requestedProject = currentProjectRef.current;
    productionRefreshInFlight.current.add(id);
    setProductionRefreshingIds(current => [...current, id]);
    setProductionError('');
    try {
      const job = await productionApi.refresh(id);
      if (job.projectId !== currentProjectRef.current) return;
      setProductionJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
      const executions = await productionApi.executions(job.projectId);
      if (job.projectId !== currentProjectRef.current) return;
      setProductionExecutions(executions);
      if (job.status === 'completed' && job.materialId) {
        const refreshedMaterials = await refreshMaterials();
        if (job.projectId !== currentProjectRef.current) return;
        context.onCompleted(job as AvatarJob & { materialId: string }, refreshedMaterials);
        setDigitalHumanNotice('数字人素材已生成并自动回填当前分镜。');
      }
    } catch (error) { if (currentProjectRef.current === requestedProject) setProductionError(error instanceof Error ? error.message : '任务刷新失败'); }
    finally {
      productionRefreshInFlight.current.delete(id);
      setProductionRefreshingIds(current => current.filter(item => item !== id));
    }
  };

  const refreshReferenceProduction = async (id: string, context: Pick<StudioProductionRefreshContext, 'currentProjectRef' | 'refreshMaterials'>) => {
    const { currentProjectRef, refreshMaterials } = context;
    if (productionRefreshInFlight.current.has(id)) return;
    const requestedProject = currentProjectRef.current;
    productionRefreshInFlight.current.add(id); setProductionRefreshingIds(current => [...current, id]); setProductionError('');
    try {
      const execution = await productionApi.refreshReference(id);
      if (execution.projectId !== currentProjectRef.current) return;
      setProductionExecutions(current => [execution, ...current.filter(item => item.id !== execution.id)]);
      if (execution.state === 'completed' && execution.materialId) await refreshMaterials();
    } catch (error) { if (currentProjectRef.current === requestedProject) setProductionError(error instanceof Error ? error.message : '参考人物任务刷新失败'); }
    finally { productionRefreshInFlight.current.delete(id); setProductionRefreshingIds(current => current.filter(item => item !== id)); }
  };

  const cancelReferenceProduction = async (id: string, context: Pick<StudioProductionRefreshContext, 'currentProjectRef' | 'refreshMaterials'>) => {
    const { currentProjectRef, refreshMaterials } = context;
    if (productionRefreshInFlight.current.has(id)) return;
    const requestedProject = currentProjectRef.current;
    productionRefreshInFlight.current.add(id); setProductionRefreshingIds(current => [...current, id]); setProductionError('');
    try {
      const execution = await productionApi.cancelReference(id);
      if (execution.projectId !== currentProjectRef.current) return;
      setProductionExecutions(current => [execution, ...current.filter(item => item.id !== execution.id)]);
      setDigitalHumanNotice('供应商已确认取消当前分镜任务；历史执行记录已保留。');
    } catch (error) { if (currentProjectRef.current === requestedProject) setProductionError(error instanceof Error ? error.message : '参考人物任务取消失败'); }
    finally { productionRefreshInFlight.current.delete(id); setProductionRefreshingIds(current => current.filter(item => item !== id)); }
  };

  const reconcileProductionCost = async (id: string, context: Pick<StudioProductionRefreshContext, 'currentProjectRef' | 'refreshMaterials'>) => {
    const { currentProjectRef, refreshMaterials } = context;
    if (productionRefreshInFlight.current.has(id)) return;
    const requestedProject = currentProjectRef.current;
    productionRefreshInFlight.current.add(id); setProductionRefreshingIds(current => [...current, id]); setProductionError('');
    try {
      const execution = await productionApi.reconcileSupplierCost(id);
      if (execution.projectId !== currentProjectRef.current) return;
      setProductionExecutions(current => [execution, ...current.filter(item => item.id !== execution.id)]);
      setDigitalHumanNotice(`供应商账单已核对：实际费用 ¥${(execution.actualCostCny || 0).toFixed(2)}，依据 ${execution.costSourceRef || '供应商用量记录'}。`);
    } catch (error) { if (currentProjectRef.current === requestedProject) setProductionError(error instanceof Error ? error.message : '供应商账单核对失败'); }
    finally { productionRefreshInFlight.current.delete(id); setProductionRefreshingIds(current => current.filter(item => item !== id)); }
  };

  const generateProductionAvatar = async (input: StudioAvatarSubmission) => {
    const { autosaveInFlightRef } = input.draft;
    const { shot, presenter, ratio } = input;
    if (!input.draft.isCurrent()) return;
    setProductionBusy(true); setProductionError(''); autosaveInFlightRef.current = true;
    try {
      const { fingerprint, persistedShot, activeAssemblyId, shotKey } = input.prepareIdentity();
      const saved = await input.draft.save();
      if (!input.draft.isCurrent()) return;
      if (!saved.ok || !saved.project?.id) throw new Error('草稿保存失败，未发起生成');
      input.draft.onSaved(saved.project);
      const savedProductionPlan = await productionApi.savePlan({ projectId: saved.project.id, assemblyId: activeAssemblyId,
        shotId: persistedShot!.id, fingerprint: fingerprint });
      if (!input.draft.isCurrent()) return;
      if (!savedProductionPlan.executable) throw new Error(savedProductionPlan.reasons.join('；') || '当前分镜制作方案不可执行');
      setProductionPlans(current => [savedProductionPlan, ...current.filter(item => item.id !== savedProductionPlan.id)]);
      const existingJobs = await productionApi.jobs(saved.project.id);
      if (!input.draft.isCurrent()) return;
      const existingExecutions = await productionApi.executions(saved.project.id);
      if (!input.draft.isCurrent()) return;
      const unresolved = existingJobs.find(job => job.assemblyId === activeAssemblyId && job.shotId === persistedShot?.id
        && job.fingerprint === fingerprint && ['submitting', 'pending', 'uncertain'].includes(job.status));
      const unresolvedExecution = existingExecutions.find(item => item.assemblyId === activeAssemblyId && item.shotId === persistedShot?.id
        && item.fingerprint === fingerprint && ['submitting', 'pending', 'uncertain'].includes(item.state));
      if (unresolved || unresolvedExecution) { setProductionJobs(existingJobs); setProductionExecutions(existingExecutions); throw new Error('该镜头已有未结束任务，请先刷新原任务，不重复提交计费。'); }
      const requestKey = `${saved.project.id}:${shotKey}:${fingerprint}`;
      const requestId = productionRequestIds.current.get(requestKey) || crypto.randomUUID();
      productionRequestIds.current.set(requestKey, requestId);
      if (savedProductionPlan.provider !== 'heygen') {
        const execution = await productionApi.submitReference({ projectId: saved.project.id, assemblyId: activeAssemblyId, shotId: persistedShot!.id,
          fingerprint: fingerprint, requestId, confirmed: true });
        productionRequestIds.current.delete(requestKey);
        if (!input.draft.isCurrent()) return;
        setProductionExecutions(current => [execution, ...current.filter(item => item.id !== execution.id)]);
        return;
      }
      const job = await productionApi.submit({ projectId: saved.project.id, assemblyId: activeAssemblyId, shotId: persistedShot!.id,
        shot, presenter, ratio, fingerprint: fingerprint, requestId, confirmed: true });
      productionRequestIds.current.delete(requestKey);
      if (!input.draft.isCurrent()) return;
      const executions = await productionApi.executions(saved.project.id);
      if (!input.draft.isCurrent()) return;
      setProductionExecutions(executions);
      setProductionJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
    } catch (error) { if (input.draft.isCurrent()) setProductionError(error instanceof Error ? error.message : '提交失败'); }
    finally { autosaveInFlightRef.current = false; setProductionBusy(false); }
  };


  const saveProductionPlan = async (input: StudioProductionCommand) => {
    const { autosaveInFlightRef } = input.draft;
    if (!input.draft.isCurrent()) return;
    setProductionBusy(true); setProductionError(''); autosaveInFlightRef.current = true;
    try {
      const saved = await input.draft.save();
      if (!input.draft.isCurrent()) return;
      if (!saved.ok || !saved.project?.id) throw new Error('草稿保存失败，制作方案未保存');
      input.draft.onSaved(saved.project);
      const { fingerprint, persistedShot, activeAssemblyId } = input.prepareIdentity();
      const record = await productionApi.savePlan({ projectId: saved.project.id, assemblyId: activeAssemblyId, shotId: persistedShot!.id, fingerprint: fingerprint });
      if (!input.draft.isCurrent()) return;
      setProductionPlans(current => [record, ...current.filter(item => item.id !== record.id && !(item.assemblyId === record.assemblyId && item.shotId === record.shotId && item.fingerprint === record.fingerprint))]);
      setDigitalHumanNotice(record.state === 'ready' ? '当前分镜制作方案已保存，可以生成候选。' : `当前分镜制作方案已保存：${record.reasons.join('；') || '等待后续能力接入'}`);
    } catch (error) { if (input.draft.isCurrent()) setProductionError(error instanceof Error ? error.message : '制作方案保存失败'); }
    finally { autosaveInFlightRef.current = false; setProductionBusy(false); }
  };


  const adoptExecution = async (input: { draft: StudioProductionDraft; executionId: string; candidateId: string; materialId: string }) => {
    const { autosaveInFlightRef } = input.draft;
    if (!input.draft.isCurrent()) return false;
    setProductionBusy(true); setProductionError(''); autosaveInFlightRef.current = true;
    try {
      const saved = await input.draft.save();
      if (!input.draft.isCurrent()) return false;
      if (!saved.ok || !saved.project?.id) throw new Error('草稿保存失败，候选尚未填入分镜');
      input.draft.onSaved(saved.project);
      const adoptedExecution = await productionApi.adoptExecution(input.executionId, { candidateId: input.candidateId, materialId: input.materialId });
      if (!input.draft.isCurrent()) return false;
      setProductionExecutions(current => [adoptedExecution, ...current.filter(item => item.id !== adoptedExecution.id)]);
      return true;
    } catch (error) {
      if (input.draft.isCurrent()) setProductionError(error instanceof Error ? error.message : '候选填入分镜失败'); return false;
    } finally { autosaveInFlightRef.current = false; setProductionBusy(false); }
  };
  const recoverJobs = (request: {
    projectId: string | null; refreshContext: StudioProductionRefreshContext; onSynchronize(): void;
  }) => {
    const { projectId } = request;
    request.onSynchronize();
    const pending = automaticAvatarRefreshes(productionJobs, projectId || '');
    if (!pending.length) return;
    const timer = window.setTimeout(() => { void Promise.all(pending.map(job => refreshProductionJob(job.id, request.refreshContext))); }, 10000);
    return () => window.clearTimeout(timer);
  };
  return { refreshProductionJob, refreshReferenceProduction, cancelReferenceProduction, reconcileProductionCost,
    generateProductionAvatar, saveProductionPlan, adoptExecution, recoverJobs };
}

export function createStudioProductionProjectRead(
  records: ReturnType<typeof useStudioProductionRecords>, projectId: string, setProductionError: (message: string) => void,
) {
  const { setProductionJobs, setProductionPlans, setProductionExecutions } = records;
  let live = true;
  const refresh = () => Promise.all([productionApi.jobs(projectId), productionApi.plans(projectId), productionApi.executions(projectId)])
    .then(([jobs, plans, executions]) => { if (live) { setProductionJobs(jobs); setProductionPlans(plans); setProductionExecutions(executions); } })
    .catch(error => { if (live) setProductionError(String(error)); });
  return { refresh, dispose: () => { live = false; } };
}

export function useStudioProductionProjectRead(records: ReturnType<typeof useStudioProductionRecords>, projectId: string | null,
  setProductionError: (message: string) => void) {
  useEffect(() => {
    if (!projectId) { records.setProductionJobs([]); records.setProductionPlans([]); records.setProductionExecutions([]); return; }
    const reader = createStudioProductionProjectRead(records, projectId, setProductionError);
    const refresh = () => { void reader.refresh(); };
    refresh(); window.addEventListener('focus', refresh);
    return () => { reader.dispose(); window.removeEventListener('focus', refresh); };
  }, [projectId]);
}

export function useStudioProductionJobRecovery(session: ReturnType<typeof createStudioProductionSession>, signature: string,
  request: Parameters<typeof session.recoverJobs>[0]) {
  useEffect(() => session.recoverJobs(request), [signature]);
}
