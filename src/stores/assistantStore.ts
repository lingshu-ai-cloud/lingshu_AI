import { create } from 'zustand';
import type { Message } from '../App';
import type { AssistantActionId, AssistantActionTarget, AssistantCardItem } from '../../shared/contracts/assistantActions';

export type OrbitAgentId = 'business' | 'director' | 'content' | 'customer';

export type AssistantSurface = 'floating-reminder' | 'conversation' | 'decision';
export type AssistantNotificationReason = 'missing_input' | 'approval_required' | 'failed' | 'routine';
export type AssistantTaskStatus = 'needs_input' | 'approval' | 'ready' | 'running' | 'paused' | 'failed' | 'completed';

export interface AssistantCardAction {
  id: string;
  label: string;
  actionId?: AssistantActionId;
  href?: string;
  target?: AssistantActionTarget;
  parameters?: Record<string, unknown>;
  prompt?: string;
  disabled?: boolean;
}

export interface AssistantTaskCard {
  taskId: string;
  title: string;
  conclusion: string;
  details: string[];
  items: AssistantCardItem[];
  status: AssistantTaskStatus;
  notificationReason: AssistantNotificationReason;
  primaryAction?: AssistantCardAction;
  secondaryActions: AssistantCardAction[];
  workspace?: { label: string; href: string };
  updatedAt: number;
}

export type AssistantRunControl = {
  actionId: 'pause_task' | 'resume_task';
  target: AssistantActionTarget & { objectType: 'run'; objectId: string; expectedVersion: string };
};

export type AssistantTaskCardInput = Omit<AssistantTaskCard, 'details' | 'items' | 'secondaryActions' | 'updatedAt'> & {
  details?: string[];
  items?: AssistantCardItem[];
  secondaryActions?: AssistantCardAction[];
  updatedAt?: number;
};

export interface AgentThreadState {
  version: number;
  updatedAt: string;
  messages: Message[];
  draftInput: string;
  scrollPosition: number;
  unreadCount: number;
  isFollowingLatest: boolean;
  paused: boolean;
  taskCards: Record<string, AssistantTaskCard>;
  focusedTaskId: string | null;
}

type AssistantStore = {
  threads: Record<OrbitAgentId, AgentThreadState>;
  setMessages: (agentId: OrbitAgentId, messages: Message[]) => void;
  setDraftInput: (agentId: OrbitAgentId, draftInput: string) => void;
  setScrollPosition: (agentId: OrbitAgentId, scrollPosition: number) => void;
  setUnreadCount: (agentId: OrbitAgentId, unreadCount: number) => void;
  setFollowingLatest: (agentId: OrbitAgentId, isFollowingLatest: boolean) => void;
  setPaused: (agentId: OrbitAgentId, paused: boolean) => void;
  upsertTaskCard: (agentId: OrbitAgentId, card: AssistantTaskCardInput) => void;
  focusTaskCard: (agentId: OrbitAgentId, taskId: string | null) => void;
  hydrateThread: (agentId: OrbitAgentId, patch: Partial<AgentThreadState>) => void;
  setPersistenceMetadata: (agentId: OrbitAgentId, version: number, updatedAt: string) => void;
};

export function shouldNotifyAssistant(reason: AssistantNotificationReason): boolean {
  return reason === 'missing_input' || reason === 'approval_required' || reason === 'failed';
}

const ACTION_TARGET_TYPES: Partial<Record<AssistantActionId, AssistantActionTarget['objectType']>> = {
  pause_task: 'run',
  resume_task: 'run',
  confirm_choice: 'approval',
  accept_result: 'approval',
  request_revision: 'approval',
  confirm_schedule_change: 'schedule_change',
};

/**
 * Returns a target only when a server-authored card exposes one unambiguous,
 * versioned action target. Card/task ids are intentionally never used as a
 * substitute for an executable business target.
 */
export function assistantActionTarget(
  card: AssistantTaskCard | null | undefined,
  actionId: AssistantActionId,
): AssistantActionTarget | undefined {
  if (!card) return undefined;
  const expectedObjectType = ACTION_TARGET_TYPES[actionId];
  if (!expectedObjectType) return undefined;
  const candidates = [card.primaryAction, ...card.secondaryActions]
    .filter(action => action?.actionId === actionId)
    .map(action => action?.target)
    .filter((target): target is AssistantActionTarget & { objectId: string; expectedVersion: string } => (
      target?.objectType === expectedObjectType
      && typeof target.objectId === 'string'
      && Boolean(target.objectId.trim())
      && typeof target.expectedVersion === 'string'
      && Boolean(target.expectedVersion.trim())
    ))
    .map(target => ({
      objectType: target.objectType,
      objectId: target.objectId.trim(),
      expectedVersion: target.expectedVersion.trim(),
    }));
  const uniqueTargets = [...new Map(candidates.map(target => [
    `${target.objectType}:${target.objectId}:${target.expectedVersion}`,
    target,
  ])).values()];
  return uniqueTargets.length === 1 ? uniqueTargets[0] : undefined;
}

export function assistantRunControl(card: AssistantTaskCard | null | undefined): AssistantRunControl | null {
  if (!card || (card.status !== 'running' && card.status !== 'paused')) return null;
  const actionId = card.status === 'paused' ? 'resume_task' : 'pause_task';
  const target = assistantActionTarget(card, actionId);
  if (!target || target.objectType !== 'run' || !target.objectId || !target.expectedVersion) return null;
  return {
    actionId,
    target: {
      objectType: 'run',
      objectId: target.objectId,
      expectedVersion: target.expectedVersion,
    },
  };
}

export function normalizeAssistantTaskCard(card: AssistantTaskCardInput): AssistantTaskCard {
  const normalizeActions = (actions: AssistantCardAction[] | undefined, limit: number) => (actions ?? [])
    .filter(action => Boolean(action?.id?.trim() && action?.label?.trim()))
    .slice(0, limit)
    .map(action => ({
      ...action,
      id: action.id.trim(),
      label: action.label.trim(),
      prompt: action.prompt?.trim() || undefined,
    }));
  const [primaryAction] = normalizeActions(card.primaryAction ? [card.primaryAction] : [], 1);
  return {
    ...card,
    taskId: card.taskId.trim(),
    title: card.title.trim(),
    conclusion: card.conclusion.trim(),
    details: (card.details ?? []).map(detail => detail.trim()).filter(Boolean).slice(0, 3),
    items: (card.items ?? []).filter(item => Boolean(item?.id?.trim() && item?.title?.trim())).slice(0, 20).map(item => ({
      ...item,
      id: item.id.trim(),
      title: item.title.trim(),
      thumbnailUrl: item.thumbnailUrl?.trim() || undefined,
      accountLabel: item.accountLabel?.trim() || undefined,
      transition: item.transition?.trim() || undefined,
      note: item.note?.trim() || undefined,
    })),
    primaryAction,
    secondaryActions: normalizeActions(card.secondaryActions, 2),
    updatedAt: Number.isFinite(card.updatedAt) ? Number(card.updatedAt) : Date.now(),
  };
}

export function upsertAssistantTaskCard(
  cards: Record<string, AssistantTaskCard>,
  card: AssistantTaskCardInput,
): Record<string, AssistantTaskCard> {
  const normalized = normalizeAssistantTaskCard(card);
  const previous = cards[normalized.taskId];
  return {
    ...cards,
    [normalized.taskId]: previous
      ? { ...previous, ...normalized, updatedAt: normalized.updatedAt }
      : normalized,
  };
}

const emptyThread = (): AgentThreadState => ({
  version: 0,
  updatedAt: '',
  messages: [],
  draftInput: '',
  scrollPosition: 0,
  unreadCount: 0,
  isFollowingLatest: true,
  paused: false,
  taskCards: {},
  focusedTaskId: null,
});

function normalizeHydratedThread(current: AgentThreadState, patch: Partial<AgentThreadState>): AgentThreadState {
  return {
    ...current,
    ...patch,
    messages: Array.isArray(patch.messages) ? patch.messages : current.messages,
    taskCards: patch.taskCards && typeof patch.taskCards === 'object' ? patch.taskCards : current.taskCards,
    focusedTaskId: typeof patch.focusedTaskId === 'string' || patch.focusedTaskId === null
      ? patch.focusedTaskId
      : current.focusedTaskId,
    isFollowingLatest: typeof patch.isFollowingLatest === 'boolean'
      ? patch.isFollowingLatest
      : current.isFollowingLatest,
    paused: typeof patch.paused === 'boolean' ? patch.paused : current.paused,
    version: Number.isSafeInteger(patch.version) && Number(patch.version) >= 0
      ? Number(patch.version)
      : current.version,
    updatedAt: typeof patch.updatedAt === 'string' ? patch.updatedAt : current.updatedAt,
  };
}

export const ORBIT_AGENT_IDS: OrbitAgentId[] = ['business', 'director', 'content', 'customer'];

export const useAssistantStore = create<AssistantStore>((set) => ({
  threads: {
    business: emptyThread(),
    director: emptyThread(),
    content: emptyThread(),
    customer: emptyThread(),
  },
  setMessages: (agentId, messages) => set(state => ({
    threads: { ...state.threads, [agentId]: { ...state.threads[agentId], messages } },
  })),
  setDraftInput: (agentId, draftInput) => set(state => ({
    threads: { ...state.threads, [agentId]: { ...state.threads[agentId], draftInput } },
  })),
  setScrollPosition: (agentId, scrollPosition) => set(state => ({
    threads: { ...state.threads, [agentId]: { ...state.threads[agentId], scrollPosition } },
  })),
  setUnreadCount: (agentId, unreadCount) => set(state => ({
    threads: { ...state.threads, [agentId]: { ...state.threads[agentId], unreadCount } },
  })),
  setFollowingLatest: (agentId, isFollowingLatest) => set(state => ({
    threads: { ...state.threads, [agentId]: { ...state.threads[agentId], isFollowingLatest } },
  })),
  setPaused: (agentId, paused) => set(state => ({
    threads: { ...state.threads, [agentId]: { ...state.threads[agentId], paused } },
  })),
  upsertTaskCard: (agentId, card) => set(state => ({
    threads: {
      ...state.threads,
      [agentId]: {
        ...state.threads[agentId],
        taskCards: upsertAssistantTaskCard(state.threads[agentId].taskCards, card),
      },
    },
  })),
  focusTaskCard: (agentId, taskId) => set(state => ({
    threads: { ...state.threads, [agentId]: { ...state.threads[agentId], focusedTaskId: taskId } },
  })),
  hydrateThread: (agentId, patch) => set(state => ({
    threads: { ...state.threads, [agentId]: normalizeHydratedThread(state.threads[agentId], patch) },
  })),
  setPersistenceMetadata: (agentId, version, updatedAt) => set(state => {
    const current = state.threads[agentId];
    if (!Number.isSafeInteger(version) || version < current.version) return state;
    return {
      threads: {
        ...state.threads,
        [agentId]: { ...current, version, updatedAt },
      },
    };
  }),
}));
