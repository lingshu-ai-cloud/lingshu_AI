import type {
  Starter198OrgRole,
  Starter198QuoteInquiryInput,
  Starter198QuoteRuleSetupInput,
  StarterWorkspaceCommandInput,
  StarterWorkspaceCommandResult,
} from '../../shared/contracts/starter198.js';
import { Starter198CommandError } from './commandValidation.js';
import type { Starter198Repository } from './repository.js';
import { STARTER_COLLECTIONS } from './repository.js';
import {
  Starter198RuntimePortError,
  type Starter198QuoteSelfServicePort,
} from './runtimePorts.js';

type ProcessingCommandRecord = {
  id: string;
  command_id?: unknown;
  created_by?: unknown;
};

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/**
 * Forward-recovers quote commands whose business write may have committed
 * before the command journal could be finalized. The caller has already
 * verified authorization, payload shape and the original request hash.
 *
 * Both quote operations own deterministic business idempotency keys, so
 * replaying the exact request is safe. A missing port returns null and lets
 * the command layer retain the journal in `processing`/unknown state.
 */
export async function recoverProcessingQuoteCommand(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  role: Starter198OrgRole;
  request: StarterWorkspaceCommandInput;
  record: ProcessingCommandRecord;
  quoteSelfService?: Starter198QuoteSelfServicePort;
  now: Date;
}): Promise<{ status: 200; body: StarterWorkspaceCommandResult } | null> {
  const command = input.request.command;
  if ((command !== 'confirm_quote_rule' && command !== 'submit_quote_inquiry')
    || !input.quoteSelfService) return null;

  let message: string;
  let operationResult: Record<string, unknown>;
  const originalUserId = text(input.record.created_by) || input.userId;
  try {
    if (command === 'confirm_quote_rule') {
      if (input.role !== 'owner' && input.role !== 'admin') {
        throw new Starter198CommandError('starter_198_command_forbidden', 403);
      }
      const rule = await input.quoteSelfService.confirmRule({
        tenantId: input.tenantId,
        userId: originalUserId,
        role: input.role,
        setup: (input.request.payload ?? {}) as unknown as Starter198QuoteRuleSetupInput,
        idempotencyKey: input.request.idempotencyKey,
      });
      message = rule.created ? '报价规则已确认并锁定版本' : '当前报价规则已确认';
      operationResult = rule;
    } else {
      if (input.role !== 'owner' && input.role !== 'admin' && input.role !== 'customer_service') {
        throw new Starter198CommandError('starter_198_command_forbidden', 403);
      }
      const quote = await input.quoteSelfService.submitInquiry({
        tenantId: input.tenantId,
        userId: originalUserId,
        role: input.role,
        inquiry: (input.request.payload ?? {}) as unknown as Starter198QuoteInquiryInput,
        idempotencyKey: input.request.idempotencyKey,
      });
      message = quote.repeated ? '已返回同一询盘的报价草稿' : '报价已按确认规则计算，等待人工审核';
      operationResult = quote;
    }
  } catch (error) {
    if (error instanceof Starter198CommandError) throw error;
    if (error instanceof Starter198RuntimePortError) {
      throw new Starter198CommandError(error.code, error.status);
    }
    throw new Starter198CommandError('starter_198_quote_recovery_failed', 503);
  }

  const result: StarterWorkspaceCommandResult = {
    accepted: true,
    commandId: text(input.record.command_id) || null,
    message,
  };
  try {
    await input.repository.update(STARTER_COLLECTIONS.commands, input.tenantId, input.record.id, {
      status: 'succeeded',
      http_status: 200,
      result,
      operation_result: operationResult,
      error_code: '',
      updated_at: input.now.toISOString(),
    });
  } catch {
    throw new Starter198CommandError('starter_198_command_journal_finalize_failed', 503);
  }
  return { status: 200, body: result };
}
