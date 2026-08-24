import type { SalesConversationStateV1 } from './conversationState.js';

export type NextBestActionType = 'answer_and_clarify' | 'prepare_sample' | 'prepare_quote' | 'review_negotiation' | 'request_human_takeover' | 'follow_up_buyer' | 'confirm_order_evidence' | 'support_fulfillment' | 'none';

export interface NextBestActionDecision {
  type: NextBestActionType;
  headline: string;
  rationale: string;
  primaryAction: string;
  answerFirst: true;
  missingConditions: string[];
  sourceEventIds: string[];
  executionMode: SalesConversationStateV1['authorityRisk']['executionMode'];
}

function missingEvidence(state: SalesConversationStateV1): string[] {
  const labels: Record<string, string> = {
    quantity: '采购数量', target_market: '目标市场', pain_point: '核心痛点', decision_maker: '决策人', key_event_timing: '采购时间', budget_status: '预算状态',
  };
  return Object.entries(labels)
    .filter(([key]) => !state.dealEvidence.fields[key]?.value || state.dealEvidence.fields[key]?.status === 'conflicting')
    .map(([, label]) => label);
}

export function decideNextBestAction(state: SalesConversationStateV1): NextBestActionDecision {
  const sourceEventIds = Array.from(new Set(Object.values(state.dealEvidence.fields).flatMap(field => field.sourceEventIds))).slice(-12);
  if (state.channelOwnership.handoffStatus === 'requested' || state.channelOwnership.handoffStatus === 'accepted' || state.authorityRisk.executionMode === 'mandatory_handoff') {
    return { type: 'request_human_takeover', headline: '等待人工接管', rationale: '当前权限或风险要求人工处理，AI 不能自动发送。', primaryAction: '查看结构化交接包', answerFirst: true, missingConditions: [], sourceEventIds, executionMode: 'mandatory_handoff' };
  }
  if (state.engagement.status === 'waiting_buyer') {
    return { type: 'follow_up_buyer', headline: '等待客户回复', rationale: '上一条消息由销售发出，暂不重复追问。', primaryAction: '按 SLA 安排一次轻量跟进', answerFirst: true, missingConditions: [], sourceEventIds, executionMode: state.authorityRisk.executionMode };
  }
  if (state.lifecycle.stage === 'closed' || state.lifecycle.stage === 'fulfillment_relationship') {
    return { type: 'support_fulfillment', headline: '确认履约与复购机会', rationale: '交易已经关闭，下一步应围绕订单履约、满意度和复购。', primaryAction: '核对订单或交付状态', answerFirst: true, missingConditions: [], sourceEventIds, executionMode: state.authorityRisk.executionMode };
  }
  const intents = new Set(state.intents.active.map(intent => intent.type));
  if (intents.has('complaint_claim') || intents.has('human_contact_request') || intents.has('price_negotiation')) {
    return { type: 'request_human_takeover', headline: '需要人工决策', rationale: '客户涉及投诉、明确人工请求或价格谈判。', primaryAction: '人工接管并确认可授权边界', answerFirst: true, missingConditions: [], sourceEventIds, executionMode: 'mandatory_handoff' };
  }
  if (intents.has('sample_request')) {
    return { type: 'prepare_sample', headline: '确认样品范围', rationale: '客户提出样品需求，需要明确规格、数量和寄送条件。', primaryAction: '创建样品记录并提交确认', answerFirst: true, missingConditions: missingEvidence(state).slice(0, 1), sourceEventIds, executionMode: 'human_approval' };
  }
  if (intents.has('quotation_request')) {
    const missing = missingEvidence(state).filter(label => ['采购数量', '目标市场', '采购时间'].includes(label));
    return missing.length
      ? { type: 'answer_and_clarify', headline: '补齐报价条件', rationale: '客户正在询价，但正式报价条件尚不完整。', primaryAction: `只追问一个缺失项：${missing[0]}`, answerFirst: true, missingConditions: missing, sourceEventIds, executionMode: state.authorityRisk.executionMode }
      : { type: 'prepare_quote', headline: '准备报价文档', rationale: '基础报价条件已具备，仍需生成并审批报价文档。', primaryAction: '创建报价草稿并提交审批', answerFirst: true, missingConditions: ['已审批并发送的报价文档'], sourceEventIds, executionMode: 'human_approval' };
  }
  const missing = missingEvidence(state);
  return { type: 'answer_and_clarify', headline: missing.length ? `补齐${missing[0]}` : '回答并推进一步', rationale: missing.length ? '当前交易证据仍不完整。' : '已有基础信息，可围绕客户当前问题自然推进。', primaryAction: missing.length ? `回答后只追问${missing[0]}` : '回答当前问题并确认一个下一步', answerFirst: true, missingConditions: missing, sourceEventIds, executionMode: state.authorityRisk.executionMode };
}
