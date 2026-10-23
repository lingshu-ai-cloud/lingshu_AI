import { useEffect, useState } from 'react';
import { studioApi, type StudioProject, type StudioManualHandoff } from '../../lib/studioApi';
import type { ProjectQualityRecord } from './studioWorkspaceContracts';

export interface StudioDeliveryContext {
  projectId: string | null;
  currentReviewedOutputPath: string;
  creationMode: 'viral_replication' | 'free_creation';
  isCurrent(): boolean;
  saveDraft(specOverrides?: Record<string, unknown>): Promise<boolean>;
  onNotice(message: string): void;
  onProject(project: StudioProject): void;
}

export function studioDeliveryStatus(state: { reviewedRenderPath: string; projectQualityRecord: ProjectQualityRecord | null }, currentReviewedOutputPath: string) {
  const { reviewedRenderPath, projectQualityRecord } = state;
  const currentRenderReviewed = Boolean(currentReviewedOutputPath && reviewedRenderPath === currentReviewedOutputPath);
  const currentProjectQualityRecord = currentRenderReviewed && projectQualityRecord?.renderPath === currentReviewedOutputPath
    ? projectQualityRecord : null;
  return { currentRenderReviewed, currentProjectQualityRecord };
}

function useStudioDeliveryState() {
  const [reviewedRenderPath, setReviewedRenderPath] = useState('');
  const [projectQualityRecord, setProjectQualityRecord] = useState<ProjectQualityRecord | null>(null);
  const [projectQualityBusy, setProjectQualityBusy] = useState(false);
  const [projectQualityNotice, setProjectQualityNotice] = useState('');
  const [manualHandoffs, setManualHandoffs] = useState<StudioManualHandoff[]>([]);
  const [manualHandoffBusy, setManualHandoffBusy] = useState<StudioManualHandoff['action'] | ''>('');
  const [manualHandoffNotice, setManualHandoffNotice] = useState('');
  return {
    reviewedRenderPath, setReviewedRenderPath, projectQualityRecord, setProjectQualityRecord,
    projectQualityBusy, setProjectQualityBusy, projectQualityNotice, setProjectQualityNotice,
    manualHandoffs, setManualHandoffs, manualHandoffBusy, setManualHandoffBusy,
    manualHandoffNotice, setManualHandoffNotice,
  };
}

export function createStudioDeliveryActions(state: ReturnType<typeof useStudioDeliveryState>) {
  const {
    reviewedRenderPath, setReviewedRenderPath, setProjectQualityRecord,
    projectQualityBusy, setProjectQualityBusy, setProjectQualityNotice,
    setManualHandoffs, manualHandoffBusy, setManualHandoffBusy, setManualHandoffNotice,
  } = state;
  const updateRenderAcceptance = async (accepted: boolean, input: StudioDeliveryContext) => {
    if (!input.isCurrent()) return;
    const { currentReviewedOutputPath, creationMode, onNotice: setModeNotice } = input;
    const previous = reviewedRenderPath;
    const nextPath = accepted ? currentReviewedOutputPath : '';
    if (accepted && !nextPath) return;
    setReviewedRenderPath(nextPath);
    setProjectQualityRecord(null);
    setProjectQualityNotice('');
    try {
      const saved = await input.saveDraft({
        renderAcceptance: accepted ? {
          accepted: true,
          renderPath: nextPath,
          creationMode,
          acceptedAt: new Date().toISOString(),
        } : null,
        projectQualityRecords: [],
        activeProjectQualityRecordId: '',
      });
      if (!input.isCurrent()) return;
      if (!saved) throw new Error('验收结果保存失败');
      setModeNotice(accepted ? '成片验收结果已保存，可在“我的创作 → 历史素材”中查看。' : '已撤销当前成片验收。');
    } catch (error) {
      if (!input.isCurrent()) return;
      setReviewedRenderPath(previous);
      setModeNotice(error instanceof Error ? error.message : '验收结果保存失败，请重试。');
    }
  };
  const requalityCurrentProject = async (input: StudioDeliveryContext) => {
    if (!input.isCurrent()) return;
    const { projectId } = input;
    const { currentRenderReviewed } = studioDeliveryStatus(state, input.currentReviewedOutputPath);
    if (!projectId || !currentRenderReviewed || projectQualityBusy) return;
    setProjectQualityBusy(true); setProjectQualityNotice('');
    try {
      const saved = await input.saveDraft();
      if (!input.isCurrent()) return;
      if (!saved) throw new Error('当前修改尚未保存，请重试');
      const result = await studioApi.requalityProject(projectId);
      if (!input.isCurrent()) return;
      if (!result.ok || !result.record) throw new Error(result.issues?.join('；') || result.error || '重新质检未通过');
      setProjectQualityRecord(result.record);
      if (result.project) {
        input.onProject(result.project);
      }
      setProjectQualityNotice(result.replayed ? '当前版本已通过质检，签发记录仍然有效。' : '重新质检通过，已为当前输入签发新的生成记录。');
    } catch (error) { if (!input.isCurrent()) return; setProjectQualityRecord(null); setProjectQualityNotice(error instanceof Error ? error.message : '重新质检未通过'); }
    finally { setProjectQualityBusy(false); }
  };
  const submitManualHandoff = async (action: StudioManualHandoff['action'], input: StudioDeliveryContext) => {
    if (!input.isCurrent()) return;
    const { projectId, currentReviewedOutputPath } = input;
    const { currentRenderReviewed, currentProjectQualityRecord } = studioDeliveryStatus(state, currentReviewedOutputPath);
    if (!projectId || !currentRenderReviewed || !currentReviewedOutputPath || !currentProjectQualityRecord || currentProjectQualityRecord.renderPath !== currentReviewedOutputPath || manualHandoffBusy) return;
    setManualHandoffBusy(action); setManualHandoffNotice('');
    try {
      const saved = await input.saveDraft();
      if (!input.isCurrent()) return;
      if (!saved) throw new Error('项目尚未保存，请重试');
      const result = await studioApi.createManualHandoff(projectId, {
        action, renderPath: currentReviewedOutputPath, reviewed: true,
      });
      if (!input.isCurrent()) return;
      if (!result.ok || !result.handoff) throw new Error(result.error || '协作请求未能提交');
      setManualHandoffs(current => [result.handoff!, ...current.filter(item => item.id !== result.handoff!.id)]);
      setManualHandoffNotice(action === 'team_review'
        ? '已提交团队审核；当前作品仍保持人工自由创作，不会自动进入数字员工。'
        : '已加入发布计划待办；需由团队继续确认日期、账号和发布授权。');
    } catch (error) { if (!input.isCurrent()) return; setManualHandoffNotice(error instanceof Error ? error.message : '协作请求未能提交'); }
    finally { setManualHandoffBusy(''); }
  };
  const readManualHandoffs = (input: { projectId: string; isCurrent(): boolean }) => {
    let disposed = false;
    const refresh = async () => {
      try {
        const result = await studioApi.listManualHandoffs(input.projectId);
        if (disposed || !input.isCurrent()) return;
        if (result.ok) setManualHandoffs(result.handoffs);
        else setManualHandoffNotice('协作清单读取失败，请稍后重试。');
      } catch (error) {
        if (!disposed && input.isCurrent()) setManualHandoffNotice(error instanceof Error ? error.message : '协作清单读取失败，请稍后重试。');
      }
    };
    return { refresh, dispose: () => { disposed = true; } };
  };
  return { updateRenderAcceptance, requalityCurrentProject, submitManualHandoff, readManualHandoffs };
}

export function useStudioDeliveryWorkspace() {
  const state = useStudioDeliveryState();
  return { ...state, ...createStudioDeliveryActions(state) };
}

export function useStudioManualHandoffRead(workspace: ReturnType<typeof useStudioDeliveryWorkspace>, input: {
  projectId: string | null; enabled: boolean; isCurrent(): boolean;
}) {
  const { projectId, enabled } = input;
  useEffect(() => {
    if (!projectId || !enabled) { workspace.setManualHandoffs([]); return; }
    const reader = workspace.readManualHandoffs({ projectId, isCurrent: input.isCurrent });
    void reader.refresh();
    return reader.dispose;
  }, [projectId, enabled]);
}
