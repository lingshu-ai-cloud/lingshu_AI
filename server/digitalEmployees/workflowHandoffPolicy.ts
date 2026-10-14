export type ActiveWorkflowHandoff = {
  id: string;
  taskId: string;
  takenBy: string;
  startedAt?: string;
};

export type WorkflowHandoffAdmission =
  | { kind: 'create' }
  | { kind: 'reuse'; handoff: ActiveWorkflowHandoff }
  | {
      kind: 'conflict';
      code: 'handoff_owned_by_another_user' | 'run_handoff_already_active';
      activeHandoffs: ActiveWorkflowHandoff[];
    };

/**
 * A workflow run has one human controller at a time. Replaying the same
 * takeover by the same user is idempotent; every other active-session shape
 * is rejected instead of silently switching or adding controllers.
 */
export function planWorkflowHandoffAdmission(
  activeHandoffs: readonly ActiveWorkflowHandoff[],
  input: { taskId: string; userId: string },
): WorkflowHandoffAdmission {
  if (!activeHandoffs.length) return { kind: 'create' };
  if (activeHandoffs.length === 1 && activeHandoffs[0]!.taskId === input.taskId) {
    const handoff = activeHandoffs[0]!;
    return handoff.takenBy === input.userId
      ? { kind: 'reuse', handoff }
      : { kind: 'conflict', code: 'handoff_owned_by_another_user', activeHandoffs: [...activeHandoffs] };
  }
  return { kind: 'conflict', code: 'run_handoff_already_active', activeHandoffs: [...activeHandoffs] };
}

export function planWorkflowHandoffReturn(
  activeHandoffs: readonly ActiveWorkflowHandoff[],
  returnedHandoffId: string,
): {
  canResumeRun: boolean;
  remainingActiveHandoffs: ActiveWorkflowHandoff[];
  remainingController: string;
} {
  const remainingActiveHandoffs = activeHandoffs.filter(handoff => handoff.id !== returnedHandoffId);
  return {
    canResumeRun: remainingActiveHandoffs.length === 0,
    remainingActiveHandoffs,
    remainingController: remainingActiveHandoffs[0]?.takenBy || '',
  };
}
