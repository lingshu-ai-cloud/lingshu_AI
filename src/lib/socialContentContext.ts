import type {WeeklyContentNavigation} from '../../shared/contracts/weeklyContentNavigation';
import {parseWeeklyContentNavigation} from './weeklyContentNavigationApi';
const ACTIVE_SOCIAL_CONTENT_TASK_KEY = 'lingshu_active_social_content_task';
export const SOCIAL_CONTENT_NAVIGATION_EVENT = 'lingshu:social-content-navigation';

export interface SocialContentNavigationState {
  socialContentTaskId: string;
  socialContentPage: string;
  weeklyContentTarget?: WeeklyContentNavigation;
}

export interface SocialContentNavigationEventDetail {
  taskId: string;
  page: string;
}

const SOCIAL_CONTENT_CONTEXT_PAGES = new Set([
  'enterprise',
  'socialInspiration',
  'scriptLibrary',
  'smartAssets',
  'traffic',
  'accountManagement',
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function taskIdFrom(value: unknown, page: string): string | null {
  const candidate = record(value);
  if (candidate.socialContentPage !== page || typeof candidate.socialContentTaskId !== 'string') return null;
  const taskId = candidate.socialContentTaskId.trim();
  return /^[a-z0-9:_-]{1,200}$/i.test(taskId) ? taskId : null;
}

/** Reads the task handoff for the page being opened without accepting state from another page. */
export function readSocialContentNavigationTaskId(page: string, historyState: unknown): string | null {
  const state = record(historyState);
  return taskIdFrom(state.productionDetail, page) || taskIdFrom(state, page);
}

export function readWeeklyContentNavigationTarget(historyState: unknown): WeeklyContentNavigation | null {
  const state = record(historyState), detail = record(state.productionDetail);
  const value = detail.weeklyContentTarget ?? state.weeklyContentTarget;
  if (!value) return null;
  const scope = record(record(value).scope);
  if (!['tenantId','programId','packageId','executionTaskId'].every(key => typeof scope[key] === 'string' && String(scope[key]).trim()) || typeof scope.packageVersion !== 'number') return null;
  try {
    const target = parseWeeklyContentNavigation(value, {tenantId: String(scope.tenantId), programId: String(scope.programId), packageId: String(scope.packageId), packageVersion: scope.packageVersion, executionTaskId: String(scope.executionTaskId)});
    if (readSocialContentNavigationTaskId('smartAssets', historyState) !== target.contentTaskId) return null;
    return target;
  } catch { return null; }
}

/** Adds a server-verifiable task handoff only for the exact professional page currently open. */
export function socialContentTaskRequestHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const page = new URLSearchParams(window.location.search).get('page') || '';
  if (!SOCIAL_CONTENT_CONTEXT_PAGES.has(page)) return {};
  const taskId = readSocialContentNavigationTaskId(page, window.history.state);
  return taskId ? {
    'X-Lingshu-Social-Task-Id': taskId,
    'X-Lingshu-Social-Page': page,
  } : {};
}

export function readActiveSocialContentTaskId(): string | null {
  try {
    const value = localStorage.getItem(ACTIVE_SOCIAL_CONTENT_TASK_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function setActiveSocialContentTaskId(taskId: string | null): void {
  try {
    if (taskId) localStorage.setItem(ACTIVE_SOCIAL_CONTENT_TASK_KEY, taskId);
    else localStorage.removeItem(ACTIVE_SOCIAL_CONTENT_TASK_KEY);
  } catch {
    // The in-memory workspace remains authoritative when storage is unavailable.
  }
}

export function attachSocialContentNavigationState(taskId: string, page: string, weeklyContentTarget?: WeeklyContentNavigation): void {
  setActiveSocialContentTaskId(taskId);
  const current = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
  const currentDetail = current.productionDetail && typeof current.productionDetail === 'object'
    ? current.productionDetail
    : {};
  const {weeklyContentTarget: previousTarget, ...cleanCurrent} = current;
  const {weeklyContentTarget: previousDetailTarget, ...cleanDetail} = currentDetail;
  void previousTarget; void previousDetailTarget;
  window.history.replaceState({
    ...cleanCurrent,
    socialContentTaskId: taskId,
    socialContentPage: page,
    productionDetail: {
      ...cleanDetail,
      socialContentTaskId: taskId,
      socialContentPage: page,
      ...(weeklyContentTarget ? {weeklyContentTarget} : {}),
    },
  }, '');
  window.dispatchEvent(new CustomEvent<SocialContentNavigationEventDetail>(
    SOCIAL_CONTENT_NAVIGATION_EVENT,
    { detail: { taskId, page } },
  ));
}
