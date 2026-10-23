import type { Message } from '../../App';
import { SOCIAL_CONTENT_TASK_REFRESH_EVENT } from '../../lib/socialContentTaskRefresh';
import { contentTaskCardToAssistantCard } from '../../lib/assistantContentTaskProjection';
import { useAssistantStore, type AssistantTaskCardInput, type OrbitAgentId } from '../../stores/assistantStore';
import { AssistantContentTaskApiError, assistantContentTaskIdempotencyKey, createAtomicAssistantContentTask } from '../../lib/assistantContentTaskApi';
import { resolveAssistantEnterpriseProduct, type AssistantProductionIntent } from './assistantProductionIntake';

export async function runAssistantProductionRequest(input: {
  productionIntent: AssistantProductionIntent;
  requestMessage?: string;
  threadAgent: OrbitAgentId;
  expectedThreadVersion: number;
  currentScope: () => boolean;
  setLoading: (loading: boolean) => void;
  upsertTaskCard: (agentId: OrbitAgentId, card: AssistantTaskCardInput) => void;
  focusTaskCard: (agentId: OrbitAgentId, taskId: string | null) => void;
  hydrateThread: (agentId: OrbitAgentId, patch: Partial<ReturnType<typeof useAssistantStore.getState>['threads'][OrbitAgentId]>) => void;
  setMessages: (agentId: OrbitAgentId, messages: Message[]) => void;
  persistThread: (agentId: OrbitAgentId) => void;
  onSessionRefresh?: () => void;
  refreshPipeline: () => void;
  // Explicit dependency seams allow offline verification without external writes.
  resolveProduct?: typeof resolveAssistantEnterpriseProduct;
  createTask?: typeof createAtomicAssistantContentTask;
}) {
  const {
    productionIntent, requestMessage = productionIntent.objective, threadAgent, expectedThreadVersion, currentScope,
    setLoading, upsertTaskCard, focusTaskCard, hydrateThread, setMessages, persistThread,
    onSessionRefresh, refreshPipeline,
    resolveProduct = resolveAssistantEnterpriseProduct,
    createTask = createAtomicAssistantContentTask,
  } = input;
  try {
    const productionProduct = await resolveProduct(productionIntent.productQuery);
    if (!currentScope()) return;
    const createAtVersion = (version: number) => createTask({
      agentId: threadAgent, expectedThreadVersion: version,
      idempotencyKey: assistantContentTaskIdempotencyKey(version, productionIntent.objective),
      message: requestMessage,
      task: {
        title: productionIntent.title, objective: productionIntent.objective,
        productId: productionProduct.id, productRef: productionProduct.label,
        platforms: productionIntent.platforms, formats: productionIntent.formats,
        aspectRatio: productionIntent.aspectRatio, targetDurationSeconds: productionIntent.targetDurationSeconds,
        requestedOutputCount: 1, planningMode: 'auto_adjust', specialRequirements: productionIntent.objective,
        restrictions: [], dueAt: null,
        // Existing ContentTask maps PRD free_creation to this route; `instant`
        // remains the authoritative task mode and no parallel task is created.
        creationMode: 'material_processing', assetAvailability: 'none', managementMode: 'one_click_managed',
        productionMode: 'social_ready', productionApproach: 'ai_enhanced', mode: 'instant',
      },
    });
    let productionResponse: Awaited<ReturnType<typeof createTask>>;
    try {
      productionResponse = await createAtVersion(expectedThreadVersion);
    } catch (error) {
      const conflict = error instanceof AssistantContentTaskApiError && error.status === 409 ? error : null;
      const refreshedVersion = Number(conflict?.current?.version);
      if (!Number.isSafeInteger(refreshedVersion) || refreshedVersion < 0 || !conflict?.current || !currentScope()) throw error;
      hydrateThread(threadAgent, conflict.current);
      productionResponse = await createAtVersion(refreshedVersion);
    }
    const productionTask = productionResponse.task;
    if (!currentScope()) return;
    const authoritativeCard = productionResponse.receipt.card;
    const assistantCard = contentTaskCardToAssistantCard(authoritativeCard);
    hydrateThread(threadAgent, productionResponse.thread);
    upsertTaskCard(threadAgent, assistantCard);
    focusTaskCard(threadAgent, assistantCard.taskId);
    setLoading(false);
    onSessionRefresh?.();
    window.dispatchEvent(new CustomEvent(SOCIAL_CONTENT_TASK_REFRESH_EVENT, { detail: { taskId: productionTask.taskId } }));
    refreshPipeline();
  } catch (error) {
    if (!currentScope()) return;
    if (error instanceof AssistantContentTaskApiError && error.status === 409 && error.current) {
      hydrateThread(threadAgent, error.current);
      onSessionRefresh?.();
      return;
    }
    const message = error instanceof Error ? error.message : '内容任务创建失败，请稍后重试。';
    const currentMessages = useAssistantStore.getState().threads[threadAgent].messages;
    const visibleMessages = currentMessages.at(-1)?.role === 'user' && currentMessages.at(-1)?.content === requestMessage
      ? currentMessages : [...currentMessages, { role: 'user' as const, content: requestMessage }];
    setMessages(threadAgent, [
      ...visibleMessages,
      { role: 'assistant', content: `单条内容任务尚未建立：${message}` },
    ]);
    persistThread(threadAgent);
  } finally {
    // Loading belongs to the mounted assistant instance even if its scope changes.
    setLoading(false);
  }
}
