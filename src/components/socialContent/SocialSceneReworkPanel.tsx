import { useEffect, useRef, useState } from 'react';
import type { SocialContentTaskDetail } from '../../../shared/contracts/socialContentWorkflow';
import type { SocialSceneReworkAvailability, SocialSceneReworkStatus } from '../../../shared/contracts/socialSceneRework';
import type { SceneReworkAdmissionPreview } from '../../../server/starter198/socialContentSceneReworkAdmission';
import type { SceneReworkCostPolicy } from '../../../server/starter198/socialContentSceneReworkCostPolicy';
import { socialContentApi } from '../../lib/socialContentApi';
import {
  sceneReworkSelectionAllowed,
  socialSceneReworkApi,
  type SceneReworkScope,
} from '../../lib/socialSceneReworkApi';
import {
  sceneReworkCostConfirmable,
  socialSceneReworkCostApi,
  type SceneReworkCostEvidence,
} from '../../lib/socialSceneReworkCostApi';
import { SocialDirectorG5ReviewPanel } from './SocialDirectorG5ReviewPanel';
import { SocialSceneG4ReviewPanel } from './SocialSceneG4ReviewPanel';
import { WeeklyContentQualityRecoveryPanel } from './WeeklyContentQualityRecoveryPanel';

export interface SocialSceneReworkPanelProps {
  task: SocialContentTaskDetail;
  focusedSceneId?: string;
  initialParentArtifactId?: string;
  expectedTenantId?: string;
  onFocusScene?: (scene: SocialSceneReworkAvailability['scenes'][number]) => void;
  onChanged?: () => void;
}

const inputClass = 'rounded-lg border border-border bg-white px-3 py-2 text-xs text-text-primary';
const secondaryButtonClass = 'rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-text-secondary disabled:opacity-50';

export function SocialSceneReworkPanel({
  task,
  focusedSceneId,
  initialParentArtifactId,
  expectedTenantId,
  onFocusScene,
  onChanged,
}: SocialSceneReworkPanelProps) {
  const [parent, setParent] = useState('');
  const [availability, setAvailability] = useState<SocialSceneReworkAvailability | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [status, setStatus] = useState<SocialSceneReworkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [cost, setCost] = useState<SceneReworkCostEvidence | null>(null);
  const [cap, setCap] = useState('');
  const [costUncertain, setCostUncertain] = useState(false);
  const [admissionPreview, setAdmissionPreview] = useState<SceneReworkAdmissionPreview | null>(null);
  const [admissionPolicy, setAdmissionPolicy] = useState<SceneReworkCostPolicy | null>(null);
  const identity = `${expectedTenantId || ''}:${task.taskId}:${task.runId}:${parent}`;
  const current = useRef(identity);
  current.current = identity;
  const currentOperation = useRef(status?.operationId);
  currentOperation.current = status?.operationId;

  useEffect(() => {
    setParent(initialParentArtifactId || '');
  }, [task.taskId, task.runId, initialParentArtifactId]);

  useEffect(() => {
    setAvailability(null);
    setIds([]);
    setStatus(null);
    setAdmissionPreview(null);
    setAdmissionPolicy(null);
    setError('');
    setBusy(false);
    setUncertain(false);
  }, [identity]);

  useEffect(() => {
    setCost(null);
    setCap('');
    setCostUncertain(false);
    setBusy(false);
  }, [identity, status?.operationId]);

  const scope = (): SceneReworkScope => ({
    taskId: task.taskId,
    sourceRunId: task.runId || '',
    parentArtifactId: parent,
    ...(expectedTenantId ? { tenantId: expectedTenantId } : availability ? { tenantId: availability.tenantId } : {}),
  });

  async function load() {
    const token = identity;
    setBusy(true);
    setError('');
    try {
      const value = await socialSceneReworkApi.availability(scope());
      if (current.current !== token) return;
      setAvailability(value);
      setUncertain(false);
      setIds(focusedSceneId && value.scenes.filter(scene => scene.sceneId === focusedSceneId && scene.status === 'failed').length === 1 ? [focusedSceneId] : []);
    } catch (cause) {
      if (current.current === token) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current.current === token) setBusy(false);
    }
  }

  useEffect(() => {
    if (initialParentArtifactId && parent === initialParentArtifactId && task.runId) void load();
  }, [identity, initialParentArtifactId, focusedSceneId]);

  async function submit() {
    if (!availability || !admissionPreview) return;
    const token = identity;
    setBusy(true);
    setError('');
    try {
      const value = await socialSceneReworkApi.submit(scope(), availability, ids, admissionPreview, admissionPolicy || undefined);
      if (current.current !== token) return;
      setStatus(value);
      onChanged?.();
    } catch (cause) {
      if (current.current === token) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setUncertain(true);
      }
    } finally {
      if (current.current === token) setBusy(false);
    }
  }

  async function previewAdmission() {
    if (!availability) return;
    const token = identity;
    setBusy(true);
    setError('');
    try {
      const value = await socialSceneReworkApi.preview(scope(), availability, ids);
      if (current.current !== token) return;
      setAdmissionPreview(value);
      setAdmissionPolicy(null);
      setCap(value.quote ? String(value.quote.totalUpperBoundCny) : '');
    } catch (cause) {
      if (current.current === token) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current.current === token) setBusy(false);
    }
  }

  async function confirmAdmissionCost() {
    if (!availability || !admissionPreview?.quote || !cap.trim()) return;
    const token = identity;
    setBusy(true);
    setError('');
    try {
      const value = await socialSceneReworkApi.confirmAdmissionCost(scope(), availability, ids, admissionPreview, Number(cap));
      if (current.current !== token) return;
      setAdmissionPolicy(value);
    } catch (cause) {
      if (current.current === token) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setCostUncertain(true);
      }
    } finally {
      if (current.current === token) setBusy(false);
    }
  }

  async function refresh() {
    if (!status) return;
    const token = identity;
    setBusy(true);
    try {
      const value = await socialSceneReworkApi.status(scope(), status.operationId);
      if (current.current !== token) return;
      setStatus(value);
      setUncertain(false);
      onChanged?.();
    } catch (cause) {
      if (current.current === token) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current.current === token) setBusy(false);
    }
  }

  async function readCost() {
    if (!status) return;
    const token = identity;
    const operationId = status.operationId;
    setBusy(true);
    setError('');
    try {
      const value = await socialSceneReworkCostApi.read(status);
      if (current.current !== token || operationId !== currentOperation.current) return;
      setCost(value);
      setCostUncertain(false);
      setCap(value.policy ? String(value.policy.authorizedMaximumCostCny) : '');
    } catch (cause) {
      if (current.current === token && operationId === currentOperation.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current.current === token && operationId === currentOperation.current) setBusy(false);
    }
  }

  async function confirmCost() {
    if (!status || !cost || !cap.trim()) return;
    const token = identity;
    const operationId = status.operationId;
    setBusy(true);
    setError('');
    try {
      const policy = await socialSceneReworkCostApi.confirm(status, cost, Number(cap));
      if (current.current !== token || operationId !== currentOperation.current) return;
      setCost({ ...cost, policy });
    } catch (cause) {
      if (current.current === token && operationId === currentOperation.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setCostUncertain(true);
      }
    } finally {
      if (current.current === token && operationId === currentOperation.current) setBusy(false);
    }
  }

  async function resume() {
    if (!status) return;
    const token = identity;
    const operationId = status.operationId;
    setBusy(true);
    setError('');
    try {
      const value = await socialSceneReworkApi.resume(scope(), status, cost?.policy?.recordHash);
      if (current.current !== token || operationId !== currentOperation.current) return;
      setStatus(value);
      onChanged?.();
    } catch (cause) {
      if (current.current === token && operationId === currentOperation.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setUncertain(true);
      }
    } finally {
      if (current.current === token && operationId === currentOperation.current) setBusy(false);
    }
  }

  return (
    <section aria-label="逐镜局部返工" className="rounded-lg border border-border bg-white p-4">
      <h3 className="text-sm font-bold">失败镜头局部返工</h3>
      <p className="my-2 text-xs text-text-muted">保留原成片，只修复已核验失败镜头。系统先核验真实路线并生成报价；付费路线确认上限后才创建独立生产作业。</p>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="返工原成片" value={parent} disabled={busy || uncertain} onChange={event => setParent(event.target.value)} className={inputClass}>
          <option value="">选择本任务真实成片</option>
          {task.artifacts.filter(artifact => artifact.taskId === task.taskId && artifact.origin === 'agent').map(artifact => (
            <option key={artifact.artifactId} value={artifact.artifactId}>{artifact.kind} · {artifact.platform || '平台未指定'} · {artifact.version} · {artifact.status}</option>
          ))}
        </select>
        <button type="button" disabled={busy || !parent || !task.runId} onClick={() => void load()} className={secondaryButtonClass}>读取逐镜核验凭据</button>
      </div>

      {availability && <div className="mt-4 space-y-3">
        <ul className="space-y-2">
          {availability.scenes.map(scene => <li key={scene.sceneId} className="rounded-lg border border-border p-3 text-xs">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                disabled={busy || uncertain || Boolean(status) || Boolean(admissionPreview) || scene.status !== 'failed'}
                checked={ids.includes(scene.sceneId)}
                onChange={event => setIds(currentIds => event.target.checked ? [...currentIds, scene.sceneId] : currentIds.filter(id => id !== scene.sceneId))}
              />
              <span>{scene.sceneId} · {scene.status} · 核验 {scene.technicalReceiptId}</span>
            </label>
            {onFocusScene && <button type="button" onClick={() => onFocusScene(scene)} className="mt-2 text-accent">定位三栏镜头</button>}
            <SceneReworkFailureReasons scene={scene} />
          </li>)}
        </ul>
        {availability.blockingReasons.map(reason => <p key={reason} className="text-xs text-amber-800">{reason}</p>)}
        {availability.existingOperations?.map(operation => (
          <button type="button" key={operation.operationId} disabled={busy} onClick={() => setStatus(operation)} className={secondaryButtonClass}>查看已持久返工 · {operation.jobStatus} · {operation.operationId}</button>
        ))}
        {!admissionPreview && <button type="button" disabled={busy || uncertain || Boolean(status) || !sceneReworkSelectionAllowed(availability, ids)} onClick={() => void previewAdmission()} className="btn-primary">核验路线并生成执行方案</button>}
        {admissionPreview && <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3 text-xs">
          <p>执行方案 {admissionPreview.operationId} · 尚未创建生产作业</p>
          {admissionPreview.gaps.map(gap => <p key={gap} className="text-amber-800">{gap}</p>)}
          {admissionPreview.localOnly ? <p>当前为已验证本地素材路线，无外部生成费用。</p> : admissionPreview.quote ? <>
            <p>付费路线 {admissionPreview.quote.provider} / {admissionPreview.quote.model} · 报价上界 ¥{admissionPreview.quote.totalUpperBoundCny.toFixed(2)}</p>
            <div className="flex flex-wrap items-end gap-2"><label>明确允许的本次费用上限（元）<input type="number" min="0" step="0.01" value={cap} disabled={busy || Boolean(admissionPolicy)} onChange={event => setCap(event.target.value)} className={`mt-1 block ${inputClass}`}/></label>{admissionPolicy ? <p>已确认费用上限 ¥{admissionPolicy.authorizedMaximumCostCny.toFixed(2)}；仍未创建生产作业。</p> : <button type="button" disabled={busy || !cap.trim() || Number(cap) < admissionPreview.quote.totalUpperBoundCny || Number(cap) > admissionPreview.quote.maximumOriginalBudgetCny} onClick={() => void confirmAdmissionCost()} className={secondaryButtonClass}>确认费用上限</button>}</div>
          </> : <p>缺少可信报价，不能创建生产作业。</p>}
          <button type="button" disabled={busy || uncertain || admissionPreview.gaps.length > 0 || (!admissionPreview.localOnly && !admissionPolicy)} onClick={() => void submit()} className="btn-primary">创建并开始返工作业</button>
        </div>}
      </div>}

      {status && <div className="mt-4 space-y-2 rounded-lg border border-border bg-surface-2 p-3 text-xs">
        <p>独立运行 {status.executionRunId} · {status.runStatus}</p>
        <p>作业 {status.jobId} · {status.jobStatus}</p>
        <p>实际已产生费用：尚无可核验账单</p>
        {status.completedAt && <p>作业完成时间 {status.completedAt}</p>}
        {status.runCompletedAt && <p>运行完成时间 {status.runCompletedAt}</p>}
        <button type="button" disabled={busy} onClick={() => void readCost()} className={secondaryButtonClass}>读取真实报价与已确认费用上限</button>
        {cost && <div className="space-y-2 rounded-lg border border-border bg-white p-3">
          <p>报价状态对应作业 {cost.jobStatus} · {cost.runStatus}</p>
          {cost.gaps.map(gap => <p key={gap} className="text-amber-800">{gap}</p>)}
          {cost.quote ? <>
            <p>受影响镜头 {cost.quote.sceneIds.join('、')} · {cost.quote.provider} / {cost.quote.model}</p>
            <p>本次报价费用上界 ¥{cost.quote.totalUpperBoundCny.toFixed(2)} · 原冻结预算上界 ¥{cost.quote.maximumOriginalBudgetCny.toFixed(2)}</p>
            <p>报价来源 {cost.quote.tariffSourceRef} · 版本 {cost.quote.tariffVersion} · 有效至 {cost.quote.validUntil}</p>
          </> : <p>缺少真实报价，不能确认费用。</p>}
          {cost.policy ? <p>已明确确认本次费用上限 ¥{cost.policy.authorizedMaximumCostCny.toFixed(2)} · {cost.policy.confirmedAt}。确认不自动继续作业。</p> : <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">明确允许的本次费用上限（元）<input type="number" min="0" step="0.01" value={cap} disabled={busy || costUncertain} onChange={event => setCap(event.target.value)} className={`mt-1 block ${inputClass}`} /></label>
            <button type="button" disabled={busy || costUncertain || !cap.trim() || !sceneReworkCostConfirmable(cost, Number(cap))} onClick={() => void confirmCost()} className="btn-primary">仅确认费用上限</button>
          </div>}
          {costUncertain && <p role="alert" className="text-amber-800">费用确认结果未知，请先只读重新读取已确认记录。</p>}
        </div>}
        <button type="button" disabled={busy || uncertain || costUncertain || Boolean(cost?.quote && !cost.policy) || !['blocked', 'dead_letter', 'paused'].includes(status.jobStatus) || status.runStatus !== 'running'} onClick={() => void resume()} className="btn-primary">继续原返工作业</button>
        <p>仅继续当前独立运行和原作业；服务端重新核验预算和凭据。供应商结果未知时仅核对原请求，不重复发送。</p>
        {status.output && <SceneReworkOutputReceipt key={`${identity}:${status.operationId}:${status.output.artifactId}`} taskId={status.taskId} output={status.output} />}
        {status.lastError && <p role="alert" className="text-red-700">{status.lastError}</p>}
        <button type="button" disabled={busy} onClick={() => void refresh()} className={secondaryButtonClass}>读取真实返工状态</button>
      </div>}
      {uncertain && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">提交结果未知，已停止重复提交。请刷新任务并核对实际返工记录；本界面不会自动重试付费操作。</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
      {availability && availability.taskId === task.taskId && availability.parentArtifactId === parent && <WeeklyContentQualityRecoveryPanel key={`${availability.tenantId}:${availability.taskId}:${availability.sourceRunId}:${availability.parentArtifactId}`} scope={{ tenantId: availability.tenantId, taskId: availability.taskId, runId: availability.sourceRunId, artifactId: availability.parentArtifactId }} onChanged={() => { void load(); onChanged?.(); }}/>}
      <SocialDirectorG5ReviewPanel task={task} initialArtifactId={parent || initialParentArtifactId} expectedTenantId={expectedTenantId} onChanged={() => { void load(); onChanged?.(); }}/>
      <SocialSceneG4ReviewPanel task={task} initialArtifactId={parent || initialParentArtifactId} initialSceneId={focusedSceneId} expectedTenantId={expectedTenantId} onChanged={() => { void load(); onChanged?.(); }}/>
    </section>
  );
}

function SceneReworkOutputReceipt({ taskId, output }: { taskId: string; output: NonNullable<SocialSceneReworkStatus['output']> }) {
  const [requested, setRequested] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    let objectUrl = '';
    void socialContentApi.fetchArtifactMedia(taskId, output.artifactId, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(value.blob);
      setUrl(objectUrl);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [requested, taskId, output.artifactId]);

  return <section aria-label="真实返工成片" className="space-y-2 rounded-lg border border-border bg-white p-3">
    <p>新成片 {output.artifactId} · 原成片 {output.parentArtifactId}</p>
    <p>已保存 {output.savedAt} · {output.reviewStatus === 'review_required' ? '待真实质量审核' : '需继续修改'}</p>
    <p>文件 {output.fileRef} · SHA256 {output.sha256}</p>
    <p>质量核验凭据 {output.qualityReceiptIds.join('、')}</p>
    <button type="button" disabled={requested} onClick={() => setRequested(true)} className={secondaryButtonClass}>读取新成片进行验收</button>
    {url && <video controls src={url} className="max-h-80 w-full" />}
    {requested && !url && !error && <p role="status">正在读取已保存的真实成片…</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </section>;
}

export function SceneReworkFailureReasons({ scene }: { scene: SocialSceneReworkAvailability['scenes'][number] }) {
  if (scene.status === 'passed') return null;
  const failures = scene.checks?.filter(check => !check.passed) || [];
  return <div aria-label={`镜头 ${scene.sceneId} 核验原因`} className="mt-2 space-y-1 text-xs text-text-secondary">
    {failures.length
      ? failures.map((check, index) => <p key={`${check.code}:${index}`}>{check.code} · {check.message}</p>)
      : <p role="status">{scene.checks?.length ? '核验明细未包含失败原因' : '缺少真实逐镜核验明细'}，请回到原任务补齐核验凭据后确认原因。</p>}
  </div>;
}
