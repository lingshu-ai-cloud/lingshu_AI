export const CONTENT_GENERATION_QUEUE_OPEN_EVENT = 'lingshu:open-content-generation-queue';
export const AGENT_SETTINGS_OPEN_EVENT = 'lingshu:open-agent-settings';

export type ContentGenerationQueueView = 'tasks' | 'calendar';
export type ContentGenerationQueueMetric = 'all' | 'planned' | 'producing' | 'waiting_review' | 'completed' | 'scheduled';
export type ContentGenerationQueueSource = 'all' | 'weekly' | 'single';
export type ContentGenerationQueueStatus = 'all' | 'completed' | 'creating' | 'confirmation';

export interface ContentGenerationQueueRequest {
  requestId?: number;
  view?: ContentGenerationQueueView;
  metric?: ContentGenerationQueueMetric;
  source?: ContentGenerationQueueSource;
  status?: ContentGenerationQueueStatus;
  taskId?: string;
  contentId?: string;
}

let requestSequence = 0;

/** Open the one global content-generation queue without changing the current page. */
export function openContentGenerationQueue(request: ContentGenerationQueueRequest = {}) {
  requestSequence += 1;
  window.dispatchEvent(new CustomEvent<ContentGenerationQueueRequest>(CONTENT_GENERATION_QUEUE_OPEN_EVENT, {
    detail: { requestId: requestSequence, view: 'tasks', metric: 'all', source: 'all', status: 'all', ...request },
  }));
}

export function openAgentSettings() {
  window.dispatchEvent(new CustomEvent(AGENT_SETTINGS_OPEN_EVENT));
}
