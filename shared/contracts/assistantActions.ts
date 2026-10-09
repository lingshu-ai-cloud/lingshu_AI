/**
 * Stable contract between the Lingxiaoshu conversation entry and deterministic
 * business operations.  Button clicks and parsed natural-language intents use
 * the same `AssistantActionId`; only the input source differs.
 */

export const ASSISTANT_ACTION_IDS = [
  'open_workspace',
  'view_status',
  'search',
  'prepare_schedule_change',
  'confirm_schedule_change',
  'start_task',
  'pause_task',
  'resume_task',
  'confirm_choice',
  'accept_result',
  'request_revision',
] as const;

export type AssistantActionId = typeof ASSISTANT_ACTION_IDS[number];
export type AssistantActionSource = 'button' | 'natural_language';
export type AssistantActionObjectType = 'workspace' | 'run' | 'approval' | 'result' | 'search' | 'schedule_change';

export type AssistantActionTarget = {
  objectType: AssistantActionObjectType;
  objectId?: string;
  /** Immutable business version shown by the card that initiated the action. */
  expectedVersion?: string;
};

export type AssistantActionRequest = {
  source: AssistantActionSource;
  /** Required for button actions; inferred for natural-language actions. */
  actionId?: AssistantActionId;
  text?: string;
  requestId: string;
  page?: string;
  target?: AssistantActionTarget;
  parameters?: Record<string, unknown>;
};

export type AssistantActionIntent = {
  actionId: AssistantActionId | 'delegate_to_agent';
  confidence: number;
  target?: AssistantActionTarget;
  parameters: Record<string, unknown>;
  /**
   * The text appears to request a state change, but could not be bound to one
   * deterministic action. Such input must never fall through to a chat model.
   */
  requiresSignedAction?: boolean;
};

export type AssistantCardAction = {
  id: string;
  label: string;
  actionId?: AssistantActionId;
  href?: string;
  target?: AssistantActionTarget;
  /**
   * Server-authored, action-specific input. Clients may echo this value when
   * the action is invoked, but the server still validates every key/value.
   */
  parameters?: Record<string, unknown>;
  /** Optional display-only follow-up copied into the composer. */
  prompt?: string;
};

export type AssistantCardItem = {
  id: string;
  title: string;
  thumbnailUrl?: string;
  accountLabel?: string;
  transition?: string;
  note?: string;
};

export type AssistantCompactCard = {
  kind: 'operation_result' | 'decision' | 'search_results' | 'status';
  title: string;
  summary: string;
  /** A compact answer contains at most three necessary details. */
  details: string[];
  /** Real business records used by visual confirmation cards. */
  items?: AssistantCardItem[];
  primaryAction?: AssistantCardAction;
  /** A card contains at most two secondary actions. */
  secondaryActions?: AssistantCardAction[];
};

export type AssistantWorkspaceLink = {
  label: string;
  href: string;
};

export type AssistantNotification = {
  reason: 'missing_required_input' | 'approval_required' | 'failure';
  message: string;
};

export type AssistantActionStatus =
  | 'completed'
  | 'accepted'
  | 'delegated'
  /** No deterministic handler or real delegator accepted this input. */
  | 'not_handled'
  | 'missing_required_input'
  | 'approval_required'
  | 'stale_action'
  | 'failed';

export type AssistantActionResponse = {
  status: AssistantActionStatus;
  actionId: AssistantActionId | 'delegate_to_agent';
  requestId: string;
  version?: string;
  card: AssistantCompactCard;
  workspace?: AssistantWorkspaceLink;
  /** `null` means routine progress remains silent. */
  notification: AssistantNotification | null;
  errorCode?: string;
};

export function isAssistantActionId(value: unknown): value is AssistantActionId {
  return typeof value === 'string' && (ASSISTANT_ACTION_IDS as readonly string[]).includes(value);
}
