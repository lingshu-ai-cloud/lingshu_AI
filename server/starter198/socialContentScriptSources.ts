import type { SocialContentThemeId } from '../../shared/contracts/socialContentWorkflow.js';
import { store } from '../storage/index.js';
import type { SocialInspirationScriptMatch, VerifiedSocialScriptContext } from './socialContentScriptBaseline.js';
import { socialJson, socialObject, socialText } from './socialContentValidation.js';

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
