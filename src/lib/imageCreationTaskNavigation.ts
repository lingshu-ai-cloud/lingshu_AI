import { z } from 'zod';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation';
import { productionNavigationIdentity, stampProductionHistoryState } from './productionNavigation';
import { productionPortalNavigation } from '../components/assistant/AssistantProductionPortal';

const targetSchema = z.object({ socialContentTaskId: z.string().min(1).max(200), imageTaskId: z.string().min(1).max(200) });
const pending = new Set<string>();
const key = (id: string) => `${productionNavigationIdentity()}:${id}`;
export const imageCreationStartPending = (id: string) => pending.has(key(id));
export const clearImageCreationStart = (id: string) => pending.delete(key(id));
export function readImageCreationTaskTarget() {
  const query = new URLSearchParams(window.location.search);
  if (query.get('page') !== 'socialInspiration') return null;
  const parsed = targetSchema.safeParse({ socialContentTaskId: query.get('socialContentTaskId') || query.get('taskId'), imageTaskId: query.get('imageTaskId') });
  return parsed.success ? parsed.data : null;
}
/** Navigation reuses the baseline task workspace; the one-time start is never serialized into history. */
export function openImageCreationTask(task: SocialImageCreationTask, start = false) {
  const contentId = task.productionRuntime?.binding?.contentTaskId;
  if (!contentId) throw new Error('图片任务缺少内容任务关联，无法定位创作任务。');
  if (start) pending.add(key(task.id));
  const detail = { ...productionPortalNavigation(contentId), imageTaskId: task.id, navigationIdentity: productionNavigationIdentity() };
  window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail }));
  const url = new URL(window.location.href);
  url.searchParams.set('page', 'socialInspiration'); url.searchParams.set('view', 'tasks');
  url.searchParams.set('taskId', contentId); url.searchParams.set('socialContentTaskId', contentId);
  url.searchParams.set('imageTaskId', task.id); url.searchParams.delete('project');
  window.history.replaceState(stampProductionHistoryState({ ...window.history.state, productionDetail: detail }), '', url);
}
