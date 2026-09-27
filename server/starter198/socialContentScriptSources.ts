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
      : '参考链接正在进行逐镜分析。提交链接仅代表允许系统分析结构，不代表版权已经确认；系统不会复制原视频文件、原文案、人物身份、品牌标识、水印或原声音频。',
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
      // The reference contributes only a de-identified shot grammar. Original
      // dialogue, OCR, brands, people and claims never enter these templates.
      narrationTemplate: {
        zh: index === 0
          ? '通过客户上传的真实画面，看看{{product}}。'
          : index === nodes.length - 1
            ? '只呈现真实画面和已确认资料。{{callToAction}}'
            : '以下内容只说明素材中真实可见的画面。',
        en: index === 0
          ? 'See {{product}} through real customer-supplied footage.'
          : index === nodes.length - 1
            ? 'Only real footage and verified information are presented. {{callToAction}}'
            : 'This section stays within what is visibly supported by the supplied footage.',
      },
    };
  });
}

function normalizedReferenceIdentity(value: unknown): string {
  return socialText(value).trim().replace(/\/$/, '').toLocaleLowerCase();
}

function recordReferenceIdentities(record: Record<string, unknown>): Set<string> {
  return new Set([
    record.id,
    record.sourceUrl,
    record.url,
    record.originalUrl,
    record.shareUrl,
    record.videoUrl,
  ].map(normalizedReferenceIdentity).filter(Boolean));
}

function sourceReferenceIdentities(source: Pick<SocialTaskSource, 'sourceRef'>): Set<string> {
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
  const effect = input.purpose === 'proof' && /结果|效果|对比/.test(input.subject);
  const subject = factory ? 'customer_factory' as const : effect ? 'product_effect' as const : 'none' as const;
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

function productionStrategyFor(boundary: SocialShotTruthBoundary, purpose: SocialShotFunction): SocialShotSourceStrategy {
  if (boundary.customerEvidenceRequired) return 'verified_fact_card';
  if (purpose === 'hook' || purpose === 'call_to_action') return 'authorized_digital_presenter';
  return 'non_evidentiary_ai_visual';
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
  '重写全部口播与字幕，不复制原视频文案',
  '替换原视频人物、品牌、账号标识和水印',
  '使用客户自有、已授权或明确标记为非证据的全新画面',
  '更换音乐、音效、字幕样式和视觉包装',
] as const;

function publicShot(input: {
  row: ExactReferenceDetail;
  index: number;
  themeId: SocialContentThemeId;
}): SocialReferenceShotAnalysis {
  const purpose = shotPurpose(input.row.detail, input.themeId);
  const subject = safeSubject(input.row.detail);
  const structure = safeReferenceStructure(input.row);
  const truth = truthBoundaryFor({ purpose, subject });
  const strategy = productionStrategyFor(truth, purpose);
  const detailText = (fields: string[]) => combinedText(input.row.detail, fields);
  const shotText = detailText(['shot', 'visual']);
  const angleText = detailText(['angle', 'camera']);
  const compositionText = detailText(['composition']);
  const voiceDetected = Boolean(detailText(['dialogue']));
  const captionDetected = Boolean(detailText(['onScreenText', 'subtitle']));
  const ambientDetected = Boolean(detailText(['ambientSound']));
  const musicDetected = Boolean(detailText(['bgm']));
  const effectsDetected = Boolean(detailText(['soundEffects']));
  return {
    shotId: `reference-shot-${input.index + 1}`,
    startSeconds: structure.sourceTiming.startSeconds,
    endSeconds: structure.sourceTiming.endSeconds,
    visualDescription: `${subject}；${structure.shotScale}，${structure.cameraMovement}`,
    spokenText: null,
    captionText: null,
    audioDescription: '保留声画配合与节奏功能，重新制作配音、配乐和音效。',
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
      voice: voiceDetected ? '检测到人声层；原话不进入复刻脚本' : null,
      captions: captionDetected ? '检测到字幕或平台文字叠加层；按后期图层处理' : null,
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
    tags: {
      sceneTypes: [/生产现场/.test(subject) ? '工厂实拍结构' : purpose === 'demonstration' ? '使用演示结构' : '产品内容结构'],
      subjects: [subject],
      subjectRelations: [purpose === 'demonstration' ? '主体执行动作' : '主体承担镜头信息'],
      cameraLanguage: [structure.shotScale, structure.cameraMovement, structure.transition],
      contentFunctions: [purpose],
      soundTypes: ['重新配音', '重新配乐'],
      onScreenInformation: ['重新编写字幕'],
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
}): SocialThreeSecondHook {
  const truthBoundary = truthBoundaryFor({ purpose: 'hook', subject: input.firstShot.visualDescription });
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
  return {
    hookId: `hook-${socialRequestHash({ analysisId: input.analysisId, index: input.index }).slice(0, 12)}`,
    role: input.role,
    ...option,
    spokenLine: input.index === 0 ? `先别划走，三秒看懂${input.productLabel}该怎么看。`
      : input.index === 1 ? `你选${input.productLabel}时，最容易忽略什么？`
        : '先看一个关键细节，再决定要不要继续了解。',
    caption: input.index === 0 ? '3 秒看懂怎么选'
      : input.index === 1 ? '你可能忽略了这一点'
        : '先看这个关键细节',
    sourceStrategy: input.strategy,
    truthBoundary,
    referencePoints: input.firstShot.fidelityPoints.slice(0, 3),
    mustDifferPoints: [...REQUIRED_DIFFERENCES],
    status: input.role === 'primary' ? 'recommended' : 'draft',
  };
}

function safeScriptCopy(input: {
  shot: SocialReferenceShotAnalysis;
  index: number;
  verifiedContext: VerifiedSocialScriptContext;
}): { spokenText: string; captionText: string } {
  const product = input.verifiedContext.productName || '这类产品';
  const fact = input.verifiedContext.facts[input.index % Math.max(1, input.verifiedContext.facts.length)];
  if (input.shot.purpose === 'hook') {
    return { spokenText: `先别划走，三秒看懂${product}该怎么看。`, captionText: `3 秒看懂${product}` };
  }
  if (fact) {
    return {
      spokenText: `已确认资料显示，${product}的${fact.label}为${fact.value}。`,
      captionText: `${fact.label}：${fact.value}`,
    };
  }
  const educational: Record<SocialShotFunction, { spokenText: string; captionText: string }> = {
    hook: { spokenText: `三秒看懂${product}。`, captionText: `先看关键点` },
    problem: { spokenText: '选购时先看真实使用场景，不要只看宣传词。', captionText: '先看真实场景' },
    value: { spokenText: '这一镜只观察画面中能够确认的产品细节。', captionText: '只看可见细节' },
    demonstration: { spokenText: '把操作过程拆开看，关键动作会更清楚。', captionText: '按步骤看操作' },
    proof: { spokenText: '涉及效果和能力的结论，需要以真实检测或授权资料为准。', captionText: '证明材料需可核验' },
    trust: { spokenText: '判断是否可靠，要看流程和证据能不能对应得上。', captionText: '流程与证据要对应' },
    transition: { spokenText: '接着看下一个决定使用体验的细节。', captionText: '继续看关键细节' },
    call_to_action: { spokenText: '需要进一步判断，可以查看正式资料再做决定。', captionText: '查看正式资料' },
  };
  return educational[input.shot.purpose];
}

function materialPlanForShot(shot: SocialReferenceShotAnalysis): SocialReplicationScriptShot['materialPlan'] {
  const truthBoundary = truthBoundaryFor({ purpose: shot.purpose, subject: shot.visualDescription });
  const sourceStrategy = productionStrategyFor(truthBoundary, shot.purpose);
  const replacementRequired = truthBoundary.customerEvidenceRequired;
  return {
    shotId: shot.shotId,
    function: shot.purpose,
    requestedDescription: shot.visualDescription,
    sourceStrategy,
    sourceRefs: [],
    fallbackSourceStrategy: sourceStrategy === 'verified_fact_card' ? 'motion_graphics' : 'licensed_stock_asset',
    productionInstruction: replacementRequired
      ? '没有客户真实证据时，改成非证据型流程说明或已确认事实卡，不生成虚假的客户现场、案例或效果。'
      : `按${shot.rhythmDescription}制作全新画面，保留镜头功能但不复用原片素材。`,
    truthBoundary,
    functionalEquivalentReplacement: {
      required: replacementRequired,
      preservesFunction: shot.purpose,
      replacesSubject: replacementRequired ? truthBoundary.subject : null,
      description: replacementRequired ? '用流程动画或已确认事实卡承担同一信息功能。' : null,
      reason: replacementRequired ? '当前没有可作为客户真实证据的已授权素材。' : null,
    },
    feasibility: replacementRequired ? 'goal_degraded' : 'functional_equivalent',
    feasibilityReason: replacementRequired
      ? '当前缺少承担真实证明作用的客户素材，必须由内容 Agent 重新评估事实强度'
      : '可用全新画面保持参考镜头的叙事功能，不复用原片素材',
    customerShootRequired: false,
  };
}

export function buildSocialTaskReferencePackage(input: {
  record: Record<string, unknown>;
  source: Pick<SocialTaskSource, 'sourceId' | 'sourceRef' | 'sourceVersion' | 'createdAt'>;
  themeId: SocialContentThemeId;
  verifiedContext: VerifiedSocialScriptContext;
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
  const shots = exact.details.slice(0, 12).map((row, index) => publicShot({ row, index, themeId: input.themeId }));
  const primaryHook = hookOption({
    analysisId,
    role: 'primary',
    index: 0,
    firstShot: shots[0]!,
    strategy: productionStrategyFor(truthBoundaryFor({ purpose: 'hook', subject: shots[0]!.visualDescription }), 'hook'),
    productLabel: input.verifiedContext.productName || '这类产品',
  });
  const hookOptions: SocialThreeSecondHook[] = [
    primaryHook,
    hookOption({ analysisId, role: 'alternative', index: 1, firstShot: shots[0]!, strategy: 'authorized_digital_presenter', productLabel: input.verifiedContext.productName || '这类产品' }),
    hookOption({ analysisId, role: 'alternative', index: 2, firstShot: shots[0]!, strategy: 'motion_graphics', productLabel: input.verifiedContext.productName || '这类产品' }),
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
    rightsNotice: '参考链接仅用于分析镜头功能、顺序和节奏，不代表版权已经确认；系统不会复制原视频文件、原文案、人物身份、品牌标识、水印或原声音频。',
    createdAt,
  };
  const scriptShots: SocialReplicationScriptShot[] = shots.map((shot, index) => {
    const copy = safeScriptCopy({ shot, index, verifiedContext: input.verifiedContext });
    return {
    shotId: `replication-${shot.shotId}`,
    referenceShotId: shot.shotId,
    startSeconds: shot.startSeconds,
    endSeconds: shot.endSeconds,
    purpose: shot.purpose,
    visualInstruction: `按${shot.visualDescription}的镜头功能制作全新内容。`,
    spokenText: shot.purpose === 'hook' ? primaryHook.spokenLine : copy.spokenText,
    captionText: shot.purpose === 'hook' ? primaryHook.caption : copy.captionText,
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
    structureFidelitySummary: '保留参考视频的前三秒机制、镜头功能顺序、时长分配、景别、运镜、节奏和转场关系。',
    originalityDifferenceSummary: '全部文案、人物、品牌、画面素材、声音和视觉包装重新制作；真实证明类镜头缺素材时使用功能等价替代。',
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

export async function resolveSocialInspirationScript(input: {
  tenantId: string;
  themeId: SocialContentThemeId;
  verifiedContext: VerifiedSocialScriptContext;
}): Promise<SocialInspirationScriptMatch | null> {
  try {
    const sharedTenantId = socialText(process.env.SOCIAL_SHARED_INSPIRATION_TENANT_ID)
      || 'demo-shared-video-pool';
    const tenantIds = [...new Set([input.tenantId, sharedTenantId].filter(Boolean))];
    const results = await Promise.allSettled(tenantIds.map(tenantId => store.list<Record<string, unknown>>('trend_videos', {
      where: { tenantId },
      sort: '-crawledAt',
      page: 1,
      perPage: 300,
    })));
    const records = [...new Map(results.flatMap(result => result.status === 'fulfilled' ? result.value.items : [])
      .map(record => [socialText(record.id), record] as const)
      .filter(([id]) => Boolean(id))).values()];
    return matchSocialInspirationScript({ ...input, records });
  } catch {
    // The inspiration catalog is an optional enhancement. A catalog outage
    // must not turn into copying task text; callers continue with a formula or
    // the verified-knowledge fallback and record the lower confidence.
    return null;
  }
}

/** Resolve only an exact active reference selected on the current task. It
 * never falls back to a same-theme catalog item, so a recommendation cannot be
 * mistaken for a customer-confirmed reference. */
export async function resolveSocialTaskReferenceScript(input: {
  tenantId: string;
  themeId: SocialContentThemeId;
  verifiedContext: VerifiedSocialScriptContext;
  referenceSources: Array<Pick<SocialTaskSource, 'sourceId' | 'sourceRef' | 'sourceVersion' | 'createdAt'>>;
}): Promise<ResolvedSocialTaskReference | null> {
  if (!input.referenceSources.length) return null;
  try {
    const sharedTenantId = socialText(process.env.SOCIAL_SHARED_INSPIRATION_TENANT_ID)
      || 'demo-shared-video-pool';
    const tenantIds = [...new Set([input.tenantId, sharedTenantId].filter(Boolean))];
    const results = await Promise.allSettled(tenantIds.map(tenantId => store.list<Record<string, unknown>>('trend_videos', {
      where: { tenantId },
      sort: '-crawledAt',
      page: 1,
      perPage: 500,
    })));
    const records = [...new Map(results.flatMap(result => result.status === 'fulfilled' ? result.value.items : [])
      .map(record => [socialText(record.id), record] as const)
      .filter(([id]) => Boolean(id))).values()];
    // The latest active task reference wins when more than one is attached.
    const sources = [...input.referenceSources].sort((left, right) => (
      Date.parse(right.createdAt) - Date.parse(left.createdAt)
      || right.sourceId.localeCompare(left.sourceId)
    ));
    for (const source of sources) {
      for (const record of records) {
        const resolved = buildSocialTaskReferencePackage({
          record,
          source,
          themeId: input.themeId,
          verifiedContext: input.verifiedContext,
        });
        if (resolved) return resolved;
      }
    }
    const trackedButNotExact = sources.flatMap(source => {
      const identities = sourceReferenceIdentities(source);
      return records.filter(record => [...identities].some(identity => recordReferenceIdentities(record).has(identity)));
    })[0];
    if (trackedButNotExact) {
      void import('../routes/videos.js').then(module => module.queueExactSourceAnalysisForTenant({
        // Inspiration-center records may come from the shared catalog. Queue
        // the one-time Director analysis against the record's owning tenant;
        // subsequent customer tasks reuse the persisted exact script.
        tenantId: socialText(trackedButNotExact.tenantId) || input.tenantId,
        recordId: socialText(trackedButNotExact.id),
      })).catch(() => undefined);
    }
    const untracked = sources.find(source => {
      const identities = sourceReferenceIdentities(source);
      return !records.some(record => [...identities].some(identity => recordReferenceIdentities(record).has(identity)));
    });
    if (untracked && /^https?:\/\//i.test(untracked.sourceRef)) {
      // Do not block the beginner workflow on network collection. The task
      // keeps an explicit `analyzing` projection while the existing crawler
      // imports this exact URL and queues full-video analysis.
      void import('../routes/videos.js').then(async module => {
        const crawled = await module.crawlVideosForTenant({
          tenantId: input.tenantId,
          platform: module.inferPlatformFromUrl(untracked.sourceRef),
          keyword: untracked.sourceRef,
          limit: 1,
          disableBackfill: true,
          deferAnalysis: false,
        });
        const exactRecord = (crawled.items as Record<string, unknown>[]).find(item => (
          normalizedReferenceIdentity(item.sourceUrl) === normalizedReferenceIdentity(untracked.sourceRef)
        ));
        if (exactRecord?.id) {
          await module.queueExactSourceAnalysisForTenant({
            tenantId: input.tenantId,
            recordId: socialText(exactRecord.id),
          });
        }
      }).catch(() => undefined);
    }
    return null;
  } catch {
    return null;
  }
}

/** System-selected exact reference. This produces the same full public
 * analysis package, but deliberately omits `match.referenceSource` so it can
 * never be presented as a customer-confirmed choice. */
export async function resolveSocialRecommendedReferenceScript(input: {
  tenantId: string;
  themeId: SocialContentThemeId;
  verifiedContext: VerifiedSocialScriptContext;
  createdAt: string;
}): Promise<ResolvedSocialTaskReference | null> {
  try {
    const sharedTenantId = socialText(process.env.SOCIAL_SHARED_INSPIRATION_TENANT_ID)
      || 'demo-shared-video-pool';
    const tenantIds = [...new Set([input.tenantId, sharedTenantId].filter(Boolean))];
    const results = await Promise.allSettled(tenantIds.map(tenantId => store.list<Record<string, unknown>>('trend_videos', {
      where: { tenantId }, sort: '-crawledAt', page: 1, perPage: 300,
    })));
    const records = [...new Map(results.flatMap(result => result.status === 'fulfilled' ? result.value.items : [])
      .map(record => [socialText(record.id), record] as const)
      .filter(([id]) => Boolean(id))).values()];
    const match = matchSocialInspirationScript({ records, themeId: input.themeId, verifiedContext: input.verifiedContext });
    if (!match) return null;
    const record = records.find(item => socialText(item.id) === match.recordId);
    if (!record) return null;
    const sourceRef = socialText(record.sourceUrl) || socialText(record.url) || match.recordId;
    const resolved = buildSocialTaskReferencePackage({
      record,
      source: {
        sourceId: `system-reference:${match.recordId}`,
        sourceRef,
        sourceVersion: null,
        createdAt: input.createdAt,
      },
      themeId: input.themeId,
      verifiedContext: input.verifiedContext,
    });
    if (!resolved) return null;
    return {
      ...resolved,
      match: { ...resolved.match, title: '系统推荐参考视频分析', referenceSource: null },
      referenceVideoAnalysis: {
        ...resolved.referenceVideoAnalysis,
        rightsNotice: '这是系统推荐的结构参考，尚未被用户确认为指定参考，也不代表版权已经确认；系统只复刻镜头功能与节奏，不复制原视频文件、原文案、人物身份、品牌标识、水印或原声音频。',
      },
      replicationScript: {
        ...resolved.replicationScript,
        status: 'review_required',
      },
    };
  } catch {
    return null;
  }
}

export function parseStoredSocialReferenceVideoAnalysis(value: unknown): SocialReferenceVideoAnalysis | null {
  const raw = socialJson(value);
  if (raw === undefined || raw === null || raw === '') return null;
  const row = socialObject(raw);
  const status = socialText(row?.status);
  const shots = socialJson(row?.shots);
  const hook = row?.hookAnalysis === null ? null : socialObject(row?.hookAnalysis);
  if (!row || !socialText(row.analysisId) || !socialText(row.referenceSourceId)
    || !['analyzing', 'ready', 'blocked'].includes(status)
    || !Array.isArray(shots) || !socialText(row.rightsNotice) || !socialText(row.createdAt)
    || (status === 'ready' && (!shots.length || !hook))) {
    throw new SocialContentWorkflowError('social_reference_video_analysis_record_invalid', 503);
  }
  return structuredClone(row) as unknown as SocialReferenceVideoAnalysis;
}

export function parseStoredSocialReplicationScript(value: unknown): SocialReplicationScriptVersion | null {
  const raw = socialJson(value);
  if (raw === undefined || raw === null || raw === '') return null;
  const row = socialObject(raw);
  const hooks = socialJson(row?.hookOptions);
  const shots = socialJson(row?.shots);
  if (!row || !/^\d+$/.test(socialText(row.version)) || !socialText(row.referenceAnalysisId)
    || !['draft', 'review_required', 'confirmed', 'superseded'].includes(socialText(row.status))
    || !socialText(row.primaryHookId) || !Array.isArray(hooks) || hooks.length < 3
    || !Array.isArray(shots) || !shots.length || !socialText(row.structureFidelitySummary)
    || !socialText(row.originalityDifferenceSummary) || !socialText(row.createdAt)) {
    throw new SocialContentWorkflowError('social_replication_script_record_invalid', 503);
  }
  return structuredClone(row) as unknown as SocialReplicationScriptVersion;
}

export function parseStoredSocialShotMaterialMap(value: unknown): SocialShotMaterialMapEntry[] {
  const raw = socialJson(value);
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) throw new SocialContentWorkflowError('social_shot_material_map_record_invalid', 503);
  return structuredClone(raw) as SocialShotMaterialMapEntry[];
}

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
