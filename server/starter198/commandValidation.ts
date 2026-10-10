import type {
  Starter198Command,
  StarterWorkspaceCommandInput,
} from '../../shared/contracts/starter198.js';

export class Starter198CommandError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'Starter198CommandError';
  }
}

export const STARTER_198_COMMAND_SET = new Set<Starter198Command>([
  'confirm_initial_setup',
  'confirm_quote_rule',
  'submit_quote_inquiry',
  'submit_orchestrator_input',
  'resolve_decision',
  'pause_run',
  'resume_run',
  'cancel_run',
  'generate_publication_package',
  'submit_publication_evidence',
  'submit_quote_send_evidence',
]);

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const object = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every(key => allowedSet.has(key));
}

function hasDirectAgentInstruction(value: Record<string, unknown>): boolean {
  const forbidden = new Set(['agentRole', 'sourceAgent', 'targetAgent', 'childAgent', 'productionSiteWrite', 'directAgentCommand']);
  return Object.keys(value).some(key => forbidden.has(key));
}

export function parseStarter198CommandInput(value: unknown): StarterWorkspaceCommandInput {
  const source = object(value);
  if (!source || !exactKeys(source, ['command', 'idempotencyKey', 'targetId', 'expectedVersion', 'payload'])) {
    throw new Starter198CommandError('starter_198_command_invalid', 400);
  }
  const rawCommand = text(source.command);
  const payload = source.payload === undefined ? {} : object(source.payload);
  if (!payload) throw new Starter198CommandError('starter_198_command_payload_invalid', 400);
  if (!STARTER_198_COMMAND_SET.has(rawCommand as Starter198Command)) {
    if (/(content|traffic|sales|child|production[_.-]?site|studio)/i.test(rawCommand) || hasDirectAgentInstruction(payload)) {
      throw new Starter198CommandError('starter_198_orchestrator_only', 403);
    }
    throw new Starter198CommandError('starter_198_command_unknown', 400);
  }
  if (hasDirectAgentInstruction(payload)) throw new Starter198CommandError('starter_198_orchestrator_only', 403);
  const idempotencyKey = text(source.idempotencyKey);
  const targetId = text(source.targetId);
  const expectedVersion = text(source.expectedVersion);
  if (!/^[a-z0-9:_-]{8,200}$/i.test(idempotencyKey)) {
    throw new Starter198CommandError('starter_198_idempotency_key_invalid', 400);
  }
  if ((targetId && !/^[a-z0-9:_-]{1,200}$/i.test(targetId)) || (expectedVersion && expectedVersion.length > 200)) {
    throw new Starter198CommandError('starter_198_command_target_invalid', 400);
  }
  return {
    command: rawCommand as Starter198Command,
    idempotencyKey,
    ...(targetId ? { targetId } : {}),
    ...(expectedVersion ? { expectedVersion } : {}),
    payload,
  };
}

export function assertStarter198CommandPayload(
  command: Starter198Command,
  payload: Record<string, unknown>,
): void {
  const allowed: Record<Starter198Command, readonly string[]> = {
    confirm_initial_setup: ['companyName', 'industry', 'primaryBusiness', 'focusProducts', 'targetMarkets', 'customerProfile', 'primaryPlatform', 'primaryLanguage', 'constraints', 'operatingPlan'],
    confirm_quote_rule: ['sku', 'currency', 'unitPrice', 'unitCost', 'moq', 'incoterm', 'shippingFlatFee', 'taxRateBps', 'paymentTerm', 'leadTimeDays', 'validDays', 'minMarginBps', 'sourceReference'],
    submit_quote_inquiry: ['sourceChannel', 'sourceReference', 'quantity', 'destinationCountry'],
    submit_orchestrator_input: ['input'],
    resolve_decision: ['decision', 'note', 'selection'],
    pause_run: ['reason'],
    resume_run: [],
    cancel_run: ['reason'],
    generate_publication_package: ['contentId', 'contentVersion', 'contentHash', 'platform', 'copy', 'assets', 'inquiryUrl'],
    submit_publication_evidence: ['publicUrl', 'platformPostId'],
    submit_quote_send_evidence: ['channel', 'providerReference'],
  };
  if (!exactKeys(payload, allowed[command])) throw new Starter198CommandError('starter_198_command_payload_invalid', 400);
  if (command === 'confirm_initial_setup') {
    const required = ['companyName', 'industry', 'primaryBusiness', 'focusProducts', 'targetMarkets', 'customerProfile', 'primaryPlatform', 'primaryLanguage'];
    const operatingPlan = payload.operatingPlan === undefined ? null : object(payload.operatingPlan);
    const plannedAccounts = Array.isArray(operatingPlan?.plannedAccounts) ? operatingPlan.plannedAccounts : [];
    const cost = object(operatingPlan?.estimatedCostCny);
    const operatingPlanInvalid = payload.operatingPlan !== undefined && (
      !operatingPlan
      || !exactKeys(operatingPlan, ['brandName', 'presenter', 'plannedAccounts', 'weeklyMasterCount', 'weeklyVariantCount', 'estimatedCostCny', 'deliveryDays'])
      || !text(operatingPlan.brandName)
      || !['brand_spokesperson', 'product_expert', 'none'].includes(text(operatingPlan.presenter))
      || plannedAccounts.length < 1 || plannedAccounts.length > 4
      || plannedAccounts.some(item => {
        const account = object(item);
        return !account
          || !exactKeys(account, ['platform', 'accountName', 'weeklyOutput'])
          || !['facebook', 'instagram', 'tiktok', 'youtube'].includes(text(account.platform).toLowerCase())
          || !text(account.accountName)
          || !Number.isSafeInteger(account.weeklyOutput) || Number(account.weeklyOutput) < 1;
      })
      || !Number.isSafeInteger(operatingPlan.weeklyMasterCount) || Number(operatingPlan.weeklyMasterCount) < 1
      || !Number.isSafeInteger(operatingPlan.weeklyVariantCount) || Number(operatingPlan.weeklyVariantCount) < 1
      || !cost || !exactKeys(cost, ['min', 'max'])
      || !Number.isSafeInteger(cost.min) || Number(cost.min) < 0
      || !Number.isSafeInteger(cost.max) || Number(cost.max) < Number(cost.min)
      || !Number.isSafeInteger(operatingPlan.deliveryDays) || Number(operatingPlan.deliveryDays) < 1
    );
    if (required.some(key => !text(payload[key]))
      || !['facebook', 'instagram', 'tiktok', 'youtube'].includes(text(payload.primaryPlatform).toLowerCase())
      || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(text(payload.primaryLanguage))
      || !Array.isArray(payload.constraints)
      || payload.constraints.length > 10
      || payload.constraints.some(item => typeof item !== 'string' || !item.trim() || item.trim().length > 240)
      || operatingPlanInvalid) {
      throw new Starter198CommandError('starter_198_initial_setup_invalid', 400);
    }
  }
  if (command === 'submit_orchestrator_input' && (!text(payload.input) || text(payload.input).length > 4_000)) {
    throw new Starter198CommandError('starter_198_orchestrator_input_invalid', 400);
  }
  if (command === 'confirm_quote_rule') {
    const requiredText = ['sku', 'currency', 'unitPrice', 'unitCost', 'incoterm', 'shippingFlatFee', 'paymentTerm', 'sourceReference'];
    const requiredIntegers = ['moq', 'taxRateBps', 'leadTimeDays', 'validDays', 'minMarginBps'];
    if (requiredText.some(key => !text(payload[key]))
      || requiredIntegers.some(key => typeof payload[key] !== 'number' || !Number.isSafeInteger(payload[key]))) {
      throw new Starter198CommandError('starter_198_quote_rule_invalid', 400);
    }
  }
  if (command === 'submit_quote_inquiry') {
    if (!text(payload.sourceChannel) || !text(payload.sourceReference) || !text(payload.destinationCountry)
      || typeof payload.quantity !== 'number' || !Number.isSafeInteger(payload.quantity)) {
      throw new Starter198CommandError('starter_198_quote_inquiry_invalid', 400);
    }
  }
  if (command === 'resolve_decision') {
    const selection = payload.selection === undefined ? null : object(payload.selection);
    const parameters = selection ? object(selection.parameters) : null;
    const option = text(selection?.option);
    const value = text(selection?.value);
    const pairs: Record<string, { value: string; decision: string }> = {
      approve: { value: 'approved', decision: 'approved' },
      accept_result: { value: 'accepted', decision: 'approved' },
      request_revision: { value: 'revision_requested', decision: 'rejected' },
    };
    const selectionInvalid = payload.selection !== undefined && (
      !selection
      || !exactKeys(selection, ['option', 'value', 'parameters'])
      || !parameters
      || !exactKeys(parameters, ['note'])
      || !pairs[option]
      || pairs[option].value !== value
      || pairs[option].decision !== text(payload.decision)
      || text(parameters.note).length > 2_000
      || (parameters.note !== undefined && !text(parameters.note))
      || (parameters.note !== undefined && text(parameters.note) !== text(payload.note))
    );
    if (!['approved', 'rejected'].includes(text(payload.decision))
      || text(payload.note).length > 2_000
      || selectionInvalid) {
      throw new Starter198CommandError('starter_198_decision_invalid', 400);
    }
  }
  if ((command === 'pause_run' || command === 'cancel_run') && text(payload.reason).length > 500) {
    throw new Starter198CommandError('starter_198_command_payload_invalid', 400);
  }
  if (command === 'submit_quote_send_evidence') {
    if (!text(payload.channel) || text(payload.channel).length > 80
      || !text(payload.providerReference) || text(payload.providerReference).length > 240) {
      throw new Starter198CommandError('starter_198_quote_evidence_invalid', 400);
    }
  }
}
