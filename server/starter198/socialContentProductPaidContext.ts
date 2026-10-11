import {createHash} from 'node:crypto';
import type {SocialTaskBudgetScope} from '../lib/socialContentTaskBudget.js';
import type {SocialPaidOperationIntent} from '../lib/socialContentTaskBudgetAuthority.js';
import type {createSocialContentPaidOperationPermit} from '../lib/socialContentPaidOperationPermit.js';
import {paidProductionHash, type PaidStageRequirement, type BoundPaidRoute} from './socialContentPaidOperationPlan.js';

export type ProductPaidStage = 'first_frame' | 'first_frame_qa' | 'video' | 'video_qa';
export interface ProductPaidContext {
  scope: SocialTaskBudgetScope;
  requirements: PaidStageRequirement[];
  routeBindings: Record<string, BoundPaidRoute>;
  intents: SocialPaidOperationIntent[];
  readReservedCny(operationId: string): number;
  assertRecovery(operationId: string): Promise<void>;
  permit: ReturnType<typeof createSocialContentPaidOperationPermit>;
  /** Canonical configured credential/account route is checked independently of the intent. */
  assertProviderBinding(route: BoundPaidRoute): Promise<void>;
  /** Model-aware upper bound derived from this actual request, not the plan maximum. */
  measureVideoOutputTokens?(request: Record<string, unknown>, route: BoundPaidRoute): Promise<number>;
  measureInputTokens(request: Record<string, unknown>, route: BoundPaidRoute): Promise<number>;
}
const fail = (reason: string): never => {throw Error('product_paid_' + reason);};
export function bindProductPaidStage(context: ProductPaidContext, shotId: string, stage: ProductPaidStage) {
  const requirements = context.requirements.filter(r => r.shotId === shotId && r.stage === stage);
  if (requirements.length !== 1) fail('requirement_missing_or_ambiguous');
  const requirement = requirements[0]!, route = context.routeBindings[requirement.key];
  if (!route) fail('canonical_route_missing');
  const operationId = 'paid-plan:' + paidProductionHash({scope: context.scope, key: requirement.key, attempt: 0});
  const intents = context.intents.filter(i => i.operationId === operationId);
  if (intents.length !== 1) fail('intent_missing_or_ambiguous');
  const intent = intents[0]!;
  if (intent.inputContractHash !== paidProductionHash({requirement, route, attempt: 0}) || intent.shotId !== shotId || intent.stage !== stage
    || intent.provider !== route.provider || intent.model !== route.model || intent.accountRef !== route.accountRef
    || paidProductionHash(intent.maximumUnits) !== paidProductionHash(route.maximumUnits)) fail('canonical_intent_changed');
  return {
    intent,
    async beforeSubmit(body: Record<string, unknown>) {
      const request = structuredClone(body);
      await context.assertProviderBinding(route);
      if (request.model !== intent.model) fail('actual_model_changed');
      const actualUnits: Record<string, number> = {};
      const images = stage.endsWith('_qa')
        ? (Array.isArray(request.messages) ? request.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).filter((i: any) => i.type === 'image_url').length : NaN)
        : stage === 'first_frame' ? (Array.isArray(request.image) ? request.image.length : 0) : 1;
      for (const unit of Object.keys(intent.maximumUnits)) {
        if (unit === 'requests') actualUnits.requests = 1;
        else if (unit === 'frames' || unit === 'images') actualUnits[unit] = images;
        else if (unit === 'providerSeconds') actualUnits.providerSeconds = Number(request.duration);
        else if (unit === 'outputTokens') {
          if(stage === 'video'){if(!context.measureVideoOutputTokens)fail('video_token_measurement_missing');actualUnits.outputTokens=await context.measureVideoOutputTokens!(request,route);}
          else actualUnits.outputTokens = Number(request.max_tokens);
        }
        else if (unit === 'inputImages') actualUnits.inputImages = images;
        else if (unit === 'outputImages') {if(stage!=='first_frame' || request.sequential_image_generation==='auto')fail('image_output_mode_unsupported');actualUnits.outputImages=1;}
        else if (unit === 'inputTokens') actualUnits.inputTokens = await context.measureInputTokens(request, route);
        else fail('actual_usage_dimension_unsupported:' + unit);
      }
      if (Object.values(actualUnits).some(n => !Number.isFinite(n) || n < 0)) fail('actual_usage_invalid');
      if (stage === 'first_frame' && (!images || typeof request.prompt !== 'string' || !request.prompt.trim())) fail('actual_KB_frame_request_changed');
      if (stage === 'video' && (Number(request.duration) !== Math.max(4, Math.ceil(requirement.durationSeconds || 0)) || request.generate_audio !== false || request.resolution !== '720p' || !Array.isArray(request.content)
        || !request.content.some((i: any) => i.role === 'first_frame'))) fail('actual_i2v_request_changed');
      if (stage.endsWith('_qa') && (images > (requirement.frameCount ?? 0))) fail('actual_qa_frames_exceed_contract');
      if (stage.endsWith('_qa') && (!Array.isArray(request.messages) || request.enable_thinking !== false || Number(request.max_tokens) !== 4096 || !images)) fail('actual_qa_request_changed');
      const {maximumUnits: _maximum, ...binding} = intent;
      await context.permit.beforeSubmit({...binding, actualUnits});
      return {operationId, requestSha256: createHash('sha256').update(JSON.stringify(request)).digest('hex'), actualUnits};
    },
    async completed(receiptRef: string) {await context.permit.markOutcome(operationId, 'completed', receiptRef);},
  };
}
