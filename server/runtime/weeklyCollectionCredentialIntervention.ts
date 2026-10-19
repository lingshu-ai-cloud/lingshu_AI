import type {WeeklyAccountCollectionCostPreflight} from '../socialDiscovery/weeklyAccountCollectionCostPreflight.js';

type PublicCostScenario=Pick<WeeklyAccountCollectionCostPreflight,'schema'|'authorizationId'|'authorizationHash'|'modeledUsage'|'observedCnyPerUsd'|'modeledNonRunUsd'|'maximumRunChargeUsd'|'modeledTotalCny'|'evidenceRef'|'checkedAt'|'validUntil'|'permitsPaidCollection'|'remainingRequirements'>;
function projectedScenario(value:PublicCostScenario|null|undefined,now:number){
 const nonRunCny=value?value.modeledNonRunUsd*value.observedCnyPerUsd:NaN;
 if(!value||value.schema!=='weekly-account-collection-cost-preflight.v1'||value.permitsPaidCollection!==false||!/^apify-published-cost-preflight:[a-f0-9]{64}$/.test(value.evidenceRef)||!Number.isFinite(Date.parse(value.checkedAt))||Date.parse(value.checkedAt)>now||!Number.isFinite(Date.parse(value.validUntil))||Date.parse(value.validUntil)<=now||Date.parse(value.validUntil)-Date.parse(value.checkedAt)>6*3600000||!Number.isFinite(value.modeledTotalCny)||value.modeledTotalCny<=0||!Number.isFinite(value.modeledNonRunUsd)||value.modeledNonRunUsd<0||!Number.isFinite(value.observedCnyPerUsd)||value.observedCnyPerUsd<=0||!Number.isFinite(nonRunCny)||nonRunCny<0||nonRunCny>value.modeledTotalCny||!Number.isFinite(value.maximumRunChargeUsd)||value.maximumRunChargeUsd<=0||value.remainingRequirements.join(',')!=='verified_account_fx_ceiling,current_actor_minimum_charge_and_pricing,server_enforced_run_cap_receipt,post_run_storage_retention_control')return null;
 return {basis:'public_price_scenario_not_a_quote' as const,
  /** The model deliberately spends the remaining authorization on a proposed
   * Actor cap. It is a ceiling, not a point estimate. */
  modeledCeilingCny:value.modeledTotalCny,knownNonActorScenarioCny:nonRunCny,
  maximumRunChargeUsd:value.maximumRunChargeUsd,observedCnyPerUsd:value.observedCnyPerUsd,
  modeledCandidateCount:value.modeledUsage.candidateCount,modeledMediaBytesPerCandidate:value.modeledUsage.maximumMediaBytesPerCandidate,
  evidenceRef:value.evidenceRef,checkedAt:value.checkedAt,validUntil:value.validUntil,permitsPaidCollection:false as const};
}
/** Read-only task-card projection. Never return an environment value or accept a credential. */
export function weeklyCollectionCredentialIntervention(env: NodeJS.ProcessEnv = process.env, paidBlocker?: string, publicCostPreflight?:PublicCostScenario|null, now=Date.now()) {
  const credentialConfigured = Boolean(env.APIFY_TOKEN?.trim());
  // Match the actual TikTok crawl route: the fallback is enabled by default
  // and explicitly disabled only with "0".
  const tiktokCollectionEnabled = env.APIFY_TIKTOK_CRAWL_FALLBACK_ENABLED !== '0';
  const budgetBlocker = paidBlocker === 'weekly_preproduction_collection_budget_authorization_required'
    ? '本周账号采集尚无明确人民币周总额及单次上限授权'
    : paidBlocker === 'weekly_preproduction_collection_budget_authorization_unverified'
      ? '采集额度签发或账号范围暂无法核验'
      : paidBlocker === 'weekly_preproduction_collection_cost_ceiling_unverified'
        ? null
        : paidBlocker === 'weekly_preproduction_collection_dataset_cost_unverified'
          ? '数据集读取费用上界尚未核验'
          : paidBlocker ? '采集付费准入暂无法核验' : null;
  // A PPE price snapshot and a per-run cap are not a proof of the whole
  // collection operation's CNY ceiling. These are independent, read-only
  // diagnostics; no item below is a spending permit or a quoted price.
  const costCeilingUnverified = paidBlocker === 'weekly_preproduction_collection_cost_ceiling_unverified';
  const publishedCostScenario=costCeilingUnverified?projectedScenario(publicCostPreflight,now):null;
  const costEvidence = costCeilingUnverified ? {
    actorRunUpperBound: 'unverified',
    postRunDatasetReadAndTransferUpperBound: 'unverified',
    usdToCnyUpperBound: 'unverified',
    sharedWeeklyReservation: 'unverified',
    independentIssuer: 'unverified',
    prepaidPurchaseCny: 'unverified',
    kvMediaAndNetworkUpperBound: 'unverified',
  } as const : null;
  const requiredCostEvidence = costCeilingUnverified ? [
    '当前账户最终结算所采用的美元兑人民币费用上界；ECB 即期汇率只用于场景估算',
    '当前账户档位下 Actor 事件、视频下载附加项、最低单次收费及计费模型的原始回执',
    '服务端已接受 maxItems 与 maxTotalChargeUsd 的不可变运行回执，并与原采集 operation 绑定',
    '运行后 Dataset／KV 的明确删除或保留期限控制，覆盖存储、读取、流量及其他后续费用',
  ] as const : null;
  return {
    status: credentialConfigured && tiktokCollectionEnabled && !budgetBlocker && !costCeilingUnverified ? 'configuration_present' : 'needs_intervention',
    blockers: [
      ...(!credentialConfigured ? ['采集服务凭据未配置'] : []),
      ...(!tiktokCollectionEnabled ? ['TikTok 采集开关未启用'] : []),
      ...(budgetBlocker ? [budgetBlocker] : []),
      ...(costCeilingUnverified ? [
        'Actor 本次事件与额外平台用量的费用硬上界尚未核验；额度签发不等于付费许可',
        '运行后的数据集读取与传输费用上界尚未核验',
        '美元费用换算人民币的保守汇率上界尚未核验',
        '本次费用与本周所有运行的共享预占尚未核验',
      ] : []),
    ],
    costEvidence,
    publishedCostScenario,
    requiredCostEvidence,
    guidance: '请由本机服务管理员通过安全运行环境配置采集服务；不要在任务卡或聊天中填写 API Key。人民币上限不是报价。上述原始证据须由独立可信成本签发者核验；证据哈希或签名回执本身不代表已验证原报价、汇率或网络费用，也不会启动付费采集。',
    operationallyVerified: false,
  } as const;
}
