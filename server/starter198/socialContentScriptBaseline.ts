import type {
  SocialContentTaskBrief,
  SocialContentThemeId,
  SocialContentThemeSelection,
  SocialScriptBaselineSummary,
} from '../../shared/contracts/socialContentWorkflow.js';
import type { InternalSocialContentFormula } from './socialContentThemes.js';
import { SocialContentWorkflowError, socialJson, socialObject, socialText } from './socialContentValidation.js';

export const SOCIAL_SCRIPT_BASELINE_SCHEMA = 'social-content-script-baseline.v1';

export interface StoredSocialScriptBaseline {
  schemaVersion: typeof SOCIAL_SCRIPT_BASELINE_SCHEMA;
  version: string;
  source: 'formula' | 'system_theme_baseline';
  formulaReference: { formulaId: string; version: string } | null;
  themeId: SocialContentThemeId | null;
  language: 'zh' | 'en';
  lockedAt: string;
  createdBeforeMaterialAdaptation: true;
  scenes: Array<{
    sceneId: string;
    formulaNodeId: string | null;
    shotFunction: string;
    subject: string;
    action: string;
    narration: string;
  }>;
}

const DEFAULT_SCENES = [
  { nodeId: 'opening', shotFunction: '主题开场', subject: '本次主题', action: '明确说明' },
  { nodeId: 'product', shotFunction: '产品信息', subject: '已确认产品资料', action: '保守呈现' },
  { nodeId: 'material', shotFunction: '真实素材', subject: '客户上传内容', action: '按素材展示' },
  { nodeId: 'cta', shotFunction: '行动引导', subject: '合作方式', action: '邀请咨询' },
] as const;

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

function defaultNarration(input: {
  language: 'zh' | 'en';
  index: number;
  count: number;
  product: string;
  topic: string;
  callToAction: string;
  shotFunction: string;
  subject: string;
}): string {
  if (input.language === 'en') {
    if (input.index === 0) return `Here is a closer look at ${input.product}, focused on ${input.topic}.`;
    if (input.index === input.count - 1) return input.callToAction || `Contact us for verified details about ${input.product}.`;
    return `Using the supplied material, this scene shows ${input.subject} to support ${input.shotFunction}.`;
  }
  if (input.index === 0) return `这次围绕${input.topic}，带你了解${input.product}。`;
  if (input.index === input.count - 1) return input.callToAction || `想了解${input.product}的已确认信息，可以联系我们获取资料。`;
  return `接下来通过真实素材展示${input.subject}，重点说明${input.shotFunction}。`;
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
  lockedAt: string;
  previous?: StoredSocialScriptBaseline | null;
}): StoredSocialScriptBaseline {
  const language = baselineLanguage(input.brief.languages[0]);
  const topic = socialText(input.theme?.topic) || socialText(input.brief.objective) || socialText(input.brief.title) || '本次主题';
  const product = socialText(input.brief.productRef) || (language === 'en' ? 'this product' : '本次产品');
  const callToAction = socialText(input.brief.callToAction);
  const sourceNodes = input.formula?.nodes?.length ? input.formula.nodes : DEFAULT_SCENES;
  const source = input.formula ? 'formula' : 'system_theme_baseline';
  const formulaReference = input.formula
    ? { formulaId: input.formula.formulaId, version: input.formula.version }
    : null;
  const scenes = sourceNodes.slice(0, 12).map((node, index) => {
    const shotFunction = socialText(node.shotFunction) || '主题表达';
    const subject = socialText(node.subject) || '本次内容';
    const action = socialText(node.action) || '展示';
    const template = 'narrationTemplate' in node
      ? socialText(node.narrationTemplate?.[language])
      : '';
    const narration = template
      ? interpolate(template, {
          product,
          topic,
          callToAction: callToAction || (language === 'en' ? 'Contact us for verified details.' : '联系我们获取已确认资料。'),
          shotFunction,
          subject,
          action,
        }).trim()
      : defaultNarration({
          language,
          index,
          count: sourceNodes.length,
          product,
          topic,
          callToAction,
          shotFunction,
          subject,
        });
    return {
      sceneId: `scene-${index + 1}`,
      formulaNodeId: input.formula ? socialText(node.nodeId) || null : null,
      shotFunction,
      subject,
      action,
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
  if (!row
    || socialText(row.schemaVersion) !== SOCIAL_SCRIPT_BASELINE_SCHEMA
    || !/^\d+$/.test(socialText(row.version))
    || !['formula', 'system_theme_baseline'].includes(source)
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
  const scenes = scenesValue.map(value => {
    const scene = socialObject(value);
    const parsed = {
      sceneId: socialText(scene?.sceneId),
      formulaNodeId: socialText(scene?.formulaNodeId) || null,
      shotFunction: socialText(scene?.shotFunction),
      subject: socialText(scene?.subject),
      action: socialText(scene?.action),
      narration: socialText(scene?.narration),
    };
    if (!scene || !parsed.sceneId || !parsed.shotFunction || !parsed.subject || !parsed.action || !parsed.narration) {
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
  };
}
