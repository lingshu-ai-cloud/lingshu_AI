import type { StarterWorkspaceCommandInput } from '../../shared/contracts/starter198.js';
import type { Starter198Repository, StarterRecord } from './repository.js';
import { Starter198CommandError } from './commandValidation.js';
import {
  assertStarter198CancellationGraph,
  listStarter198PendingApprovals,
  requireStarter198Approval,
  requireStarter198Run,
  Starter198WorkflowScopeError,
} from './workflowScope.js';

function mapScopeError(error: unknown): never {
  if (error instanceof Starter198WorkflowScopeError) {
    throw new Starter198CommandError(error.code, error.status);
  }
  throw error;
}

export async function requireStarterRunForCommand(
  repository: Starter198Repository,
  tenantId: string,
  runId: string,
): Promise<StarterRecord> {
  try { return await requireStarter198Run(repository, tenantId, runId); }
  catch (error) { return mapScopeError(error); }
}

export async function requireStarterApprovalForCommand(input: {
  repository: Starter198Repository;
  tenantId: string;
  approvalId: string;
}): ReturnType<typeof requireStarter198Approval> {
  try { return await requireStarter198Approval(input); }
  catch (error) { return mapScopeError(error); }
}

export async function starterPendingApprovalsForCommand(input: {
  repository: Starter198Repository;
  tenantId: string;
  run: StarterRecord;
}): Promise<StarterRecord[]> {
  try { return await listStarter198PendingApprovals(input); }
  catch (error) { return mapScopeError(error); }
}

export async function assertStarterCancellationForCommand(input: {
  repository: Starter198Repository;
  tenantId: string;
  run: StarterRecord;
}): Promise<{ tasks: StarterRecord[]; approvals: StarterRecord[] }> {
  try { return await assertStarter198CancellationGraph(input); }
  catch (error) { return mapScopeError(error); }
}

/** Validate object ownership without re-applying mutable state/version checks on an idempotent replay. */
export async function assertStarterReplayTargetScope(input: {
  repository: Starter198Repository;
  tenantId: string;
  request: StarterWorkspaceCommandInput;
}): Promise<void> {
  const targetId = input.request.targetId ?? '';
  if (['pause_run', 'resume_run', 'cancel_run'].includes(input.request.command) && targetId) {
    await requireStarterRunForCommand(input.repository, input.tenantId, targetId);
  }
  if (input.request.command === 'resolve_decision' && targetId && !targetId.startsWith('quote:')) {
    await requireStarterApprovalForCommand({
      repository: input.repository, tenantId: input.tenantId, approvalId: targetId,
    });
  }
}
