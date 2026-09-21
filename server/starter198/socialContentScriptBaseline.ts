import type {
  SocialContentTaskBrief,
  SocialContentThemeId,
  SocialContentThemeSelection,
  SocialScriptBaselineSummary,
} from '../../shared/contracts/socialContentWorkflow.js';
import type { EnterpriseProfile } from '../routes/enterprise.js';
import type { InternalSocialContentFormula } from './socialContentThemes.js';
import { SocialContentWorkflowError, socialJson, socialObject, socialText } from './socialContentValidation.js';

export const SOCIAL_SCRIPT_BASELINE_SCHEMA = 'social-content-script-baseline.v1';
export const SOCIAL_SCRIPT_GROUNDING_VERSION = 'social-script-grounding.v3';

export interface VerifiedSocialScriptContext {
  productName: string | null;
  facts: Array<{ key: string; label: string; value: string }>;
  source: 'enterprise_product' | 'enterprise_profile' | 'none';
  confidence: number;
}

type SocialScriptGroundingSource = VerifiedSocialScriptContext['source'] | 'user_product_association';

export interface SocialInspirationScriptMatch {
  recordId: string;
  title: string;
  confidence: number;
  nodes: Array<{
    nodeId: string;
    shotFunction: string;
    subject: string;
    action: string;
    narrationTemplate: { zh: string; en: string };
    /**
     * Only structural information survives reference-video ingestion. The
     * original brand, people, dialogue and on-screen copy are deliberately not
     * represented here, so a reference can guide editing without being copied.
     */
    referenceStructure: {
      sourceTiming: { startSeconds: number; endSeconds: number; durationSeconds: number };
      shotScale: '极近特写' | '近景特写' | '中景' | '全景' | '通用景别';
      cameraMovement: '固定镜头' | '推进镜头' | '拉远镜头' | '横向摇移' | '跟随镜头' | '手持镜头' | '通用运镜';
      pace: '快速' | '紧凑' | '舒缓';
      transition: '快速切换' | '柔和过渡' | '动作衔接' | '自然衔接';
    };
  }>;
}

export interface StoredSocialScriptBaseline {
  schemaVersion: typeof SOCIAL_SCRIPT_BASELINE_SCHEMA;
  version: string;
  source: 'formula' | 'inspiration_script' | 'knowledge_fallback' | 'system_theme_baseline';
  formulaReference: { formulaId: string; version: string } | null;
  themeId: SocialContentThemeId | null;
  language: 'zh' | 'en';
  lockedAt: string;
  createdBeforeMaterialAdaptation: true;
  groundingVersion?: typeof SOCIAL_SCRIPT_GROUNDING_VERSION;
  match?: {
    strategy: 'formula_inspiration' | 'formula' | 'inspiration' | 'knowledge_fallback' | 'legacy';
    confidence: number;
    inspirationReference: { recordId: string; confidence: number } | null;
    verifiedKnowledgeSource: SocialScriptGroundingSource;
    verifiedFactKeys: string[];
    userTextUsage: 'intent_only';
    /** Exact tenant-authored material linkage. This is independent of both
     * enterprise knowledge and visual analysis confidence. */
    userProductAssociation?: {
      basis: 'tenant_task_upload';
      confidence: number;
    } | null;
  };
  scenes: Array<{
    sceneId: string;
    formulaNodeId: string | null;
    inspirationNodeId?: string | null;
    shotFunction: string;
    subject: string;
    action: string;
    /** Director-ready content fields. `narration` remains the compatibility alias for voiceover. */
    script?: string;
    voiceover?: string;
    caption?: string;
    narration: string;
  }>;
}

const DEFAULT_SCENES = [
  { nodeId: 'opening', shotFunction: '关联素材开场', subject: '用户为本次任务关联的素材', action: '按上传顺序呈现' },
  { nodeId: 'product', shotFunction: '产品信息说明', subject: '当前产品的已确认资料', action: '保守呈现' },
  { nodeId: 'material', shotFunction: '关联素材补充', subject: '用户为当前产品关联的其他素材', action: '继续呈现' },
  { nodeId: 'closing', shotFunction: '内容收束', subject: '本次任务素材', action: '完成展示' },
] as const;

const SAFE_THEME_LABELS: Record<SocialContentThemeId, { zh: string; en: string }> = {
  product_value: { zh: '产品实拍', en: 'a real product demonstration' },
  scenario_solution: { zh: '实际使用场景', en: 'a real use scenario' },
  supplier_capability: { zh: '生产与供应现场', en: 'the production and supply process' },
  customization_process: { zh: '定制合作过程', en: 'the customization process' },
  customer_case: { zh: '经授权的合作过程', en: 'an authorized collaboration process' },
};

function compactFactValue(value: unknown, maximum = 72): string {
  return socialText(value).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').slice(0, maximum);
}

/** Resolve only facts already persisted in Enterprise Knowledge. Free-form task
 * text is deliberately never promoted to a product fact. */
export function verifiedSocialScriptContext(
  profile: EnterpriseProfile,
  productRef: string | null,
): VerifiedSocialScriptContext {
  const reference = socialText(productRef).toLocaleLowerCase();
  const products = profile.products.items ?? [];
  const exact = reference
    ? products.find(item => [item.name, item.sku].some(value => socialText(value).toLocaleLowerCase() === reference))
    : undefined;
  const product = exact ?? (!reference && products.length === 1 ? products[0] : undefined);
  if (product) {
    const candidates: Array<[string, string, unknown]> = [
      ['category', '类别', product.category],
      ['material', '材质', product.material],
      ['highlights', '已确认特点', product.highlights],
      ['certifications', '已确认资质', product.certifications],
      ['moq', '起订量', product.moq],
    ];
    return {
      productName: compactFactValue(product.name, 48) || null,
      facts: candidates
        .map(([key, label, value]) => ({ key, label, value: compactFactValue(value) }))
        .filter(item => item.value)
        .slice(0, 3),
      source: 'enterprise_product',
      confidence: exact ? 1 : 0.85,
    };
  }
  const profileFacts: Array<{ key: string; label: string; value: string }> = [
    { key: 'company_industry', label: '所属行业', value: compactFactValue(profile.company.industry) },
    { key: 'product_categories', label: '产品类别', value: compactFactValue(profile.products.categories) },
  ].filter(item => item.value);
  return {
    productName: null,
    facts: profileFacts.slice(0, 2),
    source: profileFacts.length ? 'enterprise_profile' : 'none',
    confidence: profileFacts.length ? 0.65 : 0,
  };
}

function baselineLanguage(value: unknown): 'zh' | 'en' {
  const language = socialText(value).toLowerCase();
  return language === 'en' || /english|英语|英文/.test(language) ? 'en' : 'zh';
}

function nextBaselineVersion(previous: StoredSocialScriptBaseline | null | undefined): string {
  const current = Number(previous?.version);
  return Number.isSafeInteger(current) && current > 0 ? String(current + 1) : '1';
}

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (_match, key: string) => values[key] ?? '');
}

function localizedTemplate(value: unknown, language: 'zh' | 'en'): string {
  return socialText(socialObject(value)?.[language]);
}

function groundedNarration(input: {
  language: 'zh' | 'en';
  index: number;
  count: number;
  product: string;
  topic: string;
  shotFunction: string;
  subject: string;
  verifiedFacts: VerifiedSocialScriptContext['facts'];
}): string {
  const fact = input.verifiedFacts[Math.max(0, Math.min(input.verifiedFacts.length - 1, input.index - 1))];
  if (input.language === 'en') {
    const englishFactLabels: Record<string, string> = {
      category: 'category', material: 'material', highlights: 'verified feature',
      certifications: 'verified certification', moq: 'minimum order quantity',
      company_industry: 'industry', product_categories: 'product category',
    };
    if (input.index === 0) return `This video uses material the user explicitly linked to ${input.product}.`;
    if (input.index === input.count - 1) {
      return input.verifiedFacts.length
        ? `This concludes the verified information and user-linked material for ${input.product}.`
        : `This content is limited to material the user explicitly linked to ${input.product}; it adds no unverified product claims.`;
    }
    if (fact) return `Verified product information lists ${englishFactLabels[fact.key] || 'this detail'} as ${fact.value}.`;
    return `This scene continues with material the user explicitly linked to ${input.product}; no visual fact is inferred.`;
  }
  if (input.index === 0) return `本片使用用户明确关联到${input.product}的素材。`;
  if (input.index === input.count - 1) {
    return input.verifiedFacts.length
      ? `以上为${input.product}的已确认资料与用户关联素材。`
      : `以上内容仅基于用户明确关联到${input.product}的素材，不扩展未经确认的产品事实。`;
  }
  if (fact) return `企业已确认资料显示，${fact.label}为${fact.value}。`;
  return `本段继续使用用户明确关联到${input.product}的素材，不推断画面事实。`;
}

/**
 * Freeze the executable script as soon as the user confirms a theme/formula.
 * Uploaded material is deliberately absent from this function: production may
 * fit shots to this script, but may not silently author a second script.
 */
export function freezeSocialScriptBaseline(input: {
  brief: SocialContentTaskBrief;
  theme: SocialContentThemeSelection | null;
  formula?: InternalSocialContentFormula | null;
  inspiration?: SocialInspirationScriptMatch | null;
  verifiedContext?: VerifiedSocialScriptContext | null;
  userProductAssociation?: {
    basis: 'tenant_task_upload';
    confidence: number;
  } | null;
  lockedAt: string;
  previous?: StoredSocialScriptBaseline | null;
}): StoredSocialScriptBaseline {
  const language = baselineLanguage(input.brief.languages[0]);
  const themeLabels = input.theme?.themeId ? SAFE_THEME_LABELS[input.theme.themeId] : null;
  // `theme.topic`, title and objective are intent inputs. They may contain a
  // whole user prompt, so they never enter narration verbatim.
  const topic = themeLabels?.[language] ?? (language === 'en' ? 'the selected content theme' : '选定内容主题');
  const verified = input.verifiedContext ?? { productName: null, facts: [], source: 'none', confidence: 0 };
  const userProductAssociation = input.userProductAssociation ?? null;
  const product = verified.productName || (language === 'en' ? 'this product' : '本次产品');
  // CTA is an operator-owned instruction. An absent CTA stays absent: the
  // system must not silently convert a neutral video into a sales solicitation.
  const callToAction = compactFactValue(input.brief.callToAction, 96);
  // Built-in theme templates are a safety skeleton, not evidence that an
  // operator has supplied and released a real viral formula. Only a stored,
  // governed formula version may be labelled as a formula match.
  const matchedFormula = input.formula?.recordId ? input.formula : null;
  const sourceNodes = matchedFormula?.nodes?.length
    ? matchedFormula.nodes
    : input.inspiration?.nodes?.length
      ? input.inspiration.nodes
      : input.formula?.nodes?.length
        ? input.formula.nodes
        : DEFAULT_SCENES;
  const source = matchedFormula ? 'formula' : input.inspiration ? 'inspiration_script' : 'knowledge_fallback';
  const formulaReference = matchedFormula
    ? { formulaId: matchedFormula.formulaId, version: matchedFormula.version }
    : null;
  const scenes = sourceNodes.slice(0, 12).map((node, index) => {
    const shotFunction = socialText(node.shotFunction) || '主题表达';
    const subject = socialText(node.subject) || '本次内容';
    const action = socialText(node.action) || '展示';
    const template = 'voiceoverTemplate' in node && node.voiceoverTemplate
      ? localizedTemplate(node.voiceoverTemplate, language)
      : 'narrationTemplate' in node
        ? localizedTemplate(node.narrationTemplate, language)
      : '';
    const interpolationValues = {
          product,
          topic,
          callToAction,
          shotFunction,
          subject,
          action,
        };
    const narration = template && matchedFormula
      ? interpolate(template, interpolationValues).trim()
      : groundedNarration({
          language,
          index,
          count: sourceNodes.length,
          product,
          topic,
          shotFunction,
          subject,
          verifiedFacts: verified.facts,
        });
    const scriptTemplate = matchedFormula && 'scriptTemplate' in node
      ? localizedTemplate(node.scriptTemplate, language)
      : '';
    const captionTemplate = matchedFormula && 'captionTemplate' in node
      ? localizedTemplate(node.captionTemplate, language)
      : '';
    const script = scriptTemplate
      ? interpolate(scriptTemplate, interpolationValues).trim()
      : `${shotFunction}：${subject}，${action}`;
    const caption = captionTemplate
      ? interpolate(captionTemplate, interpolationValues).trim()
      : narration;
    return {
      sceneId: `scene-${index + 1}`,
      formulaNodeId: matchedFormula ? socialText(node.nodeId) || null : null,
      inspirationNodeId: !matchedFormula && input.inspiration ? socialText(node.nodeId) || null : null,
      shotFunction,
      subject,
      action,
      script,
      voiceover: narration,
      caption,
      narration,
    };
  });
  if (!scenes.length || scenes.some(scene => !scene.narration)) {
    throw new SocialContentWorkflowError('social_content_script_baseline_invalid', 503);
  }
  return {
    schemaVersion: SOCIAL_SCRIPT_BASELINE_SCHEMA,
    version: nextBaselineVersion(input.previous),
    source,
    formulaReference,
    themeId: input.theme?.themeId ?? input.formula?.themeId ?? null,
    language,
    lockedAt: input.lockedAt,
    createdBeforeMaterialAdaptation: true,
    groundingVersion: SOCIAL_SCRIPT_GROUNDING_VERSION,
    match: {
      strategy: matchedFormula && input.inspiration
        ? 'formula_inspiration'
        : matchedFormula
          ? 'formula'
          : input.inspiration
            ? 'inspiration'
            : 'knowledge_fallback',
      confidence: Math.max(0, Math.min(1, matchedFormula
        ? input.inspiration ? (0.7 + input.inspiration.confidence * 0.3) : 0.78
        : input.inspiration ? input.inspiration.confidence
          : Math.min(0.62, 0.35 + (userProductAssociation?.confidence ?? verified.confidence) * 0.35))),
      inspirationReference: input.inspiration
        ? { recordId: input.inspiration.recordId, confidence: input.inspiration.confidence }
        : null,
      // Product linkage and enterprise knowledge are independent evidence
      // axes. Preserve the real knowledge source when facts came from the
      // enterprise profile; use the association token only when no knowledge
      // source exists at all.
      verifiedKnowledgeSource: (userProductAssociation && verified.source === 'none'
        ? 'user_product_association'
        : verified.source) as SocialScriptGroundingSource,
      verifiedFactKeys: verified.facts.map(item => item.key),
      userTextUsage: 'intent_only',
      userProductAssociation,
    },
    scenes,
  };
}

export function parseStoredSocialScriptBaseline(value: unknown): StoredSocialScriptBaseline | null {
  const raw = socialJson(value);
  if (raw === undefined || raw === null || raw === '') return null;
  const row = socialObject(raw);
  const formula = socialObject(row?.formulaReference);
  const scenesValue = socialJson(row?.scenes);
  const language = socialText(row?.language);
  const source = socialText(row?.source);
  const themeId = socialText(row?.themeId) || null;
  const groundingVersion = socialText(row?.groundingVersion);
  const match = socialObject(row?.match);
  const matchKnowledgeSource = socialText(match?.verifiedKnowledgeSource);
  const matchAssociation = socialObject(match?.userProductAssociation);
  if (!row
    || socialText(row.schemaVersion) !== SOCIAL_SCRIPT_BASELINE_SCHEMA
    || !/^\d+$/.test(socialText(row.version))
    || !['formula', 'inspiration_script', 'knowledge_fallback', 'system_theme_baseline'].includes(source)
    || !['zh', 'en'].includes(language)
    || !socialText(row.lockedAt)
    || row.createdBeforeMaterialAdaptation !== true
    || !Array.isArray(scenesValue)
    || scenesValue.length < 1
    || scenesValue.length > 12) {
    throw new SocialContentWorkflowError('social_content_script_baseline_record_invalid', 503);
  }
  const formulaReference = formula
    ? { formulaId: socialText(formula.formulaId), version: socialText(formula.version) }
    : null;
  if ((source === 'formula' && (!formulaReference?.formulaId || !formulaReference.version))
    || (source !== 'formula' && formulaReference)) {
    throw new SocialContentWorkflowError('social_content_script_baseline_record_invalid', 503);
  }
  if (groundingVersion === SOCIAL_SCRIPT_GROUNDING_VERSION
    && ((matchKnowledgeSource === 'user_product_association'
      && socialText(matchAssociation?.basis) !== 'tenant_task_upload')
      || (matchKnowledgeSource === 'none'
        && socialText(matchAssociation?.basis) === 'tenant_task_upload'))) {
    throw new SocialContentWorkflowError('social_content_script_baseline_record_invalid', 503);
  }
  const scenes = scenesValue.map(value => {
    const scene = socialObject(value);
    const parsed = {
      sceneId: socialText(scene?.sceneId),
      formulaNodeId: socialText(scene?.formulaNodeId) || null,
      inspirationNodeId: socialText(scene?.inspirationNodeId) || null,
      shotFunction: socialText(scene?.shotFunction),
      subject: socialText(scene?.subject),
      action: socialText(scene?.action),
      script: socialText(scene?.script) || `${socialText(scene?.shotFunction)}：${socialText(scene?.subject)}，${socialText(scene?.action)}`,
      voiceover: socialText(scene?.voiceover) || socialText(scene?.narration),
      caption: socialText(scene?.caption) || socialText(scene?.voiceover) || socialText(scene?.narration),
      narration: socialText(scene?.narration),
    };
    if (!scene || !parsed.sceneId || !parsed.shotFunction || !parsed.subject || !parsed.action
      || !parsed.script || !parsed.voiceover || !parsed.caption || !parsed.narration) {
      throw new SocialContentWorkflowError('social_content_script_baseline_record_invalid', 503);
    }
    return parsed;
  });
  return {
    schemaVersion: SOCIAL_SCRIPT_BASELINE_SCHEMA,
    version: socialText(row.version),
    source: source as StoredSocialScriptBaseline['source'],
    formulaReference,
    themeId: themeId as SocialContentThemeId | null,
    language: language as StoredSocialScriptBaseline['language'],
    lockedAt: socialText(row.lockedAt),
    createdBeforeMaterialAdaptation: true,
    ...(groundingVersion === SOCIAL_SCRIPT_GROUNDING_VERSION ? {
      groundingVersion: SOCIAL_SCRIPT_GROUNDING_VERSION,
      match: {
        strategy: (['formula_inspiration', 'formula', 'inspiration', 'knowledge_fallback'].includes(socialText(match?.strategy))
          ? socialText(match?.strategy)
          : 'legacy') as NonNullable<StoredSocialScriptBaseline['match']>['strategy'],
        confidence: Math.max(0, Math.min(1, Number(match?.confidence) || 0)),
        inspirationReference: (() => {
          const reference = socialObject(match?.inspirationReference);
          const recordId = socialText(reference?.recordId);
          return recordId ? { recordId, confidence: Math.max(0, Math.min(1, Number(reference?.confidence) || 0)) } : null;
        })(),
        verifiedKnowledgeSource: (['enterprise_product', 'enterprise_profile', 'user_product_association', 'none'].includes(matchKnowledgeSource)
          ? matchKnowledgeSource
          : 'none') as SocialScriptGroundingSource,
        verifiedFactKeys: Array.isArray(socialJson(match?.verifiedFactKeys))
          ? (socialJson(match?.verifiedFactKeys) as unknown[]).map(socialText).filter(Boolean).slice(0, 20)
          : [],
        userTextUsage: 'intent_only',
        userProductAssociation: (() => {
          if (socialText(matchAssociation?.basis) !== 'tenant_task_upload') return null;
          return {
            basis: 'tenant_task_upload' as const,
            confidence: Math.max(0, Math.min(1, Number(matchAssociation?.confidence) || 0)),
          };
        })(),
      },
    } : {}),
    scenes,
  };
}

export function publicSocialScriptBaselineSummary(
  baseline: StoredSocialScriptBaseline | null,
): SocialScriptBaselineSummary | undefined {
  if (!baseline) return undefined;
  return {
    version: baseline.version,
    source: baseline.source,
    sceneCount: baseline.scenes.length,
    language: baseline.language,
    lockedAt: baseline.lockedAt,
    ...(baseline.match ? { matchConfidence: baseline.match.confidence } : {}),
    ...(baseline.groundingVersion ? { groundingVersion: baseline.groundingVersion } : {}),
  };
}
