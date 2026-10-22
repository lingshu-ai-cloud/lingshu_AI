import { App as AntApp, Input } from 'antd';
import type { Message } from '../../App';
import { socialContentApi } from '../../lib/socialContentApi';
import { WEEKLY_WORK_UPDATED_EVENT } from '../../lib/weeklyWorkEvents';
import { useAssistantStore, type AssistantTaskCardInput, type OrbitAgentId } from '../../stores/assistantStore';
import { resolveAssistantEnterpriseProduct, type AssistantProductionIntent } from './assistantProductionIntake';

type ModalApi = ReturnType<typeof AntApp.useApp>['modal'];
type MessageApi = ReturnType<typeof AntApp.useApp>['message'];

export async function runAssistantProductionRequest(input: {
  productionIntent: AssistantProductionIntent;
  threadAgent: OrbitAgentId;
  currentScope: () => boolean;
  pipelineModalOpenRef: { current: boolean };
  modal: ModalApi;
  uiMessage: MessageApi;
  setLoading: (loading: boolean) => void;
  upsertTaskCard: (agentId: OrbitAgentId, card: AssistantTaskCardInput) => void;
  setMessages: (agentId: OrbitAgentId, messages: Message[]) => void;
  persistThread: (agentId: OrbitAgentId) => void;
  onSessionRefresh?: () => void;
  refreshPipeline: () => void;
  closeForNavigation: () => void;
  requestId: () => string;
  // Explicit dependency seams allow offline verification without external writes.
  confirmDueAt?: (objective: string) => Promise<string | null>;
  resolveProduct?: typeof resolveAssistantEnterpriseProduct;
  createTask?: typeof socialContentApi.createAssistantAction;
}) {
  const {
    productionIntent, threadAgent, currentScope, pipelineModalOpenRef, modal,
    uiMessage, setLoading, upsertTaskCard, setMessages, persistThread,
    onSessionRefresh, refreshPipeline, closeForNavigation, requestId,
    resolveProduct = resolveAssistantEnterpriseProduct,
    createTask = socialContentApi.createAssistantAction,
  } = input;
  const confirmDueAt = input.confirmDueAt ?? ((objective: string) => new Promise<string | null>(resolve => {
    if (pipelineModalOpenRef.current) { resolve(null); return; }
    pipelineModalOpenRef.current = true;
    let dueAt = '';
    modal.confirm({ title: '确认单条内容任务',
      content: <div className="space-y-3"><p>{objective}</p>
        <label className="block">交付截止时间<Input type="datetime-local" onChange={event => { dueAt = event.target.value; }} /></label>
        <p>任务将加入周任务并立即尝试生产。</p></div>,
      okText: '创建并执行', cancelText: '取消',
      afterClose: () => { pipelineModalOpenRef.current = false; },
      onOk: () => {
        if (!dueAt || new Date(dueAt).getTime() <= Date.now()) {
          void uiMessage.error('请选择未来的交付截止时间。');
          return Promise.reject(new Error('请选择未来的交付截止时间。'));
        }
        resolve(new Date(dueAt).toISOString());
      },
      onCancel: () => resolve(null),
    });
  }));

  try {
    const productionProduct = await resolveProduct(productionIntent.productQuery);
    if (!currentScope()) return;
    setLoading(false);
    const confirmedDueAt = await confirmDueAt(productionIntent.objective);
    if (!confirmedDueAt || !currentScope()) return;
    setLoading(true);
    const productionResponse = await createTask({
      title: productionIntent.title,
      objective: productionIntent.objective,
      productId: productionProduct.id,
      productRef: productionProduct.label,
      platforms: productionIntent.platforms,
      formats: productionIntent.formats,
      aspectRatio: productionIntent.aspectRatio,
      targetDurationSeconds: productionIntent.targetDurationSeconds,
      requestedOutputCount: 1,
      planningMode: 'auto_adjust',
      specialRequirements: productionIntent.objective,
      restrictions: [],
      mode: 'weekly',
      dueAt: confirmedDueAt,
      creationMode: 'material_processing',
      assetAvailability: 'none',
      managementMode: 'one_click_managed',
      productionMode: 'social_ready',
      productionApproach: 'ai_enhanced',
    }, `assistant-production-${requestId()}`);
    const productionTask = productionResponse.task;
    if (!currentScope()) return;
    const productionStatus = productionResponse.receipt.status;
    upsertTaskCard(threadAgent, {
      taskId: `social-content:${productionTask.taskId}`,
      title: productionTask.brief.title,
      conclusion: productionResponse.receipt.blockedReason ? '任务已保存，请处理生产条件。' : productionResponse.receipt.started ? '生产已启动，交付物回收到此周任务。' : '任务已保存，等待生产条件。',
      status: productionStatus === 'producing' ? 'running' : ['completed', 'delivered', 'published'].includes(productionStatus) ? 'completed' : productionStatus === 'paused' ? 'paused' : 'needs_input',
      notificationReason: 'routine',
      primaryAction: { id: `open-${productionTask.taskId}`, label: '查看生产任务', href: `/?page=smartAssets&view=create&socialContentTaskId=${encodeURIComponent(productionTask.taskId)}` },
    });
    setMessages(threadAgent, [
      ...useAssistantStore.getState().threads[threadAgent].messages,
      { role: 'assistant', content: `已创建周任务「${productionTask.brief.title}」。${productionResponse.receipt.blockedReason ? '暂未进入生产，请在任务中查看所需资料或服务状态。' : (productionResponse.receipt.started ? '生产已启动，交付物将回收到该任务。' : '任务已保存，等待生产条件。')}` },
    ]);
    setLoading(false);
    persistThread(threadAgent);
    onSessionRefresh?.();
    window.dispatchEvent(new CustomEvent(WEEKLY_WORK_UPDATED_EVENT));
    refreshPipeline();
    closeForNavigation();
    window.dispatchEvent(new CustomEvent('lingshu:navigate', {
      detail: {
        page: 'smartAssets', view: 'create', directStudio: true,
        socialContentTaskId: productionTask.taskId,
        socialContentPage: 'smartAssets',
      },
    }));
  } catch (error) {
    if (!currentScope()) return;
    const message = error instanceof Error ? error.message : '内容任务创建失败，请稍后重试。';
    setMessages(threadAgent, [
      ...useAssistantStore.getState().threads[threadAgent].messages,
      { role: 'assistant', content: `没有生成文本脚本：内容 Agent 任务创建失败。${message}` },
    ]);
    persistThread(threadAgent);
  } finally {
    // Loading belongs to the mounted assistant instance even if its scope changes.
    setLoading(false);
  }
}
