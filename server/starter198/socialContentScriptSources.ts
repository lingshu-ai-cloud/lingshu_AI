import type {
  SocialContentThemeId,
  SocialReferenceShotAnalysis,
  SocialReferenceVideoAnalysis,
  SocialReplicationScriptShot,
  SocialReplicationScriptVersion,
  SocialShotFunction,
  SocialShotMaterialMapEntry,
  SocialShotSourceStrategy,
  SocialShotTruthBoundary,
  SocialTaskSource,
  SocialThreeSecondHook,
} from '../../shared/contracts/socialContentWorkflow.js';
import { store } from '../storage/index.js';
import type { SocialInspirationScriptMatch, VerifiedSocialScriptContext } from './socialContentScriptBaseline.js';
import {
  SocialContentWorkflowError,
  socialJson,
  socialObject,
  socialRequestHash,
  socialText,
} from './socialContentValidation.js';
import { deriveNarrationStyleProfile, type NarrationStyleProfile } from '../digitalEmployees/narrationStyle.js';
import {
  normalizeSceneVisualContract,
  type SocialSceneCapabilitySignature,
  type SocialSceneProductionAdmission,
  type SocialSceneVisualContract,
} from '../../shared/sceneVisualContract.js';

const THEME_TERMS: Record<SocialContentThemeId, readonly string[]> = {
  product_value: ['产品', '卖点', '细节', '成分', '材质', '性能', 'product', 'feature', 'detail'],
  scenario_solution: ['场景', '使用', '问题', '解决', '效果', 'use', 'problem', 'solution', 'result'],
  supplier_capability: ['工厂', '车间', '产线', '生产', '质检', '仓储', '供应', 'factory', 'production', 'quality'],
  customization_process: ['定制', '打样', '包装', '合作', '流程', 'oem', 'odm', 'sample', 'custom'],
  customer_case: ['客户', '案例', '合作', '成果', '授权', 'case', 'customer', 'result'],
};

function recordObject(value: unknown): Record<string, unknown> {
  return socialObject(socialJson(value)) ?? {};
}

function listText(value: unknown): string[] {
  return Array.isArray(value) ? value.map(socialText).filter(Boolean) : [];
}

type ExactReferenceDetail = {
  detail: Record<string, unknown>;
  timing: { startSeconds: number; endSeconds: number; durationSeconds: number };
};

export interface ResolvedSocialTaskReference {
  match: SocialInspirationScriptMatch;
  referenceVideoAnalysis: SocialReferenceVideoAnalysis;
  replicationScript: SocialReplicationScriptVersion;
  shotMaterialMap: SocialShotMaterialMapEntry[];
}

export function pendingSocialTaskReferenceAnalysis(
  source: Pick<SocialTaskSource, 'sourceId' | 'sourceRef' | 'createdAt'>,
): SocialReferenceVideoAnalysis {
  const recommendation = source.sourceId.startsWith('system-reference:');
  return {
    analysisId: `reference-analysis-${socialRequestHash({ sourceId: source.sourceId, sourceRef: normalizedReferenceIdentity(source.sourceRef) }).slice(0, 20)}`,
    version: socialRequestHash({ sourceId: source.sourceId, sourceRef: normalizedReferenceIdentity(source.sourceRef), createdAt: source.createdAt }).slice(0, 12),
    referenceSourceId: source.sourceId,
    status: 'analyzing',
    durationSeconds: null,
    analysisLayers: [
      { level: 'L0', status: 'partial', scope: '已记录参考来源，等待读取平台元数据与完整时长', confidence: null },
      { level: 'L1', status: 'pending', scope: '等待 ASR、OCR、抽帧和镜头切分', confidence: null },
      { level: 'L2', status: 'pending', scope: '等待全片结构与节奏分析', confidence: null },
      { level: 'L3', status: 'pending', scope: '等待精确分镜与连续性分析', confidence: null },
      { level: 'L4', status: 'pending', scope: '等待人工修正与真实制作结果回流', confidence: null },
    ],
    coverage: {
      fullDurationSeconds: null,
      precisionIntervals: [],
      gaps: [],
      overallConfidence: null,
      fullTimelineCovered: false,
    },
    shots: [],
    hookAnalysis: null,
    rightsNotice: recommendation
      ? '系统正在寻找并分析适合当前任务的参考视频；推荐结果需要明确展示为系统推荐，不代表用户已确认，也不代表版权已经确认。'
      : '参考链接正在进行逐镜分析。提交链接仅代表允许系统分析，不代表版权已经确认；分析完成后口播会逐字逐句冻结并仅替换企业名、品牌名或产品名，系统不会复用原视频文件、人物身份、水印或原声音频。',
    createdAt: source.createdAt,
  };
}

function timeSeconds(value: string): number {
  const parts = value.split(':').map(Number);
  if (!parts.length || parts.some(part => !Number.isFinite(part))) return Number.NaN;
  return parts.reduce((sum, part) => sum * 60 + part, 0);
}

function detailTiming(detail: Record<string, unknown>): ExactReferenceDetail['timing'] | null {
  const value = socialText(detail.time) || socialText(detail.timestamp);
  const token = String.raw`(?:\d{1,2}:){1,2}\d{1,2}(?:\.\d+)?|\d+(?:\.\d+)?`;
  const match = value.match(new RegExp(`(${token})\\s*(?:s|秒)?\\s*(?:-|–|—|~|～|至|to)\\s*(${token})`, 'i'));
  if (!match) return null;
  const startSeconds = timeSeconds(match[1]!);
  const endSeconds = timeSeconds(match[2]!);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds - startSeconds < 0.2) return null;
  return {
    startSeconds: +startSeconds.toFixed(2),
    endSeconds: +endSeconds.toFixed(2),
    durationSeconds: +(endSeconds - startSeconds).toFixed(2),
  };
}

function exactAnalysis(record: Record<string, unknown>): {
  analysis: Record<string, unknown>;
  gemini: Record<string, unknown>;
  details: ExactReferenceDetail[];
} | null {
  const analysis = recordObject(record.aiAnalysis);
  const gemini = recordObject(analysis.gemini);
  const rawDetails = Array.isArray(socialJson(gemini.scriptDetails15s))
    ? (socialJson(gemini.scriptDetails15s) as unknown[]).map(recordObject).filter(item => Object.keys(item).length)
    : [];
  const seenRanges = new Set<string>();
  const details = rawDetails.flatMap(detail => {
    const timing = detailTiming(detail);
    if (!timing || detail.needsReview === true) return [];
    const key = `${timing.startSeconds.toFixed(2)}-${timing.endSeconds.toFixed(2)}`;
    if (seenRanges.has(key)) return [];
    seenRanges.add(key);
    return [{ detail, timing }];
  }).sort((left, right) => left.timing.startSeconds - right.timing.startSeconds
    || left.timing.endSeconds - right.timing.endSeconds);
  if (socialText(analysis.analysisMode) !== 'exact'
    || socialText(analysis.analysisQuality) !== 'video'
    || details.length < 2) return null;
  return { analysis, gemini, details };
}

function synthetic(record: Record<string, unknown>, analysis: Record<string, unknown>): boolean {
  if ([record.synthetic, record.isMock, record.isDemo, analysis.synthetic, analysis.isMock].some(value => value === true)) return true;
  const marker = [record.source, record.sourceType, analysis.source, analysis.sourceType]
    .map(socialText).join(' ').toLowerCase();
  return /(?:^|[\s_./:-])(fixture|mock|placeholder|demo_seed|sample_data)(?:$|[\s_./:-])/.test(marker);
}

function referenceCoverage(input: {
  record: Record<string, unknown>;
  exact: NonNullable<ReturnType<typeof exactAnalysis>>;
  shots: SocialReferenceShotAnalysis[];
}): NonNullable<SocialReferenceVideoAnalysis['coverage']> {
  const declaredDuration = Number(input.record.duration || recordObject(input.record.videoMeta).duration || 0);
  const analyzedUntil = Math.max(0, ...input.shots.map(shot => shot.endSeconds));
  const fullDurationSeconds = declaredDuration > 0 ? declaredDuration : analyzedUntil || null;
  const gaps: Array<{ startSeconds: number; endSeconds: number; reason: string }> = [];
  let cursor = 0;
  for (const shot of input.shots) {
    if (shot.startSeconds - cursor > 0.15) {
      gaps.push({ startSeconds: +cursor.toFixed(2), endSeconds: +shot.startSeconds.toFixed(2), reason: '该区间没有通过精确分析校验，保留为空档等待补充分析' });
    }
    cursor = Math.max(cursor, shot.endSeconds);
  }
  if (fullDurationSeconds !== null && fullDurationSeconds - cursor > 0.15) {
    gaps.push({ startSeconds: +cursor.toFixed(2), endSeconds: +fullDurationSeconds.toFixed(2), reason: '精确分析尚未覆盖视频尾部，不能用已分析区间代替整片时长' });
  }
  const confidenceValues = input.exact.details
    .map(item => Number(item.detail.confidence))
    .filter(value => Number.isFinite(value) && value >= 0 && value <= 1);
  const overallConfidence = confidenceValues.length
    ? +(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length).toFixed(3)
    : null;
  return {
    fullDurationSeconds,
    precisionIntervals: input.shots.map(shot => ({ startSeconds: shot.startSeconds, endSeconds: shot.endSeconds, level: 'L3' as const })),
    gaps,
    overallConfidence,
    fullTimelineCovered: fullDurationSeconds !== null && gaps.length === 0 && cursor >= fullDurationSeconds - 0.15,
  };
}

function combinedText(detail: Record<string, unknown>, fields: string[]): string {
  return fields.flatMap(field => field === 'beats'
    ? (Array.isArray(socialJson(detail.beats))
      ? (socialJson(detail.beats) as unknown[]).map(item => socialText(recordObject(item).action))
      : [])
    : [socialText(detail[field])]).filter(Boolean).join(' ').toLocaleLowerCase();
}

function safeShotFunction(detail: Record<string, unknown>, themeId: SocialContentThemeId): string {
  const text = combinedText(detail, ['purpose', 'visual', 'observedFacts', 'inferredIntent']);
  if (/(?:钩子|开场|吸引|首屏|痛点|hook|opening|attention|problem)/i.test(text)) return '开场吸引';
  if (/(?:质检|检测|证据|数据|对比|结果|认证|test|inspect|evidence|data|comparison|result)/i.test(text)) return '证据呈现';
  if (/(?:工厂|车间|产线|生产|灌装|机器|factory|workshop|production|manufactur)/i.test(text)) return '现场过程展示';
  if (/(?:使用|操作|涂抹|演示|步骤|use|apply|demo|operation|step)/i.test(text)) return '真实过程演示';
  if (/(?:细节|质地|纹理|成分|包装|瓶身|特写|detail|texture|ingredient|package|close)/i.test(text)) return '细节展示';
  if (/(?:装箱|仓储|发货|交付|shipment|warehouse|delivery|packing)/i.test(text)) return '包装与交付展示';
  if (/(?:收束|结尾|行动|咨询|ending|summary|call.to.action|cta)/i.test(text)) return '信息收束';
  return ({
    product_value: '产品画面展示',
    scenario_solution: '场景过程展示',
    supplier_capability: '供应现场展示',
    customization_process: '合作过程展示',
    customer_case: '合作证据展示',
  } satisfies Record<SocialContentThemeId, string>)[themeId];
}

function safeSubject(detail: Record<string, unknown>): string {
  // This is a closed taxonomy. It intentionally never copies a brand, a
  // person's identity/appearance, original dialogue or reference-video claim.
  const text = combinedText(detail, ['visual', 'observedFacts', 'environment', 'purpose', 'beats']);
  if (/(?:质检|检测|仪器|记录|参数|证书|inspect|test|instrument|record|certificate|data)/i.test(text)) return '素材中可见的检验或记录';
  if (/(?:工厂|车间|产线|生产|机器|设备|factory|workshop|production|machine|equipment)/i.test(text)) return '素材中的真实生产现场';
  if (/(?:装箱|仓储|发货|包装线|shipment|warehouse|delivery|packing)/i.test(text)) return '素材中的包装或交付过程';
  if (/(?:质地|纹理|液体|膏体|粉体|配方|texture|liquid|cream|powder|formula)/i.test(text)) return '素材中可见的产品细节';
  if (/(?:使用|操作|涂抹|手部|拿取|演示|use|apply|operation|hand|demo)/i.test(text)) return '素材中的真实操作动作';
  if (/(?:产品|瓶|罐|盒|包装|实物|product|bottle|jar|box|package)/i.test(text)) return '素材中的产品实物';
  return '素材中的真实场景';
}

function safeReferenceStructure(row: ExactReferenceDetail): SocialInspirationScriptMatch['nodes'][number]['referenceStructure'] {
  const shotText = combinedText(row.detail, ['shot', 'visual', 'composition']);
  const cameraText = combinedText(row.detail, ['camera']);
  const transitionText = combinedText(row.detail, ['transitionToNext']);
  const beats = Array.isArray(socialJson(row.detail.beats)) ? (socialJson(row.detail.beats) as unknown[]) : [];
  const shotScale = /(?:大特写|极近|macro|extreme.close)/i.test(shotText) ? '极近特写'
    : /(?:特写|近景|close)/i.test(shotText) ? '近景特写'
      : /(?:中景|medium)/i.test(shotText) ? '中景'
        : /(?:全景|远景|wide|long.shot)/i.test(shotText) ? '全景' : '通用景别';
  const cameraMovement = /(?:推进|推镜|push|dolly.in|zoom.in)/i.test(cameraText) ? '推进镜头'
    : /(?:拉远|拉镜|pull|dolly.out|zoom.out)/i.test(cameraText) ? '拉远镜头'
      : /(?:横移|摇镜|平移|pan|slide)/i.test(cameraText) ? '横向摇移'
        : /(?:跟随|跟拍|tracking|follow)/i.test(cameraText) ? '跟随镜头'
          : /(?:手持|handheld)/i.test(cameraText) ? '手持镜头'
            : /(?:固定|静止|static|locked)/i.test(cameraText) ? '固定镜头' : '通用运镜';
  const paceText = `${cameraText} ${transitionText} ${socialText(row.detail.purpose)}`;
  const pace = /(?:慢|舒缓|缓慢|slow|gentle)/i.test(paceText) ? '舒缓'
    : /(?:快|闪切|跳切|fast|rapid|jump)/i.test(paceText) || beats.length >= 3 || row.timing.durationSeconds <= 1.5 ? '快速'
      : row.timing.durationSeconds <= 3.2 ? '紧凑' : '舒缓';
  const transition = /(?:闪切|跳切|硬切|jump|hard.cut|flash)/i.test(transitionText) ? '快速切换'
    : /(?:淡入|淡出|叠化|溶解|fade|dissolve)/i.test(transitionText) ? '柔和过渡'
      : /(?:动作|匹配|match|movement)/i.test(transitionText) ? '动作衔接' : '自然衔接';
  return { sourceTiming: row.timing, shotScale, cameraMovement, pace, transition };
}

function safeReferenceNodes(
  themeId: SocialContentThemeId,
  details: ExactReferenceDetail[],
): SocialInspirationScriptMatch['nodes'] {
  return details.slice(0, 12).map((row, index, nodes) => {
    const referenceStructure = safeReferenceStructure(row);
    return {
      nodeId: `inspiration-${index + 1}`,
      shotFunction: safeShotFunction(row.detail, themeId),
      subject: safeSubject(row.detail),
      action: `${referenceStructure.shotScale} · ${referenceStructure.cameraMovement} · ${referenceStructure.pace}节奏 · ${referenceStructure.transition}`,
      referenceStructure,
      narrationTemplate: {
        zh: index === 0 ? '通过客户上传的真实画面，看看{{product}}。'
          : index === nodes.length - 1 ? '只呈现真实画面和已确认资料。{{callToAction}}'
            : '以下内容只说明素材中真实可见的画面。',
        en: index === 0 ? 'See {{product}} through real customer-supplied footage.'
          : index === nodes.length - 1 ? 'Only real footage and verified information are presented. {{callToAction}}'
            : 'This section stays within what is visibly supported by the supplied footage.',
      },
    };
  });
}

function referenceNarrationLines(details: ExactReferenceDetail[]): string[] {
  return details.map(item => {
    const direct = [item.detail.spokenText, item.detail.dialogue, item.detail.voiceover]
      .find(value => typeof value === 'string' && value.length > 0);
    if (typeof direct === 'string') return direct;
    const audio = typeof item.detail.audio === 'string' ? item.detail.audio : '';
    const match = audio.match(/^ASR\s*:\s*([\s\S]*)$/i);
    return match?.[1] ?? '';
  });
}

function referenceCaptionLines(details: ExactReferenceDetail[]): string[] {
  return details.map(item => {
    const direct = [item.detail.captionText, item.detail.onScreenText, item.detail.subtitle]
      .find(value => typeof value === 'string' && value.length > 0);
    return typeof direct === 'string' ? direct : '';
  });
}

type IdentityEntityType = 'company' | 'brand' | 'product';
type ReferenceIdentityPlan = Record<IdentityEntityType, { originals: string[]; replacement: string | null }>;

function identityStrings(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap(item => typeof item === 'string' ? [item] : []).filter(Boolean);
}

function structuredIdentityTokens(
  type: IdentityEntityType,
  record: Record<string, unknown>,
  exact: NonNullable<ReturnType<typeof exactAnalysis>>,
): string[] {
  const keys = type === 'company'
    ? ['companyName', 'enterpriseName', 'company']
    : type === 'brand'
      ? ['brandName', 'brand']
      : ['productName', 'productRef', 'product'];
  const containers = [record, exact.analysis, exact.gemini, ...exact.details.map(item => item.detail)];
  const direct = containers.flatMap(container => keys.flatMap(key => identityStrings(container[key])));
  const entityRows = containers.flatMap(container => {
    const value = container.identityEntities ?? container.namedEntities ?? container.entities;
    return Array.isArray(value) ? value.map(recordObject) : [];
  });
  const tagged = entityRows.flatMap(entity => {
    const entityType = socialText(entity.type || entity.kind || entity.entityType).toLocaleLowerCase();
    const matches = type === 'company' ? /company|enterprise|企业|公司/.test(entityType)
      : type === 'brand' ? /brand|品牌/.test(entityType)
        : /product|sku|产品|商品/.test(entityType);
    return matches ? identityStrings(entity.text ?? entity.value ?? entity.name) : [];
  });
  return [...new Set([...direct, ...tagged].map(value => value.trim()).filter(Boolean))];
}

/** Legacy exact analyses did not always emit named entities. Only infer a
 * leading handle/acronym when it is repeated in title and visible analysis;
 * ordinary nouns, claims and the remainder of the sentence are never touched. */
function conservativeLegacyProductIdentity(
  record: Record<string, unknown>,
  exact: NonNullable<ReturnType<typeof exactAnalysis>>,
  lines: string[],
): string[] {
  const first = lines.find(Boolean) ?? '';
  const token = first.match(/^\s*((?:@[\p{L}\p{N}_.-]{2,40})|(?:[A-Z][A-Z0-9_-]{1,31}))(?=\s|[，,。.!！?？:：]|$)/u)?.[1];
  if (!token) return [];
  const title = socialText(record.title);
  const visuals = exact.details.map(item => socialText(item.detail.visual)).join(' ');
  return title.includes(token) && visuals.includes(token) ? [token] : [];
}

function identityPlan(input: {
  record: Record<string, unknown>;
  exact: NonNullable<ReturnType<typeof exactAnalysis>>;
  referenceLines: string[];
  verifiedContext: VerifiedSocialScriptContext;
  replacements?: Partial<Record<`${IdentityEntityType}Name`, string | null>>;
}): ReferenceIdentityPlan {
  const explicitProduct = structuredIdentityTokens('product', input.record, input.exact);
  return {
    company: {
      originals: structuredIdentityTokens('company', input.record, input.exact),
      replacement: socialText(input.replacements?.companyName) || input.verifiedContext.enterpriseName || null,
    },
    brand: {
      originals: structuredIdentityTokens('brand', input.record, input.exact),
      replacement: socialText(input.replacements?.brandName) || input.verifiedContext.brandName || null,
    },
    product: {
      originals: explicitProduct.length
        ? explicitProduct
        : conservativeLegacyProductIdentity(input.record, input.exact, input.referenceLines),
      replacement: socialText(input.replacements?.productName) || input.verifiedContext.productName || null,
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceIdentityOnly(text: string, plan: ReferenceIdentityPlan): {
  text: string;
  replacedEntityTypes: IdentityEntityType[];
} {
  let output = text;
  const replaced = new Set<IdentityEntityType>();
  const replacements = (['company', 'brand', 'product'] as const).flatMap(type => {
    const replacement = plan[type].replacement;
    if (!replacement) return [];
    return plan[type].originals.map(original => ({ type, original, replacement }));
  }).filter(item => item.original && item.original !== item.replacement)
    .sort((left, right) => right.original.length - left.original.length);
  for (const item of replacements) {
    const escaped = escapeRegExp(item.original);
    // ASCII names need token boundaries (so `ACME` does not alter
    // `ACMECorp`). Chinese identity words are normally adjacent to particles
    // such as “的”; Unicode word boundaries would incorrectly prevent those
    // exact replacements.
    const tokenLike = /^[A-Za-z0-9_@.-]+$/.test(item.original);
    const pattern = new RegExp(tokenLike ? `(?<![\\p{L}\\p{N}_-])${escaped}(?![\\p{L}\\p{N}_-])` : escaped, 'giu');
    const next = output.replace(pattern, item.replacement);
    if (next !== output) replaced.add(item.type);
    output = next;
  }
  return { text: output, replacedEntityTypes: (['company', 'brand', 'product'] as const).filter(type => replaced.has(type)) };
}

export function normalizedReferenceIdentity(value: unknown): string {
  return socialText(value).trim().replace(/\/$/, '').toLocaleLowerCase();
}

export function recordReferenceIdentities(record: Record<string, unknown>): Set<string> {
  return new Set([
    record.id,
    record.sourceUrl,
    record.url,
    record.originalUrl,
    record.shareUrl,
    record.videoUrl,
  ].map(normalizedReferenceIdentity).filter(Boolean));
}

export function sourceReferenceIdentities(source: Pick<SocialTaskSource, 'sourceRef'>): Set<string> {
  const reference = normalizedReferenceIdentity(source.sourceRef);
  const suffix = reference.match(/^(?:trendvideo|trend_video|video):(.+)$/)?.[1] ?? '';
  return new Set([reference, normalizedReferenceIdentity(suffix)].filter(Boolean));
}

function shotPurpose(detail: Record<string, unknown>, themeId: SocialContentThemeId): SocialShotFunction {
  const safe = safeShotFunction(detail, themeId);
  if (safe === '开场吸引') return 'hook';
  if (safe === '证据呈现') return 'proof';
  if (safe === '真实过程演示' || safe === '现场过程展示') return 'demonstration';
  if (safe === '信息收束') return 'call_to_action';
  if (safe === '细节展示' || safe === '产品画面展示') return 'value';
  return themeId === 'customer_case' ? 'trust'
    : themeId === 'scenario_solution' ? 'problem'
      : themeId === 'supplier_capability' ? 'trust'
        : 'value';
}

function truthBoundaryFor(input: {
  purpose: SocialShotFunction;
  subject: string;
}): SocialShotTruthBoundary {
  const factory = /生产现场|工厂|车间|产线/.test(input.subject);
  const customerCase = /客户案例|客户现场|客户使用/.test(input.subject);
  const effect = /(人物|人脸|模特|用户).*(使用|涂抹|上脸|效果|对比)|(使用|涂抹|上脸).*(产品|效果)/.test(input.subject);
  const subject = factory ? 'customer_factory' as const
    : customerCase ? 'customer_case' as const
      : effect ? 'product_effect' as const
        : 'none' as const;
  const evidenceRequired = subject !== 'none' || input.purpose === 'proof';
  return {
    subject,
    syntheticVisualAllowed: !evidenceRequired,
    customerEvidenceRequired: evidenceRequired,
    customerEvidenceRefs: [],
    confirmedFactRefs: [],
    mustNotImplyCustomerReality: true,
    prohibitedRepresentations: [
      'depict_generated_factory_as_customer_factory',
      'invent_customer_case_or_results',
      'depict_generated_effect_as_verified_product_result',
      'alter_locked_product_identity',
      'present_synthetic_media_as_customer_evidence',
    ],
  };
}

function productionStrategyFor(
  boundary: SocialShotTruthBoundary,
  _purpose: SocialShotFunction,
  visualContract?: SocialSceneVisualContract | null,
): SocialShotSourceStrategy {
  if (boundary.subject === 'customer_factory' || boundary.subject === 'customer_case') return 'customer_real_asset';
  const signature = visualContract ? capabilitySignature(visualContract) : null;
  if (boundary.subject === 'product_effect' || signature?.requiresPerson) return 'authorized_digital_presenter';
  if (signature?.requiresProductIdentity) return 'aigc_product_scene_replication';
  return 'customer_real_asset';
}

function structuralFidelityPoints(input: {
  purpose: SocialShotFunction;
  structure: SocialInspirationScriptMatch['nodes'][number]['referenceStructure'];
}): string[] {
  return [
    `保留镜头功能：${input.purpose}`,
    `保留时间位置：${input.structure.sourceTiming.startSeconds}-${input.structure.sourceTiming.endSeconds} 秒`,
    `保留景别与运镜：${input.structure.shotScale}、${input.structure.cameraMovement}`,
    `保留节奏与转场：${input.structure.pace}、${input.structure.transition}`,
  ];
}

const REQUIRED_DIFFERENCES = [
  '口播逐字逐句冻结，仅替换企业名、品牌名或产品名；不得改写事实、句序、停顿与时长',
  '字幕仅做同一组身份词替换；替换原视频账号标识和水印',
  '开场使用目标商品身份生成，后续优先使用素材库真实画面',
  '保持原信息顺序，同时增加全新音乐、音效和字幕动效包装',
] as const;

function sceneContractForReference(input: {
  row: ExactReferenceDetail;
  productRef: string | null;
}): SocialSceneVisualContract {
  const raw = input.row.detail;
  const visual = socialText(raw.visual);
  const action = combinedText(raw, ['visual', 'observedFacts', 'beats']);
  const subjects = [
    ...listText(raw.subjects),
    ...(/人物|真人|员工|工人|模特|主播|脸|手|person|people|human|worker|presenter|model|face|hand/i.test(visual) ? ['画面人物'] : []),
    ...(/产品|商品|包装|瓶|罐|盒|膏体|液体|product|package|bottle|jar|box|cream|serum/i.test(visual) ? ['画面产品'] : []),
    ...(/工厂|车间|产线|生产线|设备|factory|workshop|production.?line/i.test(visual) ? ['工厂环境'] : []),
    socialText(raw.subject),
  ].filter(Boolean);
  return normalizeSceneVisualContract({
    subjects: subjects.length ? subjects : [safeSubject(raw)],
    interaction: socialText(raw.interaction) || action,
    subjectRelations: raw.subjectRelations,
    environment: socialText(raw.environment) || visual,
    productUsage: socialText(raw.productUsage) || action,
    product: {
      policy: input.productRef ? 'preferred' : 'open',
      requestedProductRef: input.productRef,
      source: input.productRef ? 'agent_inferred' : 'inventory_open',
    },
    action: {
      startState: socialText(raw.startState) || `${safeSubject(raw)}处于本镜头的可见初始状态`,
      path: action,
      peakState: socialText(raw.peakState),
      endState: socialText(raw.endState) || `${safeSubject(raw)}停留在镜头结束状态`,
      startSeconds: input.row.timing.startSeconds,
      peakSeconds: Number.isFinite(Number(raw.actionPeak)) ? Number(raw.actionPeak) : null,
      endSeconds: input.row.timing.endSeconds,
    },
    camera: {
      shotSize: socialText(raw.shot),
      angle: socialText(raw.angle),
      movement: socialText(raw.camera),
      composition: socialText(raw.composition),
    },
    precision: input.row.timing.startSeconds < 3 ? 'hook_high' : 'standard',
    evidence: {
      sourceRange: { startSeconds: input.row.timing.startSeconds, endSeconds: input.row.timing.endSeconds },
      keyframeIds: listText(raw.keyframeIds),
      confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : null,
    },
  });
}

function capabilitySignature(contract: SocialSceneVisualContract): SocialSceneCapabilitySignature {
  const subjectKinds = new Set(contract.subjects.map(subject => subject.kind));
  const requiresPerson = subjectKinds.has('person') || contract.interaction.kind.startsWith('person_')
    || contract.interaction.kind === 'apply_product_to_face';
  const requiresProductIdentity = subjectKinds.has('product') || contract.productUsage.kind !== 'none'
    || ['person_holding_product', 'person_using_product', 'apply_product_to_face', 'product_only_display', 'product_motion']
      .includes(contract.interaction.kind);
  const requiresPersonProductContact = ['person_holding_product', 'person_using_product', 'apply_product_to_face']
    .includes(contract.interaction.kind) || ['hold', 'open_close', 'dispense', 'apply_to_face', 'apply_to_hand']
      .includes(contract.productUsage.kind);
  const requiresEnvironmentInteraction = contract.interaction.kind === 'person_factory_interaction';
  const requiredCapabilities = [
    ...(requiresPerson ? ['digital_human'] : []),
    ...(requiresProductIdentity ? ['product_identity_control'] : []),
    ...(requiresPersonProductContact ? ['person_product_interaction'] : []),
    ...(requiresEnvironmentInteraction ? ['environment_interaction'] : []),
    ...(!requiresPerson && requiresProductIdentity ? ['product_aigc'] : []),
    ...(!requiresPerson && !requiresProductIdentity ? ['material_edit'] : []),
  ];
  return {
    contractVersion: contract.schemaVersion,
    requiresPerson,
    requiresProductIdentity,
    requiresPersonProductContact,
    requiresEnvironmentInteraction,
    interaction: contract.interaction.kind,
    productUsage: contract.productUsage.kind,
    requiredCapabilities: [...new Set(requiredCapabilities)],
  };
}

function currentStackAdmission(signature: SocialSceneCapabilitySignature): SocialSceneProductionAdmission {
  const route = signature.requiresPerson
    ? 'digital_human' as const
    : signature.requiresProductIdentity
      ? 'product_aigc' as const
      : 'material_edit' as const;
  return {
    status: 'admitted',
    route,
    executable: true,
    confidence: signature.requiresPersonProductContact || signature.requiresEnvironmentInteraction ? 0.78 : 0.92,
    requiredCapabilities: [...signature.requiredCapabilities],
    unsupportedRequirements: [],
    fallbackRoutes: route === 'digital_human'
      ? ['material_edit', 'shooting_plan']
      : route === 'product_aigc'
        ? ['material_edit', 'shooting_plan']
        : ['shooting_plan'],
  };
}

function publicShot(input: {
  row: ExactReferenceDetail;
  index: number;
  themeId: SocialContentThemeId;
  spokenText?: string;
  captionText?: string;
  productRef?: string | null;
}): SocialReferenceShotAnalysis {
  const purpose = shotPurpose(input.row.detail, input.themeId);
  const subject = safeSubject(input.row.detail);
  const structure = safeReferenceStructure(input.row);
  const truth = truthBoundaryFor({ purpose, subject });
  const detailText = (fields: string[]) => combinedText(input.row.detail, fields);
  const shotText = detailText(['shot', 'visual']);
  const angleText = detailText(['angle', 'camera']);
  const compositionText = detailText(['composition']);
  const voiceDetected = Boolean(detailText(['dialogue']));
  const captionDetected = Boolean(detailText(['onScreenText', 'subtitle']));
  const ambientDetected = Boolean(detailText(['ambientSound']));
  const musicDetected = Boolean(detailText(['bgm']));
  const effectsDetected = Boolean(detailText(['soundEffects']));
  const visualContract = sceneContractForReference({
    row: input.row,
    productRef: input.productRef ?? null,
  });
  const strategy = productionStrategyFor(truth, purpose, visualContract);
  return {
    shotId: `reference-shot-${input.index + 1}`,
    startSeconds: structure.sourceTiming.startSeconds,
    endSeconds: structure.sourceTiming.endSeconds,
    visualDescription: `${subject}；${structure.shotScale}，${structure.cameraMovement}`,
    spokenText: input.spokenText ?? null,
    captionText: input.captionText ?? null,
    audioDescription: '口播逐字逐句冻结并仅替换身份词；保留声画配合，重新制作配音、配乐和音效。',
    rhythmDescription: `${structure.pace}节奏，${structure.transition}`,
    purpose,
    action: {
      startState: `${subject}处于本镜头的可见初始状态`,
      path: purpose === 'demonstration' ? `主体完成可观察的操作过程` : `主体按${structure.cameraMovement}逐步揭示信息`,
      endState: `${subject}停留在可与下一镜衔接的结束状态`,
      spatialRelation: '只记录画面中可确认的主体位置和连续关系；无法确认的左右方向不补写',
    },
    shotLanguage: {
      shotSize: structure.shotScale,
      cameraAngle: /俯拍|overhead|top.down/i.test(angleText) ? '俯拍' : /仰拍|low.angle/i.test(angleText) ? '仰拍' : /侧面|side/i.test(angleText) ? '侧面机位' : '未确认具体角度',
      movement: structure.cameraMovement,
      composition: /对称|symmetr/i.test(compositionText) ? '对称构图' : /三分|third/i.test(compositionText) ? '三分构图' : /中心|center/i.test(compositionText) ? '中心构图' : '未确认具体构图',
    },
    audioLayers: {
      voice: voiceDetected ? '检测到人声层；按原节奏保留并做产品关键词替换' : null,
      captions: captionDetected ? '检测到字幕层；保留信息顺序并重新制作字幕动效' : null,
      ambient: ambientDetected ? '检测到环境声层' : null,
      music: musicDetected ? '检测到音乐层；新视频必须重新授权或替换' : null,
      soundEffects: effectsDetected ? '检测到音效层' : null,
    },
    observation: {
      observableFacts: [subject, structure.shotScale, structure.cameraMovement],
      inferredIntent: [`推断镜头作用为：${purpose}`],
      causalGaps: structure.transition === '自然衔接' ? [] : ['转场可能压缩真实过程，不能据此推断未展示的因果关系'],
      postProductionOverlays: captionDetected ? ['字幕或平台文字属于后期叠加层，不属于物理场景'] : [],
    },
    visualContract,
    tags: {
      sceneTypes: [/生产现场/.test(subject) ? '工厂实拍结构' : purpose === 'demonstration' ? '使用演示结构' : '产品内容结构'],
      subjects: [subject],
      subjectRelations: [purpose === 'demonstration' ? '主体执行动作' : '主体承担镜头信息'],
      cameraLanguage: [structure.shotScale, structure.cameraMovement, structure.transition],
      contentFunctions: [purpose],
      soundTypes: ['原口播仅做企业名、品牌名或产品名替换', '重新配乐与音效'],
      onScreenInformation: ['原字幕仅做身份词替换与动效重制'],
      truthRequirements: [truth.subject],
      suggestedProductionMethods: [strategy],
    },
    fidelityPoints: structuralFidelityPoints({ purpose, structure }),
    mustDifferPoints: [...REQUIRED_DIFFERENCES],
  };
}

function hookOption(input: {
  analysisId: string;
  role: SocialThreeSecondHook['role'];
  index: number;
  firstShot: SocialReferenceShotAnalysis;
  strategy: SocialShotSourceStrategy;
  productLabel: string;
  narrationStyle?: NarrationStyleProfile | null;
}): SocialThreeSecondHook {
  const truthBoundary = truthBoundaryFor({ purpose: 'hook', subject: input.firstShot.visualDescription });
  const signature = capabilitySignature(input.firstShot.visualContract
    ?? normalizeSceneVisualContract({ subjects: input.firstShot.tags.subjects, interaction: input.firstShot.action?.path, precision: 'hook_high' }));
  const alternatives = [
    {
      firstFrame: `直接展示${input.firstShot.visualDescription}`,
      firstSecondAction: '第一秒立即进入核心动作，不使用片头铺垫。',
      mechanism: '沿用参考视频的首屏信息密度和节奏，但替换全部内容表达。',
      audiovisualPlan: '首帧主体与第一句口播同时出现，三秒内完成问题或价值承诺。',
    },
    {
      firstFrame: '数字人或人物近景提出一个与产品相关的真实问题。',
      firstSecondAction: '人物在第一秒完成提问，画面立即切到解决方向。',
      mechanism: '把参考视频的视觉钩子改写为问题钩子。',
      audiovisualPlan: '短句提问配大字字幕，第二秒进入产品或场景画面。',
    },
    {
      firstFrame: '用动态图形快速呈现一个已确认的产品类别或使用场景。',
      firstSecondAction: '首秒完成关键词放大，并衔接第一个功能镜头。',
      mechanism: '把参考视频的开场节奏改写为信息型钩子。',
      audiovisualPlan: '动态图形、提示音和全新字幕同步进入，避免复用原片声画元素。',
    },
  ] as const;
  const option = alternatives[input.index]!;
  const learnedHook = input.narrationStyle?.hookMechanism === 'question'
    ? `你选${input.productLabel}时，最容易忽略什么？`
    : input.narrationStyle?.hookMechanism === 'contrast'
      ? `看${input.productLabel}，不是先听形容词，而是先核对真正影响判断的信息。`
      : `看${input.productLabel}，先别听形容词，三秒抓住真正值得核对的细节。`;
  return {
    hookId: `hook-${socialRequestHash({ analysisId: input.analysisId, index: input.index }).slice(0, 12)}`,
    role: input.role,
    ...option,
    spokenLine: input.index === 0 ? learnedHook
      : input.index === 1 ? `你选${input.productLabel}时，最容易忽略什么？`
        : '先看一个关键细节，再决定要不要继续了解。',
    caption: input.index === 0 ? '3 秒看懂怎么选'
      : input.index === 1 ? '你可能忽略了这一点'
        : '先看这个关键细节',
    sourceStrategy: input.strategy,
    truthBoundary,
    referencePoints: input.firstShot.fidelityPoints.slice(0, 3),
    mustDifferPoints: [...REQUIRED_DIFFERENCES],
    detailedAnalysis: {
      firstFrameComposition: input.firstShot.shotLanguage?.composition
        || input.firstShot.tags.cameraLanguage.join('、') || '首帧主体与字幕安全区关系',
      primarySubject: input.firstShot.tags.subjects.join('、') || input.firstShot.visualDescription,
      subjectScaleAndPosition: `${input.firstShot.shotLanguage?.shotSize || '明确景别'}；${input.firstShot.shotLanguage?.cameraAngle || '主体位置可辨识'}`,
      actionStartAndPeak: input.firstShot.action
        ? `${input.firstShot.action.startState} → ${input.firstShot.action.path} → ${input.firstShot.action.endState}`
        : input.firstShot.visualDescription,
      cameraMovement: input.firstShot.shotLanguage?.movement || input.firstShot.tags.cameraLanguage.join('、') || '无可验证运镜记录',
      captionTrigger: input.firstShot.captionText || input.firstShot.tags.onScreenInformation.join('、') || '无首屏字幕触发',
      audioTrigger: input.firstShot.audioDescription || input.firstShot.tags.soundTypes.join('、') || '无明确声音触发',
      informationDensity: input.firstShot.tags.onScreenInformation.length + input.firstShot.tags.subjects.length >= 3 ? '高' : '中',
      swipeRisk: input.firstShot.startSeconds > 0.15 ? '主体出现偏晚' : '需确保第一帧主体可辨识且首秒动作有进展',
      minimumMaterialMatchScore: 0.78,
    },
    capabilitySignature: signature,
    productionAdmission: currentStackAdmission(signature),
    status: input.role === 'primary' ? 'recommended' : 'draft',
  };
}

function materialPlanForShot(shot: SocialReferenceShotAnalysis): SocialReplicationScriptShot['materialPlan'] {
  const truthBoundary = truthBoundaryFor({ purpose: shot.purpose, subject: shot.visualDescription });
  const sourceStrategy = productionStrategyFor(truthBoundary, shot.purpose, shot.visualContract);
  const usesDigitalHuman = sourceStrategy === 'authorized_digital_presenter';
  const usesProductAigc = sourceStrategy === 'aigc_product_scene_replication';
  return {
    shotId: shot.shotId,
    function: shot.purpose,
    requestedDescription: shot.visualDescription,
    sourceStrategy,
    sourceRefs: [],
    fallbackSourceStrategy: usesDigitalHuman || usesProductAigc ? null : 'motion_graphics',
    productionInstruction: usesDigitalHuman
      ? '按冻结口播与详细动作契约调用数字人；人物原素材只作画面参考，原声静音。'
      : usesProductAigc
        ? '锁定企业中心产品身份与参考画面的场景、构图、动作和运镜，再调用产品 IAIGC；不得把产品图简单叠到底图。'
        : `按口播逐字逐句在已入库素材中匹配精确片段，工厂、客户案例和企业通用素材可直接剪辑；${shot.rhythmDescription}只约束裁切与节奏。`,
    truthBoundary,
    functionalEquivalentReplacement: {
      required: false,
      preservesFunction: shot.purpose,
      replacesSubject: null,
      description: null,
      reason: null,
    },
    feasibility: 'functional_equivalent',
    feasibilityReason: usesDigitalHuman
      ? '人物出镜或人物使用产品由数字人承接，无需用户补充内容制作信息'
      : usesProductAigc
        ? '纯产品展示由产品身份锁定 IAIGC 承接，并按前三秒精细视觉契约执行'
        : '内容 Agent 按冻结口播优先选用已入库的可用素材片段，产品未指定时可使用企业通用素材',
    customerShootRequired: false,
  };
}

export function buildSocialTaskReferencePackage(input: {
  record: Record<string, unknown>;
  source: Pick<SocialTaskSource, 'sourceId' | 'sourceRef' | 'sourceVersion' | 'createdAt'>;
  themeId: SocialContentThemeId;
  verifiedContext: VerifiedSocialScriptContext;
  /** Target tenant identities. Product falls back to verified enterprise
   * knowledge; company and brand are replaced only when explicitly supplied. */
  identityReplacements?: {
    companyName?: string | null;
    brandName?: string | null;
    productName?: string | null;
  };
}): ResolvedSocialTaskReference | null {
  const exact = exactAnalysis(input.record);
  if (!exact || synthetic(input.record, exact.analysis)) return null;
  const recordIds = recordReferenceIdentities(input.record);
  if (![...sourceReferenceIdentities(input.source)].some(identity => recordIds.has(identity))) return null;
  const nodes = safeReferenceNodes(input.themeId, exact.details);
  const recordId = socialText(input.record.id);
  if (!recordId || nodes.length < 2) return null;
  const analysisId = `reference-analysis-${socialRequestHash({
    sourceId: input.source.sourceId,
    sourceRef: normalizedReferenceIdentity(input.source.sourceRef),
    recordId,
    analysis: input.record.aiAnalysis,
  }).slice(0, 20)}`;
  const referenceLines = referenceNarrationLines(exact.details);
  const referenceCaptions = referenceCaptionLines(exact.details);
  const replacements = identityPlan({
    record: input.record,
    exact,
    referenceLines,
    verifiedContext: input.verifiedContext,
    replacements: input.identityReplacements,
  });
  const shots = exact.details.slice(0, 12).map((row, index) => publicShot({
    row,
    index,
    themeId: input.themeId,
    spokenText: referenceLines[index],
    captionText: referenceCaptions[index],
    productRef: input.identityReplacements?.productName || input.verifiedContext.productName,
  }));
  const narrationStyle = deriveNarrationStyleProfile(exact.details.map(row => row.detail));
  const hookVoiceover = replaceIdentityOnly(referenceLines[0] ?? '', replacements);
  const hookCaption = replaceIdentityOnly(referenceCaptions[0] ?? '', replacements);
  const primaryHook = {
    ...hookOption({
    analysisId,
    role: 'primary',
    index: 0,
    firstShot: shots[0]!,
    strategy: productionStrategyFor(
      truthBoundaryFor({ purpose: 'hook', subject: shots[0]!.visualDescription }),
      'hook',
      shots[0]!.visualContract,
    ),
    productLabel: input.verifiedContext.productName || '这类产品',
    narrationStyle,
    }),
    spokenLine: hookVoiceover.text || null,
    caption: hookCaption.text || null,
  } satisfies SocialThreeSecondHook;
  const hookOptions: SocialThreeSecondHook[] = [
    primaryHook,
    {
      ...hookOption({ analysisId, role: 'alternative', index: 1, firstShot: shots[0]!, strategy: 'authorized_digital_presenter', productLabel: input.verifiedContext.productName || '这类产品' }),
      spokenLine: hookVoiceover.text || null,
      caption: hookCaption.text || null,
    },
    {
      ...hookOption({ analysisId, role: 'alternative', index: 2, firstShot: shots[0]!, strategy: 'motion_graphics', productLabel: input.verifiedContext.productName || '这类产品' }),
      spokenLine: hookVoiceover.text || null,
      caption: hookCaption.text || null,
    },
  ];
  const createdAt = socialText(input.record.updatedAt)
    || socialText(input.record.updated)
    || socialText(input.record.crawledAt)
    || input.source.createdAt;
  const coverage = referenceCoverage({ record: input.record, exact, shots });
  const referenceVideoAnalysis: SocialReferenceVideoAnalysis = {
    analysisId,
    version: socialRequestHash({ recordId, analysis: input.record.aiAnalysis }).slice(0, 12),
    referenceSourceId: input.source.sourceId,
    referenceRecordId: recordId,
    status: 'ready',
    durationSeconds: coverage.fullDurationSeconds,
    analysisLayers: [
      { level: 'L0', status: 'complete', scope: '来源、标题、平台元数据与整片时长', confidence: 1 },
      { level: 'L1', status: 'complete', scope: 'ASR、OCR、抽帧、镜头切分、主体与场景粗标签', confidence: coverage.overallConfidence },
      { level: 'L2', status: coverage.fullDurationSeconds === null ? 'partial' : 'complete', scope: '钩子、信息顺序、证据位置、节奏、情绪与 CTA 粗结构', confidence: coverage.overallConfidence },
      { level: 'L3', status: coverage.fullTimelineCovered ? 'complete' : 'partial', scope: '连续时间线、动作起止、空间连续性、镜头语言与音频层', confidence: coverage.overallConfidence },
      { level: 'L4', status: 'pending', scope: '等待误识别修正、权利风险与实际制作结果回流', confidence: null },
    ],
    coverage,
    shots,
    hookAnalysis: primaryHook,
    rightsNotice: '已入库的工厂、客户案例和企业通用素材可直接用于匹配与剪辑。口播按参考逐字逐句冻结，仅替换企业名、品牌名或产品名，不改写事实、句序、停顿与时长；画面、配乐、音效和字幕动效重新制作。',
    createdAt,
  };
  const scriptShots: SocialReplicationScriptShot[] = shots.map((shot, index) => {
    const referenceSpokenText = referenceLines[index] ?? '';
    const adjustedVoiceover = replaceIdentityOnly(referenceSpokenText, replacements);
    const adjustedCaption = replaceIdentityOnly(referenceCaptions[index] ?? '', replacements);
    return {
    shotId: `replication-${shot.shotId}`,
    referenceShotId: shot.shotId,
    startSeconds: shot.startSeconds,
    endSeconds: shot.endSeconds,
    purpose: shot.purpose,
    visualInstruction: `按${shot.visualDescription}的镜头功能制作全新内容。`,
    referenceSpokenText: referenceSpokenText || null,
    spokenText: adjustedVoiceover.text || null,
    voiceoverReplacement: {
      mode: 'identity_only',
      replacedEntityTypes: adjustedVoiceover.replacedEntityTypes,
    },
    captionText: adjustedCaption.text || null,
    audioAndTransition: shot.audioDescription,
    fidelityPoints: [...shot.fidelityPoints],
    mustDifferPoints: [...shot.mustDifferPoints],
    materialPlan: materialPlanForShot(shot),
    lockedRegions: ['客户产品外观、包装、Logo 和文字不得被生成式修改', '客户真实人物身份和工厂事实不得被虚构替换'],
    risks: shot.tags.truthRequirements.some(item => item !== 'none')
      ? ['缺少客户真实证据时必须使用功能等价替代镜头']
      : [],
    };
  });
  const replicationScript: SocialReplicationScriptVersion = {
    version: String(Math.max(1, Date.parse(createdAt) || 1)),
    referenceAnalysisId: analysisId,
    status: 'review_required',
    primaryHookId: primaryHook.hookId,
    hookOptions,
    shots: scriptShots,
    structureFidelitySummary: '口播逐字逐句冻结，仅替换企业名、品牌名或产品名；同时保留句序、停顿、时长、前三秒机制、镜头功能与节奏关系。',
    originalityDifferenceSummary: '不做事实改写；画面按当前技术栈重制，音乐、音效、字幕动效和视觉包装使用全新版本。',
    createdAt,
  };
  return {
    match: {
      recordId,
      title: '当前任务指定参考视频分析',
      confidence: 0.98,
      nodes,
      referenceSource: {
        sourceId: input.source.sourceId,
        sourceRef: input.source.sourceRef,
        sourceVersion: input.source.sourceVersion,
      },
    },
    referenceVideoAnalysis,
    replicationScript,
    shotMaterialMap: scriptShots.map(shot => ({
      shotId: shot.shotId,
      customerAssetIds: [],
      generatedAssetIds: [],
      licensedAssetIds: [],
      sourceStrategy: shot.materialPlan.sourceStrategy,
      truthBoundary: shot.materialPlan.truthBoundary,
      functionalEquivalentReplacement: shot.materialPlan.functionalEquivalentReplacement,
    })),
  };
}

export function matchSocialInspirationScript(input: {
  records: Record<string, unknown>[];
  themeId: SocialContentThemeId;
  verifiedContext: VerifiedSocialScriptContext;
}): SocialInspirationScriptMatch | null {
  const themeTerms = THEME_TERMS[input.themeId];
  const productTerms = [input.verifiedContext.productName, ...input.verifiedContext.facts.map(item => item.value)]
    .map(socialText).filter(value => value.length >= 2);
  const candidates = input.records.flatMap(record => {
    const exact = exactAnalysis(record);
    if (!exact || synthetic(record, exact.analysis)) return [];
    const searchable = [
      record.title,
      ...listText(record.tags),
      exact.gemini.theme,
      exact.gemini.structure,
      ...listText(exact.gemini.sellingPoints),
      ...exact.details.flatMap(({ detail }) => [detail.purpose, detail.visual, detail.observedFacts]),
    ].map(socialText).join(' ').toLocaleLowerCase();
    const themeHits = themeTerms.filter(term => searchable.includes(term.toLocaleLowerCase())).length;
    if (!themeHits) return [];
    const productHits = productTerms.filter(term => searchable.includes(term.toLocaleLowerCase())).length;
    const timelineConfidence = exact.details
      .map(({ detail }) => Number(detail.confidence))
      .filter(Number.isFinite)
      .reduce((sum, value, _index, values) => sum + value / values.length, 0);
    const confidence = Math.max(0, Math.min(0.96,
      0.5 + Math.min(0.24, themeHits * 0.04) + Math.min(0.12, productHits * 0.04) + Math.min(0.1, timelineConfidence * 0.1)));
    return [{
      match: {
        recordId: socialText(record.id),
        title: '已分析灵感结构',
        confidence,
        nodes: safeReferenceNodes(input.themeId, exact.details),
      },
      updatedAt: Date.parse(socialText(record.updated) || socialText(record.crawledAt) || '') || 0,
    }];
  }).filter(item => item.match.recordId && item.match.confidence >= 0.58)
    .sort((left, right) => right.match.confidence - left.match.confidence || right.updatedAt - left.updatedAt);
  return candidates[0]?.match ?? null;
}

export {
  parseStoredSocialReferenceVideoAnalysis,
  parseStoredSocialReplicationScript,
  parseStoredSocialShotMaterialMap,
  resolveSocialInspirationScript,
  resolveSocialRecommendedReferenceScript,
  resolveSocialTaskReferenceScript,
} from './socialContentScriptResolvers.js';
/** Read-only projection: expose actionable codes, never provider logs or local paths. */
export async function readReferencePreparation(tenantId: string, sources: SocialTaskSource[]) {
  const source = sources.find(item => item.status === 'active' && item.kind === 'reference_link');
  if (!source) return { status: 'blocked' as const, reason: 'reference_missing' };
  const tenants = [...new Set([tenantId, socialText(process.env.SOCIAL_SHARED_INSPIRATION_TENANT_ID) || 'demo-shared-video-pool'])];
  for (const owner of tenants) {
    const result = await store.list<Record<string, unknown>>('trend_videos', { where: { tenantId: owner, sourceUrl: source.sourceRef }, page: 1, perPage: 1 });
    const row = result.items[0];
    const analysis = socialObject(socialJson(row?.aiAnalysis));
    const error = socialText(analysis?.analysisError);
    if (error) return { status: 'blocked' as const, reason: /Monthly usage hard limit|quota|额度/i.test(error) ? 'reference_provider_quota' : 'reference_download_failed' };
  }
  return { status: 'pending' as const, reason: null };
}
