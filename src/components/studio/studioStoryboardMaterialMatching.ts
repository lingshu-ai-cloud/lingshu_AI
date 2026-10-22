import type { MaterialSegment } from '../../lib/studioApi';
import { matchEvidenceSegment, usableEvidenceSegment } from '../../lib/segmentEvidence';
import type { Clip, StoryboardSlot } from '../AiCreateStudio';

export const ratioNumber = (value: string) => {
  const [w, h] = String(value || '9:16').split(':').map(Number);
  return w > 0 && h > 0 ? w / h : 9 / 16;
};
export const clipAspectRatio = (clip: Clip) => clip.aspectRatio || (clip.width && clip.height ? clip.width / clip.height : 0);
export const isClipCompatibleWithRatio = (clip: Clip, targetRatio: string) => {
  const actual = clipAspectRatio(clip);
  if (!actual) return true; // 旧素材无元数据时保留，最终渲染仍会裁切兜底。
  const orientation = (n: number) => n > 1.12 ? 'landscape' : n < 0.89 ? 'portrait' : 'square';
  return orientation(actual) === orientation(ratioNumber(targetRatio));
};
export const clipRatioPreferenceScore = (clip: Clip, targetRatio?: string) => {
  if (!targetRatio || !clipAspectRatio(clip)) return 0;
  return isClipCompatibleWithRatio(clip, targetRatio) ? 14 : -4;
};

export function pickMaterialClipsLocally(pool: Clip[], targetDuration: number, preferredIds: string[] = [], targetCount?: number) {
  const folderWeight: Record<string, number> = {
    presenter: 9,
    product: 8,
    detail: 7,
    scene: 6,
    factory: 5,
    model: 4,
    upload: 3,
  };
  const preferred = new Set(preferredIds);
  const ordered = [...pool].sort((a, b) => {
    const preferredDelta = Number(preferred.has(b.id)) - Number(preferred.has(a.id));
    if (preferredDelta) return preferredDelta;
    const typeDelta = Number(b.type === 'video') - Number(a.type === 'video');
    if (typeDelta) return typeDelta;
    const folderDelta = (folderWeight[b.folder] || 0) - (folderWeight[a.folder] || 0);
    if (folderDelta) return folderDelta;
    const aDur = effectiveClipDuration(a);
    const bDur = effectiveClipDuration(b);
    return Math.abs(aDur - targetDuration / 4) - Math.abs(bDur - targetDuration / 4);
  });
  const desiredCount = Math.max(1, Math.min(targetCount || 6, ordered.length || pool.length || 1));
  const picked: string[] = [];
  let total = 0;
  for (const clip of ordered) {
    if (picked.length >= desiredCount || (!targetCount && total >= targetDuration - 0.75)) break;
    picked.push(clip.id);
    total += effectiveClipDuration(clip);
  }
  return {
    selectedIds: picked.length ? picked : pool.slice(0, desiredCount).map(clip => clip.id),
    reason: targetCount
      ? `按 ${targetCount} 个分镜匹配素材候选`
      : preferredIds.length ? '沿用已选素材并补齐镜头顺序' : '按真人/产品/细节/场景和目标时长快速排序',
  };
}

/** Either visual topic or expression purpose may nominate a local asset.
 * Duration and aspect ratio never establish semantic eligibility on their own. */
function materialSemanticDimensions(clip: Clip, slot: StoryboardSlot): { topic: boolean; purpose: boolean } {
  const visual = storyboardSlotScript(slot.detail).visual || slot.title;
  const purpose = slot.detail.match(/镜头功能\s*[：:]\s*(.+?)(?=\s+(?:口播|台词|字幕|配乐|画面|环境|景别|运镜)\s*[：:]|$)/i)?.[1]?.trim() || '';
  const segments = (clip.segments || []).filter(segment => usableEvidenceSegment(segment, clip.duration));
  if (!visual.trim() || !purpose.trim()) return { topic: false, purpose: false };
  const topicRules: Array<{ visual: RegExp; folders: string[]; metadata: RegExp }> = [
    // Factory B-roll is matched by the scene's subject and purpose. The
    // number of people, clothing and exact hand movement are not requirements.
    { visual: /(?:两人|人员|工人|白大褂).*(?:操作|指认|工作|生产|整理)/i, folders: [], metadata: /工人|人员|人工|白大褂|戴白手套的人|worker|staff/i },
    { visual: /灌装|填充|瓶口注液|filling/i, folders: [], metadata: /灌装|填充|注液|filling/i },
    { visual: /移液管|秤盘|烧杯|实验|研发|化验/i, folders: [], metadata: /移液|称重|烧杯|实验|研发|滴液|化验/i },
    { visual: /瓶罐.*(?:摆放|陈列)|产品.*(?:陈列|展示)|货架.*(?:瓶|产品)/i, folders: [], metadata: /陈列|摆放|包装展示|产品展示|瓶罐展示|packshot|display/i },
    { visual: /工厂|车间|产线|生产|质检|灌装|流水线|移液管|秤盘|factory|workshop|production|inspection|filling/i, folders: ['factory'], metadata: /工厂|生产|车间|质检|灌装|流水线|设备|工人|factory|production|inspection|filling/i },
    { visual: /产品|瓶身|瓶罐|包装|质地|成分|product|bottle|package|texture/i, folders: ['product', 'detail', 'packaging'], metadata: /产品|瓶身|瓶罐|包装|质地|瓶|罐|product|bottle|package|texture/i },
    { visual: /使用|上脸|试用|体验|application|usage|try.?on/i, folders: ['scene', 'model'], metadata: /使用|试用|上脸|场景|usage|application|try.?on/i },
    { visual: /证书|检测报告|认证|certificate|test report/i, folders: ['certificate'], metadata: /证书|检测|认证|certificate|test report/i },
  ];
  const topic = topicRules.find(rule => rule.visual.test(visual));
  const purposeRules: Array<{ purpose: RegExp; metadata: RegExp }> = [
    { purpose: /钩子|截流|吸引|hook|attention/i, metadata: /钩子|开场|吸引|hook|attention/i },
    { purpose: /证明|信任|背书|proof|trust|credibility/i, metadata: /证明|信任|背书|实力|实拍|生产流程|工艺稳定|设备精度|proof|trust|evidence/i },
    { purpose: /展示|介绍|演示|价值|demo|show|introduc|demonstration|value/i, metadata: /展示|介绍|演示|细节|生产流程|show|demo|display/i },
    { purpose: /痛点|对比|反差|problem|comparison|contrast/i, metadata: /痛点|对比|反差|problem|comparison|contrast/i },
    { purpose: /转化|询价|行动|cta|conversion/i, metadata: /转化|询价|行动|cta|conversion|contact/i },
  ];
  const intended = purposeRules.find(rule => rule.purpose.test(purpose));
  const purposeTerms = purpose.toLowerCase().match(/[\u4e00-\u9fff]{2,4}|[a-z]{4,}/g) || [];
  const evaluate = (visualEvidence: string, purposeEvidence: string, folder = '') => ({
    topic: Boolean(topic && (topic.folders.includes(folder) || topic.metadata.test(visualEvidence))),
    purpose: intended ? intended.metadata.test(purposeEvidence) : purposeTerms.some(term => purposeEvidence.includes(term)),
  });
  const candidates = [
    evaluate(`${clip.folder} ${clip.tags || ''}`, `${clip.shotFunction || ''} ${clip.applicability || ''} ${clip.tags || ''}`, clip.folder),
    ...segments.map(segment => evaluate(
      `${segment.visualTopic || ''} ${segment.subject.join(' ')} ${segment.action} ${segment.environment}`,
      `${segment.expressionPurpose || ''} ${segment.recommendedFunctions.join(' ')}`,
    )),
  ];
  return candidates.sort((a, b) => Number(b.topic) + Number(b.purpose) - Number(a.topic) - Number(a.purpose))[0]!;
}

const factoryVisualPattern = /工厂|车间|产线|生产|质检|灌装|输送|传送带|流水线|工人|防尘服|发网|手套|分拣|设备|机械|注塑机|振动盘|加工位|夹具|factory|workshop|production|inspection|filling|conveyor|worker|machine|assembly/i;
const productVisualPattern = /产品|瓶身|瓶罐|包装|质地|成分|玻璃瓶|磨砂|精华|面霜|乳液|product|bottle|package|texture|packshot/i;
const factorySpecificRules: Array<{ id: string; pattern: RegExp }> = [
  { id: 'worker', pattern: /工人|人员|白大褂|防尘服|发网|手套|分拣|装配|worker|staff|sorting|assembly/i },
  { id: 'conveyor', pattern: /传送带|输送线|流水线|conveyor/i },
  { id: 'filling', pattern: /灌装|填充|注液|filling/i },
  { id: 'cap', pattern: /瓶盖|盖子|泵头|cap|lid/i },
  { id: 'container', pattern: /瓶胚|瓶罐|罐体|瓶口|容器|bottle|container|canister/i },
  { id: 'pick-place', pattern: /抓取|定位|夹具|机械手|pick.?and.?place|gripper|fixture/i },
  { id: 'vibratory', pattern: /振动盘|环形盘|送料盘|vibratory|bowl feeder/i },
  { id: 'lab', pattern: /移液|称重|烧杯|实验|研发|化验|pipette|laboratory/i },
];
const productAttributeRules: Array<{ id: string; pattern: RegExp }> = [
  { id: 'blue', pattern: /蓝|blue/i }, { id: 'silver', pattern: /银|silver/i },
  { id: 'gold', pattern: /金色|金白|gold/i }, { id: 'white', pattern: /白|乳白|white/i },
  { id: 'clear', pattern: /透明|clear|transparent/i }, { id: 'frosted', pattern: /磨砂|frosted/i },
  { id: 'glass', pattern: /玻璃|glass/i }, { id: 'metal', pattern: /金属|metal/i },
  { id: 'gradient', pattern: /渐变|gradient/i }, { id: 'pump', pattern: /泵头|滴管|pump|dropper/i },
  { id: 'jar', pattern: /罐|jar/i }, { id: 'bottle', pattern: /瓶|bottle/i },
];

function storyboardVisualText(slot: StoryboardSlot): string {
  return storyboardSlotScript(slot.detail).visual || slot.title || '';
}

function materialSegmentText(segment: MaterialSegment): string {
  const observedFacts = (segment as MaterialSegment & { observedFacts?: string[] }).observedFacts || [];
  return [segment.visualTopic, segment.subject.join(' '), segment.action, segment.environment,
    segment.shot, segment.composition, ...observedFacts, ...(segment.recommendedFunctions || [])]
    .filter(Boolean).join(' ');
}

function matchingRuleIds(text: string, rules: Array<{ id: string; pattern: RegExp }>): Set<string> {
  return new Set(rules.filter(rule => rule.pattern.test(text)).map(rule => rule.id));
}

function segmentStoryboardEvidence(segment: MaterialSegment, slot: StoryboardSlot): { eligible: boolean; score: number; reason: string } {
  const wanted = storyboardVisualText(slot);
  const observed = materialSegmentText(segment);
  const wantsFactory = factoryVisualPattern.test(wanted);
  const wantsProduct = !wantsFactory && productVisualPattern.test(wanted);
  if (wantsFactory) {
    if (!factoryVisualPattern.test(observed)) return { eligible: false, score: 0, reason: '片段不是工厂实拍' };
    const wantedKinds = matchingRuleIds(wanted, factorySpecificRules);
    const observedKinds = matchingRuleIds(observed, factorySpecificRules);
    const overlap = [...wantedKinds].filter(kind => observedKinds.has(kind));
    if (wantedKinds.size && !overlap.length) return { eligible: false, score: 0, reason: '工序或主体与目标分镜不一致' };
    return {
      eligible: true,
      score: 80 + Math.min(20, overlap.length * 7),
      reason: overlap.length ? `已分析片段命中工厂主体/工序：${overlap.join('、')}` : '已分析片段为可定位的工厂实拍',
    };
  }
  if (wantsProduct) {
    if (!segment.productVisible || !['medium', 'high'].includes(segment.productClarity)) {
      return { eligible: false, score: 0, reason: '片段没有清晰可见的产品' };
    }
    const wantedAttributes = matchingRuleIds(wanted, productAttributeRules);
    const observedAttributes = matchingRuleIds(observed, productAttributeRules);
    const overlap = [...wantedAttributes].filter(kind => observedAttributes.has(kind));
    // Product replacement must not substitute a generic packshot for a visually
    // distinctive bottle. At least two observable attributes need to agree.
    if (wantedAttributes.size >= 2 && overlap.length < 2) {
      return { eligible: false, score: 0, reason: '产品外观属性不足以证明是高匹配素材' };
    }
    return { eligible: true, score: 85 + Math.min(15, overlap.length * 5), reason: '产品清晰可见且外观属性匹配' };
  }
  const dimensions = materialSemanticDimensions({
    id: 'segment-evidence', name: '', folder: '', type: 'video', duration: segment.end,
    size: '', segments: [segment],
  }, slot);
  return dimensions.topic && dimensions.purpose
    ? { eligible: true, score: 100, reason: '视觉主题和表达目的均匹配' }
    : { eligible: false, score: 0, reason: '片段证据不足' };
}

function matchStoryboardMetadata(clip: Clip, slot: StoryboardSlot): boolean {
  const dimensions = materialSemanticDimensions(clip, slot);
  return dimensions.topic || dimensions.purpose;
}

/** A production match must be grounded in one time-addressable segment.
 * Clip-level folders/tags are useful for ranking, but cannot prove that the
 * requested action is visible at the trim point used by the storyboard. */
export function verifiedStoryboardSegment(clip: Clip, slot: StoryboardSlot): MaterialSegment | undefined {
  const targetDuration = Math.max(0.5, slot.end - slot.start);
  return (clip.segments || []).filter(segment => usableEvidenceSegment(segment, clip.duration))
    .filter(segment => segment.end - segment.start >= targetDuration)
    .map(segment => ({ segment, evidence: segmentStoryboardEvidence(segment, slot) }))
    .filter(item => item.evidence.eligible)
    .sort((left, right) => right.evidence.score - left.evidence.score || left.segment.start - right.segment.start)[0]?.segment;
}

export function matchMaterialsToStoryboardLocally(
  pool: Clip[],
  slots: StoryboardSlot[],
  preferredIds: string[] = [],
  options: {
    variantIndex?: number;
    previousAssignments?: Array<Record<string, string>>;
    targetRatio?: string;
    allowSemanticMetadata?: boolean;
    requireSegmentEvidence?: boolean;
    requireEvidence?: boolean;
    allowReuse?: boolean;
    preferredBoost?: number;
  } = {},
) {
  const preferred = new Set(preferredIds);
  const unused = new Set(pool.map(clip => clip.id));
  const variantIndex = Math.max(0, options.variantIndex || 0);
  const previousAssignments = options.previousAssignments || [];
  const globalUsage = new Map<string, number>();
  previousAssignments.forEach(plan => Object.values(plan).forEach(clipId => {
    globalUsage.set(clipId, (globalUsage.get(clipId) || 0) + 1);
  }));
  const previousMaterialIds = new Set(globalUsage.keys());
  const availableFreshCount = pool.filter(clip => !previousMaterialIds.has(clip.id)).length;
  // A/B 流量测试要求“组合本身”有差异，而不只是把同一组素材换个顺序。
  // 素材充足时，每个新版本至少 60% 使用此前方案未出现过的素材。
  const minimumFreshCount = previousAssignments.length
    ? Math.min(Math.ceil(slots.length * 0.6), availableFreshCount)
    : 0;
  let freshAssignedCount = 0;
  const variantTieBreak = (value: string) => {
    let hash = 2166136261 ^ (variantIndex + 1);
    for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return ((hash >>> 0) % 1000) / 1000;
  };
  const folderKeywords: Record<string, RegExp> = {
    presenter: /人物|主播|口播|出镜|真人|presenter|host|talking/i,
    detail: /开场|钩子|细节|特写|质地|滴落|材质|纹理|hook|detail|close.?up|texture/i,
    product: /产品|外观|瓶身|结构|展示|样品|product|packshot|sample/i,
    scene: /使用|场景|体验|操作|应用|代入|use|scene|lifestyle|application/i,
    model: /模特|上脸|试用|穿戴|效果|model|try.?on|beauty/i,
    factory: /工厂|生产|产线|供应|交付|实力|仓库|factory|production|supply|warehouse/i,
    packaging: /包装|彩盒|logo|定制|品牌|packaging|custom|branding/i,
    certificate: /证书|认证|检测|资质|ce|rohs|certificate|test report/i,
  };
  const assignments: Record<string, string> = {};
  // Legacy drafts can contain title-only slots. They have no visual claim to
  // verify, so keep the historical deterministic matcher for those slots.
  // Generated slots with a real detail continue to require segment evidence.
  const allowLegacyTitleOnlyMatching = slots.every(slot => !String(slot.detail || '').trim());

  slots.forEach((slot, slotIndex) => {
    const slotText = `${slot.title} ${slot.detail}`.toLowerCase();
    const targetDuration = Math.max(0.5, slot.end - slot.start);
    const remainingSlots = slots.length - slotIndex;
    const freshStillNeeded = Math.max(0, minimumFreshCount - freshAssignedCount);
    const supportedPool = allowLegacyTitleOnlyMatching || options.requireEvidence === false
      ? pool
      : pool.filter(clip => options.requireSegmentEvidence
        ? Boolean(verifiedStoryboardSegment(clip, slot))
        : options.allowSemanticMetadata
          ? matchStoryboardMetadata(clip, slot) : Boolean(matchEvidenceSegment(clip, slot)));
    const unusedSupported = supportedPool.filter(clip => unused.has(clip.id));
    const uniquePool = unusedSupported.length
      ? unusedSupported
      : options.allowReuse === false ? [] : supportedPool;
    const freshUniquePool = uniquePool.filter(clip => !previousMaterialIds.has(clip.id));
    const mustChooseFresh = freshStillNeeded >= remainingSlots && freshUniquePool.length > 0;
    // Reuse is allowed across non-adjacent shots when it preserves a stronger
    // semantic match. Adjacent reuse incurs a larger penalty below.
    const eligiblePool = options.allowReuse === false
      ? mustChooseFresh ? freshUniquePool : uniquePool
      : options.allowSemanticMetadata ? supportedPool : mustChooseFresh ? freshUniquePool : uniquePool;
    const openingRoleOrder = [
      ['detail', 'product', 'presenter'],
      ['presenter', 'model', 'scene'],
      ['product', 'detail', 'scene'],
    ][variantIndex % 3] || ['detail', 'product', 'presenter'];
    const candidates = eligiblePool.map(clip => {
      if (options.allowSemanticMetadata) return {
        clip,
        score: assessMaterialMatch(slot, clip, options.targetRatio || '9:16').score * 10
          + Number(unused.has(clip.id)) * 20
          - Number(slotIndex > 0 && assignments[slots[slotIndex - 1].id] === clip.id) * 600,
      };
      const clipText = `${clip.name} ${clip.folder} ${clip.industry || ''} ${clip.shotFunction || ''} ${clip.applicability || ''} ${clip.tags || ''}`.toLowerCase();
      let score = 0;
      if (unused.has(clip.id)) score += 18;
      if (preferred.has(clip.id)) score += options.preferredBoost ?? 7;
      if (clip.type === 'video') score += 5;
      const verified = options.requireSegmentEvidence ? verifiedStoryboardSegment(clip, slot) : undefined;
      if (verified) score += segmentStoryboardEvidence(verified, slot).score;
      // 横竖方向只作为排序偏好，不作为硬拦截；渲染器会统一居中裁切。
      score += clipRatioPreferenceScore(clip, options.targetRatio);
      if (folderKeywords[clip.folder]?.test(slotText)) score += 28;
      const slotTerms = slotText.match(/[\u4e00-\u9fff]{2,4}|[a-z]{3,}/gi) || [];
      score += Math.min(24, slotTerms.filter(term => clipText.includes(term.toLowerCase())).length * 6);
      score += Math.max(0, 12 - Math.abs(effectiveClipDuration(clip) - targetDuration) * 2);
      if (slotIndex === 0 && (clip.folder === 'detail' || clip.folder === 'product' || clip.folder === 'presenter')) score += 8;
      if (slotIndex === 0 && openingRoleOrder.includes(clip.folder)) score += Math.max(4, 14 - openingRoleOrder.indexOf(clip.folder) * 4);
      if (slotIndex === slots.length - 1 && (clip.folder === 'product' || clip.folder === 'factory' || clip.folder === 'packaging')) score += 6;
      // 先保证分镜语义，再让新方案使用真正不同的素材集合。
      const sameSlotUsage = previousAssignments.filter(plan => plan[slot.id] === clip.id).length;
      const priorUsage = globalUsage.get(clip.id) || 0;
      score -= sameSlotUsage * 55;
      score -= priorUsage * 18;
      if (previousAssignments.length && priorUsage === 0) score += 34;
      if (slotIndex === 0 && previousAssignments.length && priorUsage === 0) score += 20;
      score += variantTieBreak(`${slot.id}:${clip.id}`) * 8;
      return { clip, score };
    }).sort((a, b) => b.score - a.score);
    const chosen = candidates[0]?.clip;
    if (!chosen) return;
    assignments[slot.id] = chosen.id;
    unused.delete(chosen.id);
    if (!previousMaterialIds.has(chosen.id)) freshAssignedCount += 1;
  });
  return assignments;
}

export function effectiveClipDuration(clip: Clip): number {
  if (clip.type === 'image') return 3;
  const usefulSegments = (clip.segments || []).filter(segment =>
    segment.duration >= 0.5
    && segment.quality >= 55
    && segment.confidence >= 0.5
    && (!segment.needsReview || segment.manualConfirmed),
  );
  if (usefulSegments.length) {
    return +Math.max(1.5, Math.min(12, usefulSegments.reduce((sum, segment) => sum + segment.duration, 0))).toFixed(1);
  }
  const roleCap: Record<string, number> = {
    detail: 4.5,
    product: 5,
    model: 5,
    scene: 5,
    factory: 6,
    presenter: 8,
    packaging: 4,
    certificate: 3.5,
  };
  return +Math.max(1.5, Math.min(clip.duration || 3, roleCap[clip.folder] || 5)).toFixed(1);
}

export type MaterialMatchAssessment = {
  score: number;
  level: 'direct' | 'review' | 'missing';
  reason: string;
  difference: string;
};

export function assessMaterialMatch(slot: StoryboardSlot, clip: Clip, _targetRatio: string): MaterialMatchAssessment {
  const verified = verifiedStoryboardSegment(clip, slot);
  if (verified) {
    const evidence = segmentStoryboardEvidence(verified, slot);
    return { score: 100, level: 'direct', reason: evidence.reason, difference: `使用 ${verified.start.toFixed(1)}–${verified.end.toFixed(1)}s 的已分析片段` };
  }
  const { topic, purpose } = materialSemanticDimensions(clip, slot);
  const visual = storyboardVisualText(slot);
  if (!factoryVisualPattern.test(visual) && productVisualPattern.test(visual)) {
    return topic
      ? { score: 50, level: 'review', reason: '产品类型相关，但缺少同一片段内的清晰外观证据', difference: '产品颜色、材质或包装外观尚未达到高匹配标准' }
      : { score: 0, level: 'missing', reason: '没有可核验的产品外观匹配证据', difference: '请上传对应产品实拍或手动指定' };
  }
  const score = (topic ? 50 : 0) + (purpose ? 50 : 0);
  const level = score === 100 ? 'direct' : score === 50 ? 'review' : 'missing';
  const reason = score === 100 ? '视觉主题和表达目的均匹配'
    : topic ? '视觉主题匹配，表达目的待标注'
      : purpose ? '表达目的匹配，视觉主题待标注' : '视觉主题和表达目的均待标注';
  return { score, level, reason, difference: reason };
}

export function storyboardSlotScript(detail: string) {
  const text = String(detail || '').replace(/\s+/g, ' ').trim();
  const labels = '环境|景别|运镜|镜头功能|画面|Visual|人物说|台词|Voiceover|VO|口播|字幕|Caption|素材|素材依据|配乐|真实性要求|可见事实|表达意图|未展示因果|Omni提示词|Omni禁止项';
  const pick = (field: string) => text.match(new RegExp(`(?:${field})\\s*[：:]\\s*[“\"]?(.+?)[”\"]?(?=\\s+(?:${labels})\\s*[：:]|$)`, 'i'))?.[1]?.trim() || '';
  const visual = pick('画面|Visual');
  const voice = pick('人物说|台词|Voiceover|VO|口播').replace(/^“|”$/g, '');
  const subtitle = pick('字幕|Caption');
  return {
    visual,
    voice,
    subtitle,
    fallback: text.replace(/^\[[^\]]+\]\s*/, '').slice(0, 180),
  };
}
