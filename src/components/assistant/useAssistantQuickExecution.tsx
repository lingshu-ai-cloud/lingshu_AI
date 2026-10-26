import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { App as AntApp, Input } from 'antd';
import type { AssistantQuickExecution } from '../../lib/assistantQuickEntries';
import { socialContentApi } from '../../lib/socialContentApi';
import { WEEKLY_WORK_UPDATED_EVENT } from '../../lib/weeklyWorkEvents';
import { useAssistantStore, type OrbitAgentId } from '../../stores/assistantStore';
import { PRIMARY_ASSISTANT_THREAD } from './globalAssistantRuntime';
import type { useContentTaskIntake } from './useContentTaskIntake';

type StoreActions = ReturnType<typeof useAssistantStore.getState>;
type AppServices = ReturnType<typeof AntApp.useApp>;
type QuickExecutionInput = {
  loading: boolean;
  fileGenerating: boolean;
  pipelineInFlightRef: { current: boolean };
  pipelineModalOpenRef: { current: boolean };
  persistenceFenceRef: { current: { active: boolean; scopeKey: string } };
  openWeeklyPlanFromAssistant: () => void;
  contentIntake: ReturnType<typeof useContentTaskIntake>;
  modal: AppServices['modal'];
  uiMessage: AppServices['message'];
  setMessages: StoreActions['setMessages'];
  upsertTaskCard: StoreActions['upsertTaskCard'];
  setMode: (mode: 'breathing') => void;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setPipelineRefresh: Dispatch<SetStateAction<number>>;
  persistThread: (agent: OrbitAgentId) => void;
  onSessionRefresh?: () => void;
  requestId: () => string;
};

/** Executes a signed quick entry against its original weekly task and version. */
export function useAssistantQuickExecution(input: QuickExecutionInput) {
  const { loading, fileGenerating, pipelineInFlightRef, pipelineModalOpenRef,
    persistenceFenceRef, openWeeklyPlanFromAssistant, contentIntake, modal, uiMessage,
    setMessages, upsertTaskCard, setMode, setLoading, setPipelineRefresh,
    persistThread, onSessionRefresh, requestId } = input;
  return useCallback(async function executeEntry(entry: AssistantQuickExecution, confirmations = 0, executionRequestId = `quick-${requestId()}`, fence = persistenceFenceRef.current) {
    if (loading || fileGenerating || pipelineInFlightRef.current) return;
    const currentScope = () => fence.active && persistenceFenceRef.current === fence;
    if (entry.id === 'business-create-week-plan') { openWeeklyPlanFromAssistant(); return; }
    const openTask = (taskId: string) => {
      setMode('breathing');
      window.dispatchEvent(new CustomEvent('lingshu:navigate', {
        detail: { page: 'smartAssets', socialContentTaskId: taskId, socialContentPage: 'smartAssets', directStudio: true },
      }));
    };
    const recordReceipt = (content: string, taskId?: string, status?: string, queued = false) => {
      const messages = useAssistantStore.getState().threads[PRIMARY_ASSISTANT_THREAD].messages;
      setMessages(PRIMARY_ASSISTANT_THREAD, [...messages, { role: 'assistant', content,
        ...(queued && taskId ? { taskPortal: { kind: 'content_task' as const, taskId, title: '内容生产任务', action: 'view_production' as const, phase: 'ready' as const } } : {}),
      }]);
      if (taskId) {
        upsertTaskCard(PRIMARY_ASSISTANT_THREAD, { taskId: `social-content:${taskId}`, title: '内容周任务', conclusion: content,
          status: status === 'producing' ? 'running' : ['completed', 'delivered', 'published'].includes(status || '') ? 'completed' : status === 'paused' ? 'paused' : 'needs_input', notificationReason: 'routine',
          primaryAction: { id: `open-${taskId}`, label: '查看生产任务', href: `/?page=smartAssets&socialContentTaskId=${encodeURIComponent(taskId)}` } });
      }
      persistThread(PRIMARY_ASSISTANT_THREAD);
      window.dispatchEvent(new CustomEvent(WEEKLY_WORK_UPDATED_EVENT));
      void onSessionRefresh?.();
      setPipelineRefresh(value => value + 1);
    };
    if (entry.operation === 'create') {
      contentIntake.start();
      return;
    }
    if (!entry.taskId || !entry.expectedVersion) return;
    if (entry.operation === 'open') { openTask(entry.taskId); return; }
    if (entry.operation === 'revise' && entry.artifactId) {
      if (pipelineModalOpenRef.current) return;
      pipelineModalOpenRef.current = true;
      let note = '';
      modal.confirm({ title: '修改当前交付物',
        content: <label className="block">修改要求<Input.TextArea rows={4} onChange={event => { note = event.target.value; }} /></label>,
        okText: '提交返工', cancelText: '取消',
        afterClose: () => { pipelineModalOpenRef.current = false; },
        onOk: async () => {
          if (!note.trim()) { void uiMessage.error('请填写具体修改要求。'); throw new Error('请填写具体修改要求。'); }
          if (!currentScope() || pipelineInFlightRef.current) return;
          pipelineInFlightRef.current = true;
          try {
            const response = await socialContentApi.reviseAssistantAction(entry.taskId!, entry.artifactId!, entry.expectedVersion!, note.trim(), executionRequestId);
            if (!currentScope()) return;
            recordReceipt(response.receipt.blockedReason === 'weekly_revision_scope_confirmation_required'
              ? '修改要求已记录到原周任务，请在生产页面确认返工范围与预算后继续。'
              : '修改要求已提交原周任务，返工交付物将回收到该任务。', response.receipt.taskId, response.receipt.status);
            openTask(response.receipt.taskId);
          } catch (error) { if (currentScope()) { recordReceipt(error instanceof Error ? error.message : '修改未提交，请重试。'); void uiMessage.error(error instanceof Error ? error.message : '修改未提交，请重试。'); } throw error; }
          finally { pipelineInFlightRef.current = false; }
        },
      });
      return;
    }
    if (!confirmations) {
      if (pipelineModalOpenRef.current) return;
      pipelineModalOpenRef.current = true;
      modal.confirm({ title: entry.label, content: '推进当前任务的生产流程，保留原周任务和已有交付物。',
        afterClose: () => { pipelineModalOpenRef.current = false; },
        okText: '确认执行', cancelText: '取消', onOk: () => executeEntry(entry, 1, executionRequestId, fence) });
      return;
    }
    if (!currentScope()) return;
    pipelineInFlightRef.current = true;
    setLoading(true);
    try {
      const response = await socialContentApi.startAssistantAction(entry.taskId, entry.expectedVersion, executionRequestId);
      if (!currentScope()) return;
      recordReceipt(`「${response.task.brief.title}」：${response.receipt.blockedReason ? '暂未进入生产，请在任务中查看原因。' : '已读取真实生产状态，结果回收到原周任务。'}`, response.receipt.taskId, response.receipt.status, response.receipt.queued);
      if (!response.receipt.queued) openTask(response.receipt.taskId);
    } catch (error) {
      if (currentScope()) recordReceipt(error instanceof Error ? error.message : '生产未启动，请重试。');
    } finally { pipelineInFlightRef.current = false; if (currentScope()) { setLoading(false); setPipelineRefresh(value => value + 1); } }
  }, [fileGenerating, contentIntake, loading, modal, uiMessage, onSessionRefresh, openWeeklyPlanFromAssistant, persistThread, setMessages, upsertTaskCard]);
}
