import {
  SOCIAL_CONTENT_THEME_IDS,
  SOCIAL_MATERIAL_REQUIREMENT_STATUSES,
  type SocialContentThemeCard,
  type SocialContentThemeId,
  type SocialContentThemeSelection,
  type SocialMaterialReadiness,
  type SocialMaterialRequirement,
  type SocialMaterialRequirementStatus,
  type SocialTaskSource,
} from '../../shared/contracts/socialContentWorkflow.js';
import { SocialContentWorkflowError, socialJson, socialObject, socialText } from './socialContentValidation.js';

export const SOCIAL_THEME_CATALOG: readonly SocialContentThemeCard[] = [
  {
    themeId: 'product_value',
    name: '产品与卖点',
    description: '讲清产品是什么、关键能力和可验证的差异。',
    exampleTopics: ['新品核心卖点', '原料与工艺细节', '性能实测'],
    minimumShots: ['产品全貌', '关键细节', '使用或性能演示', '可验证证据'],
  },
  {
    themeId: 'scenario_solution',
    name: '场景与解决方案',
    description: '从真实使用场景和问题出发，展示解决过程与边界。',
    exampleTopics: ['高温环境怎么用', '客户常见问题解决', '使用前后对比'],
    minimumShots: ['场景或对象', '具体问题', '解决动作', '可见结果或适用边界'],
  },
  {
    themeId: 'supplier_capability',
    name: '企业与供应保障',
    description: '展示团队、制造或供应协同、质检与交付保障。',
    exampleTopics: ['生产流程', '质量控制', '仓储与交付'],
    minimumShots: ['场所或团队', '流程', '质量检查点', '仓储或交付'],
  },
  {
    themeId: 'customization_process',
    name: '定制与合作流程',
    description: '让买家知道从需求到打样、生产和交付如何推进。',
    exampleTopics: ['OEM/ODM合作流程', '打样周期', '包装定制'],
    minimumShots: ['需求', '可选方案', '样品', '确认', '生产或交付'],
  },
  {
    themeId: 'customer_case',
    name: '客户案例与合作成果',
    description: '在获得授权且证据可核验的前提下讲合作结果。',
    exampleTopics: ['客户问题与方案', '合作过程', '可核验成果'],
    minimumShots: ['获授权的背景', '问题', '方案过程', '可核验结果', '授权证明'],
  },
] as const;

export interface InternalFormulaNode {
  nodeId: string;
  shotFunction: string;
  subject: string;
  action: string;
  environment: string | null;
  orientation: 'portrait' | 'landscape' | 'either';
  durationSeconds: { minimum: number; maximum: number } | null;
  required: boolean;
  /** Executable script owned by the formula; never returned in customer task payloads. */
  narrationTemplate: { zh: string; en: string };
}

export interface InternalSocialContentFormula {
  recordId?: string;
  formulaId: string;
  version: string;
  name: string;
  themeId: SocialContentThemeId;
  status: 'draft' | 'internal_trial' | 'gray' | 'active' | 'disabled';
  rollout: { percentage: number; tenantAllowlist: string[] };
  audit: Array<{ event: string; actor: string; at: string; note?: string }>;
  nodes: InternalFormulaNode[];
}

const BUILTIN_FORMULA_GOVERNANCE = {
  rollout: { percentage: 100, tenantAllowlist: [] as string[] },
  audit: [{ event: 'builtin_reviewed', actor: 'platform-content-ops', at: '2026-09-19T00:00:00.000Z' }],
};

const node = (
  nodeId: string,
  shotFunction: string,
  subject: string,
  action: string,
  environment: string | null = null,
  narrationTemplate: { zh: string; en: string } = {
    zh: '通过真实素材展示{{subject}}，重点说明{{shotFunction}}。',
    en: 'Using the supplied material, show {{subject}} to support {{shotFunction}}.',
  },
): InternalFormulaNode => ({
  nodeId,
  shotFunction,
  subject,
  action,
  environment,
  orientation: 'portrait',
  durationSeconds: { minimum: 2, maximum: 8 },
  required: true,
  narrationTemplate,
});

/** Internal-only registry. Never embed these names or identifiers in a public task response. */
export const INTERNAL_SOCIAL_CONTENT_FORMULAS: readonly InternalSocialContentFormula[] = [
  {
    formulaId: 'builtin.product-proof', version: '1.0.0', name: '产品证据链', themeId: 'product_value', status: 'active', ...BUILTIN_FORMULA_GOVERNANCE,
    nodes: [
      node('overview', '建立产品认知', '产品全貌', '完整展示', null, { zh: '这次围绕{{topic}}，带你了解{{product}}。', en: 'Here is a closer look at {{product}}, focused on {{topic}}.' }),
      node('detail', '证明关键卖点', '关键结构或原料', '近景展示', null, { zh: '先从真实素材里看{{subject}}，具体信息以已确认资料为准。', en: 'First, examine {{subject}} in the supplied material; specifications remain subject to verified information.' }),
      node('demo', '展示使用效果', '产品与使用对象', '真实演示', '实际使用场景', { zh: '再看{{product}}在真实场景中的使用过程与可见表现。', en: 'Next, see how {{product}} is used and what is visibly demonstrated in the real setting.' }),
      node('evidence', '提供可核验证据', '检测、参数或对比证据', '清晰呈现', null, { zh: '最后只呈现可核验的资料与画面。{{callToAction}}', en: 'Finally, we present only verifiable information and visuals. {{callToAction}}' }),
    ],
  },
  {
    formulaId: 'builtin.scenario-resolution', version: '1.0.0', name: '场景问题解决', themeId: 'scenario_solution', status: 'active', ...BUILTIN_FORMULA_GOVERNANCE,
    nodes: [
      node('context', '交代场景', '使用对象与环境', '展示现状', '真实使用场景', { zh: '先看{{topic}}对应的真实使用场景。', en: 'First, look at the real setting behind {{topic}}.' }),
      node('problem', '呈现具体问题', '问题细节', '指出或复现', null, { zh: '在这个场景里，重点关注素材中真实可见的问题细节。', en: 'In this setting, focus on the problem details that are actually visible in the supplied material.' }),
      node('action', '展示解决动作', '产品或服务', '执行关键步骤', null, { zh: '接下来展示{{product}}的实际操作过程，不补充未经确认的效果。', en: 'Next, show how {{product}} is actually used without adding unverified outcomes.' }),
      node('result', '展示结果与边界', '结果或适用边界', '可视化呈现', null, { zh: '最后展示素材中可见的结果和适用边界。{{callToAction}}', en: 'Finally, show the visible result and applicable boundaries. {{callToAction}}' }),
    ],
  },
  {
    formulaId: 'builtin.supply-assurance', version: '1.0.0', name: '供应保障证据', themeId: 'supplier_capability', status: 'active', ...BUILTIN_FORMULA_GOVERNANCE,
    nodes: [
      node('place_team', '建立企业可信度', '场所或团队', '现场展示', null, { zh: '围绕{{topic}}，先看真实的场所与团队。', en: 'For {{topic}}, begin with the actual site and team.' }),
      node('process', '展示供应流程', '生产或协作流程', '连续记录', null, { zh: '接着通过连续画面了解生产或协作流程。', en: 'Then, follow the production or coordination process through continuous footage.' }),
      node('quality', '证明质量控制', '质量检查点', '执行检查', null, { zh: '质量能力只通过真实拍摄的检查动作和已确认资料呈现。', en: 'Quality capability is shown only through filmed checks and verified information.' }),
      node('delivery', '证明交付能力', '仓储、包装或物流', '展示交付准备', null, { zh: '最后看仓储、包装或交付准备。{{callToAction}}', en: 'Finally, review warehousing, packaging, or delivery preparation. {{callToAction}}' }),
    ],
  },
  {
    formulaId: 'builtin.customization-journey', version: '1.0.0', name: '定制合作路径', themeId: 'customization_process', status: 'active', ...BUILTIN_FORMULA_GOVERNANCE,
    nodes: [
      node('need', '呈现客户需求', '需求信息', '清晰列出', null, { zh: '定制合作从明确真实需求开始。', en: 'A customization project begins with a clearly confirmed requirement.' }),
      node('options', '展示可选方案', '规格、配方或包装选项', '对比展示', null, { zh: '再根据已确认资料展示可选规格、配方或包装方向。', en: 'Next, show available specification, formula, or packaging directions from verified information.' }),
      node('sample', '展示打样结果', '样品', '细节展示', null, { zh: '样品环节重点展示实物细节，不代替最终确认。', en: 'The sampling stage focuses on physical details and does not replace final confirmation.' }),
      node('confirmation', '证明确认过程', '确认记录或标准', '核对确认', null, { zh: '确认记录与标准决定后续生产依据。', en: 'Confirmed records and standards form the basis for later production.' }),
      node('production_delivery', '说明后续交付', '生产或交付节点', '展示进度', null, { zh: '最后进入生产与交付节点。{{callToAction}}', en: 'The process then moves into production and delivery. {{callToAction}}' }),
    ],
  },
  {
    formulaId: 'builtin.authorized-case', version: '1.0.0', name: '授权案例证据', themeId: 'customer_case', status: 'active', ...BUILTIN_FORMULA_GOVERNANCE,
    nodes: [
      node('authorized_context', '交代获授权背景', '已获授权的客户背景', '去敏展示', null, { zh: '这是一个已获授权并完成去敏处理的合作案例。', en: 'This is an authorized collaboration case with sensitive details removed.' }),
      node('case_problem', '说明客户问题', '客户问题', '客观呈现', null, { zh: '先客观说明客户当时需要解决的问题。', en: 'First, objectively describe the customer problem that needed to be solved.' }),
      node('case_solution', '展示方案过程', '解决方案', '记录关键过程', null, { zh: '接着通过真实素材展示方案推进的关键过程。', en: 'Next, use real material to show the key steps of the solution.' }),
      node('verified_result', '展示可核验结果', '结果证据', '呈现数据或实物', null, { zh: '结果部分只使用可核验的数据、实物或记录。', en: 'The result uses only verifiable data, physical evidence, or records.' }),
      node('authorization', '证明内容授权', '授权凭证', '去敏展示', null, { zh: '案例内容以授权范围为边界。{{callToAction}}', en: 'The case is presented only within the authorized scope. {{callToAction}}' }),
    ],
  },
] as const;

const CLASSIFICATION_KEYWORDS: Record<SocialContentThemeId, readonly string[]> = {
  product_value: ['产品', '卖点', '原料', '配方', '材质', '参数', '性能', '成分', '功效', '新品'],
  scenario_solution: ['场景', '使用', '问题', '痛点', '解决', '怎么用', '适用', '效果'],
  supplier_capability: ['工厂', '车间', '产线', '生产', '质检', '仓库', '交付', '供应', '团队', '产能'],
  customization_process: ['定制', '合作', '打样', 'oem', 'odm', '包装', '起订', '流程', '需求'],
  customer_case: ['客户', '案例', '合作成果', '复购', '增长', '结果', '品牌'],
};

export function classifySocialCustomTopic(topicValue: string): SocialContentThemeSelection {
  const topic = topicValue.trim();
  const normalized = topic.toLowerCase();
  const scores = SOCIAL_CONTENT_THEME_IDS.map(themeId => ({
    themeId,
    score: CLASSIFICATION_KEYWORDS[themeId].filter(keyword => normalized.includes(keyword)).length,
  })).sort((a, b) => b.score - a.score);
  const best = scores[0];
  const tied = best.score > 0 && scores[1]?.score === best.score;
  return {
    themeId: best.score > 0 && !tied ? best.themeId : null,
    inputKind: 'custom',
    topic,
    classificationStatus: best.score > 0 && !tied ? 'confirmed' : 'pending_confirmation',
  };
}

export function resolveSocialThemeSelection(input: {
  themeId?: SocialContentThemeId | null;
  customTopic?: string | null;
  topic?: string | null;
}): SocialContentThemeSelection | null {
  const customTopic = socialText(input.customTopic);
  if (input.themeId) {
    if (!SOCIAL_CONTENT_THEME_IDS.includes(input.themeId)) {
      throw new SocialContentWorkflowError('social_content_theme_invalid', 400);
    }
    return {
      themeId: input.themeId,
      inputKind: customTopic ? 'custom' : 'preset',
      topic: customTopic || socialText(input.topic),
      classificationStatus: 'confirmed',
    };
  }
  return customTopic ? classifySocialCustomTopic(customTopic) : null;
}

export function formulaForTheme(themeId: SocialContentThemeId): InternalSocialContentFormula {
  const formula = INTERNAL_SOCIAL_CONTENT_FORMULAS.find(item => item.themeId === themeId && item.status === 'active');
  if (!formula) throw new SocialContentWorkflowError('social_content_formula_unavailable', 503);
  return formula;
}

export interface StoredMaterialRequirement extends SocialMaterialRequirement {
  /** Server-only formula node reference; stripped by public serializers. */
  formulaNodeId: string;
}

export function initialMaterialRequirements(
  themeId: SocialContentThemeId,
  timestamp: string,
  selectedFormula?: InternalSocialContentFormula,
  mode: 'formula' | 'advisory' = 'formula',
): { formulaReference: { formulaId: string; version: string }; requirements: StoredMaterialRequirement[] } {
  const formula = selectedFormula ?? formulaForTheme(themeId);
  if (formula.themeId !== themeId || !['active', 'gray', 'internal_trial'].includes(formula.status)) {
    throw new SocialContentWorkflowError('social_content_formula_unavailable', 503);
  }
  return {
    formulaReference: { formulaId: formula.formulaId, version: formula.version },
    requirements: formula.nodes.map((item, index) => ({
      requirementId: `material:${themeId}:${index + 1}`,
      // Themes only describe what the content is about. Until a formula is
      // explicitly applied to a production task, its shot structure is an
      // advisory checklist and must never block the user from starting.
      required: mode === 'formula' ? item.required : false,
      targetTheme: themeId,
      shotFunction: item.shotFunction,
      subject: item.subject,
      action: item.action,
      environment: item.environment,
      orientation: item.orientation,
      durationSeconds: item.durationSeconds,
      status: 'missing',
      matchedSourceIds: [],
      confidence: null,
      reason: '尚未匹配素材',
      recalculatedAt: timestamp,
      ruleVersion: 'material-match-v1',
      formulaNodeId: item.nodeId,
    })),
  };
}

const numberValue = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

export function parseStoredMaterialRequirements(value: unknown): StoredMaterialRequirement[] {
  const parsed = socialJson(value);
  if (parsed === undefined || parsed === null || parsed === '') return [];
  if (!Array.isArray(parsed)) throw new SocialContentWorkflowError('social_material_requirements_invalid', 503);
  return parsed.map(item => {
    const row = socialObject(item);
    const targetTheme = socialText(row?.targetTheme) as SocialContentThemeId;
    const status = socialText(row?.status) as SocialMaterialRequirementStatus;
    const orientation = socialText(row?.orientation) as StoredMaterialRequirement['orientation'];
    const duration = socialObject(row?.durationSeconds);
    const matched = socialJson(row?.matchedSourceIds);
    if (!row || !SOCIAL_CONTENT_THEME_IDS.includes(targetTheme)
      || !SOCIAL_MATERIAL_REQUIREMENT_STATUSES.includes(status)
      || !['portrait', 'landscape', 'either'].includes(orientation)
      || !Array.isArray(matched) || matched.some(value => !socialText(value))) {
      throw new SocialContentWorkflowError('social_material_requirements_invalid', 503);
    }
    const minimum = numberValue(duration?.minimum);
    const maximum = numberValue(duration?.maximum);
    return {
      requirementId: socialText(row.requirementId),
      required: row.required === true,
      targetTheme,
      shotFunction: socialText(row.shotFunction),
      subject: socialText(row.subject),
      action: socialText(row.action),
      environment: socialText(row.environment) || null,
      orientation,
      durationSeconds: minimum !== null && maximum !== null ? { minimum, maximum } : null,
      status,
      matchedSourceIds: matched.map(socialText),
      confidence: numberValue(row.confidence),
      reason: socialText(row.reason) || null,
      recalculatedAt: socialText(row.recalculatedAt),
      ruleVersion: socialText(row.ruleVersion),
      formulaNodeId: socialText(row.formulaNodeId),
    };
  });
}

export function publicMaterialRequirements(requirements: StoredMaterialRequirement[]): SocialMaterialRequirement[] {
  return requirements.map(({ formulaNodeId: _formulaNodeId, ...requirement }) => requirement);
}

export function materialReadiness(requirements: SocialMaterialRequirement[]): SocialMaterialReadiness {
  const required = requirements.filter(item => item.required);
  const satisfied = required.filter(item => item.status === 'satisfied');
  return {
    complete: required.length === satisfied.length,
    requiredCount: required.length,
    satisfiedRequiredCount: satisfied.length,
    blockingRequirementIds: required.filter(item => item.status !== 'satisfied').map(item => item.requirementId),
  };
}

export function advisoryMaterialRequirements(
  requirements: StoredMaterialRequirement[],
): StoredMaterialRequirement[] {
  return requirements.map(requirement => requirement.required
    ? { ...requirement, required: false }
    : requirement);
}

export function recomputeMaterialRequirements(
  requirements: StoredMaterialRequirement[],
  sources: Pick<SocialTaskSource, 'sourceId' | 'kind' | 'label' | 'purpose' | 'status'>[],
  timestamp: string,
): StoredMaterialRequirement[] {
  const usable = sources.filter(source => source.status === 'active' && ['material', 'reference_link'].includes(source.kind));
  const unassigned = new Set(usable.map(source => source.sourceId));
  return requirements.map(requirement => {
    const searchable = `${requirement.requirementId} ${requirement.formulaNodeId} ${requirement.shotFunction} ${requirement.subject}`.toLowerCase();
    let matches = usable.filter(source => {
      const purpose = `${source.purpose ?? ''} ${source.label}`.toLowerCase();
      return Boolean(purpose) && (purpose.includes(requirement.requirementId.toLowerCase())
        || purpose.includes(requirement.formulaNodeId.toLowerCase())
        || purpose.split(/[\s,，、;；]+/).some(token => token.length >= 2 && searchable.includes(token)));
    });
    if (!matches.length) {
      const fallback = usable.find(source => unassigned.has(source.sourceId));
      if (fallback) matches = [fallback];
    }
    matches.forEach(source => unassigned.delete(source.sourceId));
    const flags = matches.map(source => `${source.label} ${source.purpose ?? ''}`.toLowerCase()).join(' ');
    let status: SocialMaterialRequirementStatus = 'missing';
    let confidence: number | null = null;
    let reason = '尚未匹配素材';
    if (matches.length) {
      if (/不可用|损坏|模糊|unusable|invalid/.test(flags)) {
        status = 'unusable'; confidence = 0; reason = '匹配素材已标记为不可用';
      } else if (/待确认|pending|需确认/.test(flags)) {
        status = 'pending_confirmation'; confidence = 0.5; reason = '素材已匹配，仍需确认是否满足拍摄要求';
      } else if (matches.every(source => source.kind === 'reference_link')) {
        status = 'partial'; confidence = 0.45; reason = '参考链接只能辅助说明，仍需可用于制作的原始素材';
      } else {
        status = 'satisfied'; confidence = matches.some(source => `${source.purpose ?? ''}`.includes(requirement.requirementId)) ? 1 : 0.75;
        reason = '已匹配可用于制作的素材';
      }
    }
    return {
      ...requirement,
      status,
      matchedSourceIds: matches.map(source => source.sourceId),
      confidence,
      reason,
      recalculatedAt: timestamp,
      ruleVersion: 'material-match-v1',
    };
  });
}
