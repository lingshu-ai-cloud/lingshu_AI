import {isProductionBudgetBlock,PRODUCTION_BUDGET_DECISION_MESSAGE} from '../../shared/contracts/productionBudgetPolicy.js';
export type ContentExecutionFailureClass =
  | 'network_timeout'
  | 'insufficient_balance'
  | 'content_rejected'
  | 'system_fault'
  | 'provider_reconciliation'
  | 'input_required';

export interface ContentExecutionRetryDecision {
  failureClass: ContentExecutionFailureClass;
  disposition: 'retry' | 'block' | 'reconcile';
  retryDelayMs: number | null;
  maxAttempts: number;
  publicReason: string;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), minimum), maximum) : fallback;
}

function delay(schedule: number[], attempt: number): number {
  return schedule[Math.min(Math.max(attempt - 1, 0), schedule.length - 1)]!;
}

/** Public, credential-safe provider attribution for task cards and notices. */
export function contentProviderApiFailureMessage(error: unknown): string | null {
  const raw = String(error instanceof Error ? error.message : error || '');
  const lower = raw.toLocaleLowerCase();
  const provider = /seedance/.test(lower) ? 'Seedance API'
    : /seedream/.test(lower) ? 'Seedream API'
      : /qwen|dashscope|qianwen/.test(lower) ? (/\btts\b|speech|audio/.test(lower) ? 'Qwen TTS API' : 'Qwen API')
        : /minimax/.test(lower) ? 'MiniMax TTS API'
          : /heygen/.test(lower) ? 'HeyGen API'
            : /gemini/.test(lower) ? 'Gemini API'
              : /openai|gpt-image/.test(lower) ? 'OpenAI Image API'
                : null;
  if (!provider) return null;
  const reason = /401|unauthori[sz]ed|invalid api.?key|api.?key.*(?:invalid|missing|not set)|未配置.*api.?key|鉴权/.test(lower)
    ? '鉴权失败，请检查密钥'
    : /403|forbidden|not activated|do not have access|model or endpoint|permission|未开通|无权限/.test(lower)
      ? '账号无权限或模型尚未开通'
      : /429|rate.?limit|too many requests|quota|insufficient.*(?:balance|credit)|余额不足|额度不足/.test(lower)
        ? '请求频率、额度或余额不足'
        : /timed?\s*out|timeout|etimedout|econnreset|econnrefused|enotfound|eai_again|fetch failed|network|socket/.test(lower)
          ? '网络连接或响应超时'
          : /\b5\d\d\b|service unavailable|bad gateway/.test(lower)
            ? '供应商服务暂时不可用'
            : /rejected|moderation|policy violation|blocked prompt|内容.*(?:拒绝|违规|不合规)/.test(lower)
              ? '内容被供应商拒绝'
              : /no media|no image|no video|no audio|没有.*(?:视频|图片|音频)|invalid.*(?:output|response)|返回格式|returned.*(?:empty|invalid|unsupported)/.test(lower)
                ? '供应商返回的结果无效'
                : '调用失败';
  return `${provider} ${reason}`;
}

export function classifyContentExecutionFailure(error: unknown, input: {
  attempt: number;
  hasUnsettledProviderReceipt?: boolean;
  env?: NodeJS.ProcessEnv;
}): ContentExecutionRetryDecision {
  const env = input.env ?? process.env;
  const raw = String(error instanceof Error ? error.message : error || 'content_execution_failed');
  const lower = raw.toLocaleLowerCase();
  const providerFailure = contentProviderApiFailureMessage(error);
  const networkAttempts = boundedInteger(env.CONTENT_NETWORK_MAX_ATTEMPTS, 4, 1, 10);
  const systemAttempts = boundedInteger(env.CONTENT_SYSTEM_MAX_ATTEMPTS, 3, 1, 10);
  const reconciliationAttempts = boundedInteger(env.CONTENT_RECONCILIATION_MAX_ATTEMPTS, 12, 1, 100);

  if (input.hasUnsettledProviderReceipt
    || /social_paid_permit_execution_(?:dependency_not_completed|binding_recovery_required)|presenter_(?:image|inspection)_artifact_recovery_required|native_speech_track_(?:pending_reconcile|submission_unknown)|provider_submission_(?:uncertain|unknown)|提交结果未知|do not resubmit|unknown submission|not_completed:(?:pending|uncertain)/i.test(raw)) {
    return {
      failureClass: 'provider_reconciliation',
      disposition: input.attempt >= reconciliationAttempts ? 'block' : 'reconcile',
      retryDelayMs: input.attempt >= reconciliationAttempts ? null : delay([15_000, 30_000, 60_000, 120_000, 300_000], input.attempt),
      maxAttempts: reconciliationAttempts,
      publicReason: input.attempt >= reconciliationAttempts ? '供应商任务需要人工确认' : '供应商已受理，正在对账',
    };
  }
  if (/heygen_catalog_default_voice_unresolved/.test(lower)) return { failureClass: 'input_required', disposition: 'block', retryDelayMs: null, maxAttempts: 1, publicReason: 'HeyGen 尚未返回此人物的原配音色；人物授权仍有效，请刷新人物信息，或试听后主动选择声音' };
  if (/presenter_narration_capability_unavailable/.test(lower)) return { failureClass: 'input_required', disposition: 'block', retryDelayMs: null, maxAttempts: 1, publicReason: '人物授权仍有效；当前旁白声音能力未接通，需要核验同声配音或原口播音轨复用，换声前请试听确认' };
  if (/native_subtitle_|native_voice_timing_transform_changed|prepared_whole_voice_measured_cues_changed/.test(lower))
    return { failureClass: 'input_required', disposition: 'block', retryDelayMs: null, maxAttempts: 1,
      publicReason: '字幕或音轨校验未通过，原音视频已保留；修正后可继续后续制作，无需重新生成。' };
  if (/presenter_first_frame_confirmation_lost_after_budget_reservation/.test(lower))
    return { failureClass: 'input_required', disposition: 'block', retryDelayMs: null, maxAttempts: 1,
      publicReason: '人物首帧确认凭据需要核验；原人物授权和已完成音视频保留，核验后可继续后续制作。' };
  if (/presenter_first_frame_(?:quality_inspection_authorization_required|visual_qa_required)/.test(lower))
    return { failureClass: 'input_required', disposition: 'block', retryDelayMs: null, maxAttempts: 1,
      publicReason: '人物首帧尚缺视觉检查或检查授权；已有产物保留，补齐后继续，不自动重复生成。' };
  if (/presenter_first_frame_(?:target_ratio_(?:unsupported|mismatch|required)|repair_(?:ratio_mismatch|geometry_unknown))/.test(lower))
    return { failureClass: 'input_required', disposition: 'block', retryDelayMs: null, maxAttempts: 1,
      publicReason: '人物首帧与视频画面规格不一致；已有产物保留，修正规格后继续。' };
  if (/presenter_(?:background|composite)_quality_failed/.test(lower))
    return { failureClass:'input_required',disposition:'block',retryDelayMs:null,maxAttempts:1,
      publicReason:'背景去人或人物融合检查未通过；原图片和报告已保留，修正该步骤后继续，不重做已完成步骤。' };
  if (/presenter_background_/.test(lower))
    return { failureClass:'input_required',disposition:'block',retryDelayMs:null,maxAttempts:1,
      publicReason:'背景与人物首帧的产物、预留或恢复凭据需要核验；保留已有记录，核验后继续原任务。' };
  if (/presenter_(?:image|inspection)_artifact_(?:changed|corrupt|binding_changed|bytes_missing|bytes_changed|receipt_changed|provider_result_invalid)/.test(lower))
    return { failureClass: 'input_required', disposition: 'block', retryDelayMs: null, maxAttempts: 1,
      publicReason: '首帧产物或质检回执与原付费记录不一致；需核验恢复文件，禁止自动重新付费生成。' };
  if (/social_paid_permit_(?:execution_|claim_corrupt)|social_task_budget_authority_execution_/.test(lower))
    return { failureClass: 'input_required', disposition: 'block', retryDelayMs: null, maxAttempts: 1,
      publicReason: '制作阶段的输入绑定或原付费凭据需要核验；已完成产物与费用保留，修复后继续原任务。' };
  if (/presenter_mother_frozen_audio_track_mismatch/.test(lower))
    return { failureClass: 'input_required', disposition: 'block', retryDelayMs: null, maxAttempts: 1,
      publicReason: '人物视频音轨与已确认音轨不一致，原产物已保留；需核验后继续，不自动重新生成。' };
  if (/social_production_handoff_/.test(lower))
    return { failureClass: 'input_required', disposition: 'block', retryDelayMs: null, maxAttempts: 1,
      publicReason: '制作交接信息需要核验，已渲染视频保留；修正交接后可继续，无需重新生成素材。' };
  if (/content_test_input_/.test(lower))
    return { failureClass: 'input_required', disposition: 'block', retryDelayMs: null, maxAttempts: 1,
      publicReason: '本次测试占位输入与执行方案的绑定需要核验；已有产物保留，修正后继续原任务。' };
  if (/content_execution_checkpoints_too_large/.test(lower))
    return { failureClass: 'input_required', disposition: 'block', retryDelayMs: null, maxAttempts: 1,
      publicReason: '制作恢复记录超出存储限制，原产物已保留；修复归档记录后继续，不重新生成。' };
  if (/social_content_idempotency_conflict/.test(lower))
    return { failureClass: 'input_required', disposition: 'block', retryDelayMs: null, maxAttempts: 1,
      publicReason: '制作操作与原记录不一致，已保留原产物；核验操作版本后继续，不自动重复写入。' };
  if (/social_content_artifact_not_allowed/.test(lower))
    return { failureClass: 'input_required', disposition: 'block', retryDelayMs: null, maxAttempts: 1,
      publicReason: '制作任务状态与归档条件需要核验，已渲染视频保留；核验后继续归档。' };
  if (/social_graph_quality_failed:/.test(lower))
    return { failureClass: 'input_required', disposition: 'block', retryDelayMs: null, maxAttempts: 1,
      publicReason: '成片已保留，部分质量检查未通过；请预览检查结果并修改，再继续验收。' };
  if(isProductionBudgetBlock(raw))return {
    failureClass:'input_required',disposition:'block',retryDelayMs:null,maxAttempts:1,
    publicReason:PRODUCTION_BUDGET_DECISION_MESSAGE,
  };
  if (/insufficient[_\s-]*(?:balance|credit)|余额不足|quota[_\s-]*(?:exceeded|insufficient)|monthly_budget_exceeded|budget_denied|budget_unavailable|预算不足/i.test(lower)) {
    return {
      failureClass: 'insufficient_balance', disposition: 'block', retryDelayMs: null,
      maxAttempts: 1, publicReason: providerFailure || '余额或预算不足，补充后可恢复',
    };
  }
  if (/content[_\s-]*(?:rejected|moderation)|内容(?:拒绝|违规|不合规)|safety|policy violation|blocked prompt|providerrejected|qwen image (?:400|403|422)|seedance (?:400|403|422)/i.test(lower)) {
    return {
      failureClass: 'content_rejected', disposition: 'block', retryDelayMs: null,
      maxAttempts: 1, publicReason: providerFailure || '内容被模型拒绝，需要修改后恢复',
    };
  }
  // A product-footage finding is bound to the frozen shot plan and exact
  // material bytes. Retrying the same run cannot manufacture a missing signed
  // window or restore revoked rights; a changed plan requires a new revision.
  if (/user_input_required|production_input_required|素材.*(?:缺失|不足)|input_required|director_revision_required|product_scene_|product_footage_|quality.*failed|质量.*失败/i.test(lower)) {
    return {
      failureClass: 'input_required', disposition: 'block', retryDelayMs: null,
      maxAttempts: 1, publicReason: '需要补充素材或人工修改',
    };
  }
  if (/\b(?:etimedout|econnreset|econnrefused|enotfound|eai_again)\b|network|socket|fetch failed|timed?\s*out|timeout|http (?:408|425|429|502|503|504)/i.test(lower)) {
    return {
      failureClass: 'network_timeout',
      disposition: input.attempt >= networkAttempts ? 'block' : 'retry',
      retryDelayMs: input.attempt >= networkAttempts ? null : delay([15_000, 60_000, 300_000, 900_000], input.attempt),
      maxAttempts: networkAttempts,
      publicReason: providerFailure || (input.attempt >= networkAttempts ? '网络重试已用尽' : '网络异常，正在分级重试'),
    };
  }
  return {
    failureClass: 'system_fault',
    disposition: input.attempt >= systemAttempts ? 'block' : 'retry',
    retryDelayMs: input.attempt >= systemAttempts ? null : delay([30_000, 120_000, 600_000], input.attempt),
    maxAttempts: systemAttempts,
    publicReason: providerFailure || (input.attempt >= systemAttempts ? '系统重试已用尽' : '系统异常，正在延迟重试'),
  };
}
