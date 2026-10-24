import { applyTagCorrections, protectedCustomerTag, readTagCorrections } from './customerTags';

export type LocalCustomerProfileAnalysis = {
  profileAnalysisStatus?: 'pending' | 'analyzing' | 'succeeded' | 'failed' | 'disabled';
  profileAnalysisBuyerFingerprint?: string;
  profileAnalysisResultFingerprint?: string;
  profileAnalysisUpdatedAt?: string;
  profileAnalysisErrorCode?: string;
  profileAnalysisHasResult?: boolean;
};
export function hasLocalCustomerProfileResult(input: LocalCustomerProfileAnalysis): boolean {
  return input.profileAnalysisHasResult === true && !!input.profileAnalysisResultFingerprint
    && Number.isFinite(Date.parse(input.profileAnalysisUpdatedAt || ''));
}

export function localCustomerProfileUnassessed(input: LocalCustomerProfileAnalysis): boolean {
  return !!input.profileAnalysisStatus && !hasLocalCustomerProfileResult(input);
}

type Evidence = { tag: string; messageId: string; excerpt: string };
type Turn = { id: string; actor: string; body: string };
/** No classifier ran for this controlled inbound. Never reuse a replaced fixture as current facts. */
export function pendingLocalCustomerProfile(input: {
  tags?: string[]; contextTagCorrections?: unknown; contextTagEvidence?: Evidence[]; timeline: Turn[];
}) {
  const corrections = readTagCorrections(input.contextTagCorrections);
  const evidence = (input.contextTagEvidence || []).filter(item => item.excerpt.trim() && input.timeline.some(
    turn => turn.actor === 'buyer' && turn.id === item.messageId && turn.body.includes(item.excerpt),
  ));
  const tags = applyTagCorrections((input.tags || []).filter(tag => protectedCustomerTag(tag) || evidence.some(item => item.tag === tag)), corrections);
  return {
    profileAnalysisStatus: 'pending' as const, profileAnalysisHasResult: false, tags, contextTagCorrections: corrections, contextTagEvidence: evidence, contextTagsUpdatedAt: '',
    product: '待分析（新模拟消息）', outboundProduct: '', estimatedValue: '金额待评估',
    intentScore: 0, intentSignals: [], orders: [], handlingReason: '画像待分析，请人工核实最新客户需求。', bant: undefined, progressionGoal: undefined, spinGuidance: undefined,
    summary: '已收到新的模拟消息，画像尚未分析；原样例需求不作为本轮事实。',
    nextStep: '核对最新客户消息并人工确认需求；保留标签的人工纠正与原始依据。',
    sourcePostId: undefined, sourceTrackCode: undefined, sourcePostTitle: undefined, sourcePostPlatform: undefined,
    softAttribution: undefined, newProductMatch: false, needCall: false,
    simulation: undefined,
  };
}
