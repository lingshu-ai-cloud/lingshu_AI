import { createHash } from 'node:crypto';
import type {
  Starter198InitialSetupInput,
  Starter198OrgRole,
  StarterWorkspaceCommandInput,
} from '../../shared/contracts/starter198.js';
import { Starter198CommandError } from './commandValidation.js';
import { STARTER_COLLECTIONS, type Starter198Repository } from './repository.js';
import {
  Starter198RuntimePortError,
  type Starter198InitialSetupPort,
  type Starter198OrchestratorQueuePort,
  type Starter198OrchestratorQueueResult,
} from './runtimePorts.js';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const stableHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Executes the initial-setup command as a replay-safe unit. The configuration
 * port owns business idempotency; the deterministic resume key makes healing
 * the waiting orchestrator input safe after a process or journal failure.
 */
export async function executeStarter198InitialSetupCommand(input: {
  tenantId: string;
  userId: string;
  role: Starter198OrgRole;
  commandId: string;
  request: StarterWorkspaceCommandInput;
  repository: Starter198Repository;
  initialSetup: Starter198InitialSetupPort;
  orchestratorQueue?: Starter198OrchestratorQueuePort;
  now: Date;
}): Promise<{
  state: 'succeeded';
  message: string;
  result: Record<string, unknown>;
}> {
  if (input.role !== 'owner' && input.role !== 'admin') {
    throw new Starter198CommandError('starter_198_command_forbidden', 403);
  }
  try {
    const configured = await input.initialSetup.configure({
      tenantId: input.tenantId,
      userId: input.userId,
      idempotencyKey: input.request.idempotencyKey,
      setup: (input.request.payload ?? {}) as unknown as Starter198InitialSetupInput,
    });
    const resumed = await resumeStarter198WaitingInput(input);
    return {
      state: 'succeeded',
      message: resumed?.runId
        ? '开工资料已固化，先前目标已自动进入灵小枢任务队列'
        : configured.repeated ? '开工资料已确认' : '开工资料已固化，可以告诉灵小枢本轮目标',
      result: { ...configured, resumed },
    };
  } catch (error) {
    if (error instanceof Starter198CommandError) throw error;
    if (error instanceof Starter198RuntimePortError) {
      throw new Starter198CommandError(error.code, error.status);
    }
    throw error;
  }
}

/** Resume is independently replay-safe and can therefore heal setup commands
 * after configuration committed but before the command journal finalized. */
export async function resumeStarter198WaitingInput(input: {
  tenantId: string;
  userId: string;
  commandId: string;
  repository: Starter198Repository;
  orchestratorQueue?: Starter198OrchestratorQueuePort;
  now: Date;
}): Promise<Starter198OrchestratorQueueResult | null> {
  const waitingInbox = await input.repository.list(STARTER_COLLECTIONS.orchestratorInbox, input.tenantId, {
    where: { status: 'waiting_user' }, sort: '-created_at', perPage: 20,
  });
  if (waitingInbox.totalItems > waitingInbox.items.length) {
    throw new Starter198CommandError('starter_198_orchestrator_inbox_incomplete', 503);
  }
  const waiting = waitingInbox.items.find(item => text(item.disposition) === 'awaiting_initial_confirmation');
  if (!waiting || !input.orchestratorQueue || !text(waiting.input_text)) return null;
  const resumeHash = stableHash({
    tenantId: input.tenantId,
    setupCommandId: input.commandId,
    waitingQueueItemId: text(waiting.queue_item_id),
    inputVersion: text(waiting.input_version),
  });
  const resumed = await input.orchestratorQueue.enqueue({
    tenantId: input.tenantId,
    userId: input.userId,
    commandId: `starter_resume_${resumeHash.slice(0, 32)}`,
    input: text(waiting.input_text),
    idempotencyKey: `setup-resume:${resumeHash.slice(0, 48)}`,
  });
  if (resumed.runId) {
    await input.repository.update(STARTER_COLLECTIONS.orchestratorInbox, input.tenantId, waiting.id, {
      run_id: resumed.runId,
      disposition: 'resumed_after_setup',
      status: 'succeeded',
      missing_facts: [],
      updated_at: input.now.toISOString(),
    });
  }
  return resumed;
}
