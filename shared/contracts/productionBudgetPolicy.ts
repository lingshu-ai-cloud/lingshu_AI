/** Legacy policy identifier/default optimization target. Explicit authorized
 * task limits are independent; retries/revisions still share one film ledger. */
export const PRODUCTION_BUDGET_POLICY = 'finished-video-15-cny-per-30-seconds.v1' as const;
export const DEFAULT_PRODUCTION_DURATION_SECONDS = 30;
export function productionBudgetDuration(input: {
  targetDurationSeconds?: number | null;
  scenes?: ReadonlyArray<{ duration: { startSeconds: number; endSeconds: number } }>;
} = {}): number {
  const target = input.targetDurationSeconds;
  const frozen = input.scenes?.length ? input.scenes.reduce((sum, scene) =>
    sum + scene.duration.endSeconds - scene.duration.startSeconds, 0) : undefined;
  if (target != null && (!Number.isFinite(target) || target <= 0)
    || frozen !== undefined && (!Number.isFinite(frozen) || frozen <= 0)
    || input.scenes?.some(scene => !Number.isFinite(scene.duration.startSeconds)
      || !Number.isFinite(scene.duration.endSeconds) || scene.duration.endSeconds <= scene.duration.startSeconds)) {
    throw Error('user_input_required:production_budget_duration_invalid');
  }
  // A longer render or revised timeline cannot silently increase the order cap.
  return Math.min(target ?? Infinity, frozen ?? Infinity) === Infinity
    ? DEFAULT_PRODUCTION_DURATION_SECONDS : Math.min(target ?? Infinity, frozen ?? Infinity);
}
export function productionBudgetLimitCny(durationSeconds = DEFAULT_PRODUCTION_DURATION_SECONDS): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
    throw Error('user_input_required:production_budget_duration_invalid');
  return Math.floor((durationSeconds * 0.5 + Number.EPSILON) * 1e6) / 1e6;
}
export function productionBudgetMaximumCny(input: Parameters<typeof productionBudgetDuration>[0] & { perItemBudgetCny?: number | null } = {}): number {
  if (input.perItemBudgetCny == null) return productionBudgetLimitCny(productionBudgetDuration(input));
  if (!validProductionBudgetMaximum(input.perItemBudgetCny)) throw Error('user_input_required:production_budget_maximum_invalid');
  return input.perItemBudgetCny;
}
export function productionBudgetExceeded(amountCny: number, maximumCny: number): boolean {
  return !Number.isFinite(amountCny) || amountCny < 0 || !Number.isFinite(maximumCny)
    || maximumCny <= 0 || Math.round(amountCny * 1e6) > Math.round(maximumCny * 1e6);
}
export function validProductionBudgetMaximum(value: unknown, durationSeconds?: number): value is number {
  return typeof value==='number' && Number.isFinite(value) && value>0 && value<=10_000_000;
}
export function validOriginalProductionBudget(status: {
  limitCny:number;authorizedLimitCny:number;retainedCny:number;hasCorrectionAuthorization:boolean;
  productionDurationSeconds?:number;
} | null | undefined): boolean {
  return Boolean(status && validProductionBudgetMaximum(status.limitCny,status.productionDurationSeconds)
    && status.authorizedLimitCny===status.limitCny && !status.hasCorrectionAuthorization
    && !productionBudgetExceeded(status.retainedCny,status.limitCny));
}
/** Stable errors survive durable queue classification and read-model projection. */
export function isProductionBudgetBlock(message: string): boolean {
  return /(?:production_budget_decision_required|whole_film_budget_(?:preflight|routing):.*(?:exceeded|over_budget|exceeds_budget)|social_task_budget_(?:exceeded|execution_allowance_exceeded)|revision_incremental_allowance_exceeded)/.test(message);
}
export const PRODUCTION_BUDGET_DECISION_MESSAGE = '累计生产费用（含重试和修订，不含采集）超过当前可用预算，任务已受阻。请决定降低成本、停止任务或另行提交预算授权；确认前不会继续付费生产。';
export function productionBudgetDecisionError(evidence:{maximumCny:number;retainedCny:number;plannedAdditionalCny:number;totalCny:number}):Error {
  return Error(`user_input_required:production_budget_decision_required:${JSON.stringify({reason:'production_total_exceeded',...evidence})}`);
}
export function assertRetainedProductionBudget(status:{limitCny:number;retainedCny:number;productionDurationSeconds?:number}|null|undefined):void {
  if(!status)return;
  const maximumCny=status.limitCny;
  if(productionBudgetExceeded(status.retainedCny,maximumCny))
    throw productionBudgetDecisionError({maximumCny,retainedCny:status.retainedCny,plannedAdditionalCny:0,totalCny:status.retainedCny});
}
export function productionBudgetDecisionMessage(reason:string):string {
  const marker='production_budget_decision_required:',index=reason.indexOf(marker);
  if(index<0)return PRODUCTION_BUDGET_DECISION_MESSAGE;
  try{
    const value=JSON.parse(reason.slice(index+marker.length));
    if(!['maximumCny','retainedCny','plannedAdditionalCny','totalCny'].every(key=>typeof value[key]==='number'&&Number.isFinite(value[key])&&value[key]>=0))return PRODUCTION_BUDGET_DECISION_MESSAGE;
    return `当前额度 ¥${value.maximumCny.toFixed(2)}，已占用 ¥${value.retainedCny.toFixed(2)}，本次新增报价 ¥${value.plannedAdditionalCny.toFixed(2)}，累计 ¥${value.totalCny.toFixed(2)}。${PRODUCTION_BUDGET_DECISION_MESSAGE}`;
  }catch{return PRODUCTION_BUDGET_DECISION_MESSAGE;}
}
