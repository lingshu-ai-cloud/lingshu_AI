import { authHeader } from './auth';

const BASE = '/api/overseas/starter-198/social-content/internal/content-formulas';

export type ContentThemeId =
  | 'product_value'
  | 'scenario_solution'
  | 'supplier_capability'
  | 'customization_process'
  | 'customer_case';

export type ContentFormulaStatus = 'draft' | 'internal_trial' | 'gray' | 'active' | 'disabled';

export type ContentFormulaLocalizedTemplate = { zh: string; en: string };

export type ContentFormulaAcceptanceGate = {
  gateId: string;
  name: string;
  rule: string;
  blocking: boolean;
};

export type ContentFormulaDirection = {
  pace: 'fast' | 'balanced' | 'steady';
  visualStyle: string;
  music: {
    mood: string;
    volume: number;
    strategy: string;
    sourceType: 'licensed_library' | 'original' | 'none';
    licenseVerified: boolean;
    licenseReference: string | null;
  };
  voiceover: {
    voice: string;
    preset: 'tiktok_excited' | 'authentic_review' | 'professional_b2b' | 'warm_story' | 'urgent_cta';
    speed: number;
    pauseStyle: 'few' | 'natural' | 'dramatic';
  };
  subtitles: { fontScale: number; bottomRatio: number; styleIntent: string };
  cover: {
    intent: string;
    headlineTemplate: ContentFormulaLocalizedTemplate;
    subject: string;
    composition: string;
  };
  materialFallback: {
    minimumUsableClips: number;
    allowStillFrames: boolean;
    allowRepeatedClips: boolean;
    maxRepeatCount: number;
    insufficientMaterialAction: 'adapt_with_verified_assets' | 'request_reshoot' | 'block';
  };
  risks: {
    prohibitedClaims: string[];
    prohibitedVisuals: string[];
    mandatoryDisclosures: string[];
  };
  acceptanceGates: ContentFormulaAcceptanceGate[];
};

export type ContentFormulaNode = {
  nodeId: string;
  shotFunction: string;
  subject: string;
  action: string;
  environment: string | null;
  orientation: 'portrait' | 'landscape' | 'either';
  durationSeconds: { minimum: number; maximum: number } | null;
  required: boolean;
  shotType: 'live_action' | 'product_demo' | 'process' | 'talking_head' | 'graphic';
  shotSize: 'extreme_close_up' | 'close_up' | 'medium' | 'wide' | 'detail';
  cameraMovement: 'static' | 'pan' | 'tilt' | 'push_in' | 'pull_out' | 'tracking' | 'handheld';
  composition: string;
  transition: 'cut' | 'match_cut' | 'dissolve' | 'fade' | 'wipe';
  narrationTemplate?: ContentFormulaLocalizedTemplate;
  scriptTemplate: ContentFormulaLocalizedTemplate;
  voiceoverTemplate: ContentFormulaLocalizedTemplate;
  captionTemplate: ContentFormulaLocalizedTemplate;
};

export type ContentFormula = {
  recordId?: string;
  formulaId: string;
  version: string;
  name: string;
  themeId: ContentThemeId;
  status: ContentFormulaStatus;
  rollout: { percentage: number; tenantAllowlist: string[] };
  audit: Array<{ event: string; actor: string; at: string; note?: string }>;
  direction: ContentFormulaDirection;
  nodes: ContentFormulaNode[];
};

export type CreateContentFormulaInput = Pick<ContentFormula, 'formulaId' | 'version' | 'name' | 'themeId' | 'direction' | 'nodes'> & {
  note?: string;
};

export const DEFAULT_CONTENT_FORMULA_DIRECTION: ContentFormulaDirection = {
  pace: 'balanced',
  visualStyle: '',
  music: {
    mood: '',
    volume: 18,
    strategy: '',
    sourceType: 'licensed_library',
    licenseVerified: false,
    licenseReference: '',
  },
  voiceover: { voice: 'v1', preset: 'professional_b2b', speed: 1.12, pauseStyle: 'natural' },
  subtitles: { fontScale: 1, bottomRatio: 0.18, styleIntent: '' },
  cover: {
    intent: '',
    headlineTemplate: { zh: '', en: '' },
    subject: '',
    composition: '',
  },
  materialFallback: {
    minimumUsableClips: 1,
    allowStillFrames: false,
    allowRepeatedClips: false,
    maxRepeatCount: 0,
    insufficientMaterialAction: 'request_reshoot',
  },
  risks: { prohibitedClaims: [], prohibitedVisuals: [], mandatoryDisclosures: [] },
  acceptanceGates: [{ gateId: 'gate_1', name: '', rule: '', blocking: true }],
};

export function createDefaultContentFormulaNode(index: number): ContentFormulaNode {
  return {
    nodeId: `shot_${index + 1}`,
    shotFunction: '',
    subject: '',
    action: '',
    environment: '',
    orientation: 'portrait',
    durationSeconds: { minimum: 2, maximum: 8 },
    required: true,
    shotType: 'live_action',
    shotSize: 'medium',
    cameraMovement: 'static',
    composition: '',
    transition: 'cut',
    scriptTemplate: {
      zh: '{{shotFunction}}：拍摄{{subject}}，{{action}}。',
      en: '{{shotFunction}}: show {{subject}} and {{action}}.',
    },
    voiceoverTemplate: {
      zh: '围绕{{topic}}，用真实素材展示{{product}}。',
      en: 'For {{topic}}, show {{product}} with real material.',
    },
    captionTemplate: {
      zh: '{{product}}｜{{shotFunction}}',
      en: '{{product}} | {{shotFunction}}',
    },
  };
}

const TEMPLATE_TOKENS = new Set(['product', 'topic', 'callToAction', 'shotFunction', 'subject', 'action']);
const CONTROL_CHARACTERS = /[\u0000-\u001f]/;
const oneLineText = (value: string, maximum: number): boolean => Boolean(value.trim())
  && value.trim().length <= maximum && !CONTROL_CHARACTERS.test(value);
const TEMPLATE_LABELS = {
  scriptTemplate: '脚本', voiceoverTemplate: '口播', captionTemplate: '字幕',
} as const;

function validateTemplate(template: ContentFormulaLocalizedTemplate, label: string, issues: string[]): void {
  (['zh', 'en'] as const).forEach(language => {
    const value = template[language].trim();
    const languageLabel = language === 'zh' ? '中文' : '英文';
    if (!value || value.length > 1_000 || CONTROL_CHARACTERS.test(template[language])) {
      issues.push(`${label}${languageLabel}模板需填写且不超过 1000 字`);
      return;
    }
    const tokens = [...value.matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1]!);
    if (tokens.some(token => !TEMPLATE_TOKENS.has(token))) issues.push(`${label}${languageLabel}模板包含不支持的变量`);
  });
}

export function validateContentFormulaDraft(input: {
  formulaId: string;
  name: string;
  version: string;
  direction: ContentFormulaDirection;
  nodes: ContentFormulaNode[];
}): string[] {
  const issues: string[] = [];
  if (!oneLineText(input.name, 160)) issues.push('公式名称需填写且不超过 160 字');
  if (!/^[a-z][a-z0-9._-]{1,119}$/i.test(input.formulaId.trim())) issues.push('内部编号需以字母开头，并使用字母、数字、点、下划线或短横线');
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(input.version.trim())) issues.push('版本号请使用 1.0.0 这样的格式');
  if (input.nodes.length < 1 || input.nodes.length > 12) issues.push('镜头节点数量需为 1 至 12 个');
  const nodeIds = input.nodes.map(node => node.nodeId.trim());
  if (new Set(nodeIds).size !== nodeIds.length) issues.push('镜头节点编号不能重复');

  const direction = input.direction;
  if (!['fast', 'balanced', 'steady'].includes(direction.pace)) issues.push('视频节奏值不正确');
  if (!oneLineText(direction.visualStyle, 500)) issues.push('视觉风格需填写且不超过 500 字');
  if (!oneLineText(direction.music.mood, 160)) issues.push('音乐情绪需填写且不超过 160 字');
  if (!Number.isFinite(direction.music.volume) || direction.music.volume < 0 || direction.music.volume > 100) issues.push('音乐音量需在 0 至 100 之间');
  if (!oneLineText(direction.music.strategy, 500)) issues.push('音乐策略需填写且不超过 500 字');
  if (!['licensed_library', 'original', 'none'].includes(direction.music.sourceType)) issues.push('音乐来源值不正确');
  if (typeof direction.music.licenseVerified !== 'boolean') issues.push('音乐授权核验值不正确');
  if (direction.music.sourceType !== 'none' && (!direction.music.licenseVerified || !direction.music.licenseReference?.trim())) {
    issues.push('使用音乐时必须确认版权并填写授权依据');
  }
  if ((direction.music.licenseReference ?? '').trim().length > 500 || CONTROL_CHARACTERS.test(direction.music.licenseReference ?? '')) issues.push('音乐授权依据不超过 500 字');
  if (!oneLineText(direction.voiceover.voice, 80)) issues.push('配音音色需填写且不超过 80 字');
  if (!['tiktok_excited', 'authentic_review', 'professional_b2b', 'warm_story', 'urgent_cta'].includes(direction.voiceover.preset)) issues.push('配音风格值不正确');
  if (!Number.isFinite(direction.voiceover.speed) || direction.voiceover.speed < 0.75 || direction.voiceover.speed > 1.5) issues.push('配音语速需在 0.75 至 1.5 之间');
  if (!Number.isFinite(direction.subtitles.fontScale) || direction.subtitles.fontScale < 0.75 || direction.subtitles.fontScale > 1.5) issues.push('字幕字号需在 0.75 至 1.5 之间');
  if (!Number.isFinite(direction.subtitles.bottomRatio) || direction.subtitles.bottomRatio < 0.08 || direction.subtitles.bottomRatio > 0.35) issues.push('字幕底部位置需在画面高度的 8% 至 35% 之间');
  if (!['few', 'natural', 'dramatic'].includes(direction.voiceover.pauseStyle)) issues.push('口播停顿值不正确');
  if (!oneLineText(direction.subtitles.styleIntent, 300)) issues.push('字幕风格需填写且不超过 300 字');

  if (!oneLineText(direction.cover.intent, 500)) issues.push('封面目标需填写且不超过 500 字');
  if (!oneLineText(direction.cover.subject, 300)) issues.push('封面主体需填写且不超过 300 字');
  if (!oneLineText(direction.cover.composition, 500)) issues.push('封面构图需填写且不超过 500 字');
  validateTemplate(direction.cover.headlineTemplate, '封面标题', issues);

  const fallback = direction.materialFallback;
  if (!Number.isSafeInteger(fallback.minimumUsableClips) || fallback.minimumUsableClips < 1 || fallback.minimumUsableClips > 12) issues.push('最少可用素材数需为 1 至 12 的整数');
  if (!Number.isSafeInteger(fallback.maxRepeatCount) || fallback.maxRepeatCount < 0 || fallback.maxRepeatCount > 12) issues.push('单条素材最多重复次数需为 0 至 12 的整数');
  if (typeof fallback.allowStillFrames !== 'boolean' || typeof fallback.allowRepeatedClips !== 'boolean') issues.push('素材降级布尔值不正确');
  if (!['adapt_with_verified_assets', 'request_reshoot', 'block'].includes(fallback.insufficientMaterialAction)) issues.push('素材不足动作值不正确');
  (Object.entries(direction.risks) as Array<[keyof ContentFormulaDirection['risks'], string[]]>).forEach(([key, values]) => {
    const label = key === 'prohibitedClaims' ? '禁用表述' : key === 'prohibitedVisuals' ? '禁用画面' : '必须披露';
    const normalized = [...new Set(values.map(value => value.trim()).filter(Boolean))];
    if (normalized.length > 50 || normalized.some(value => value.length > 200)) issues.push(`${label}每项需为 1 至 200 字，最多 50 项`);
  });
  if (direction.acceptanceGates.length < 1 || direction.acceptanceGates.length > 20) issues.push('验收门槛需为 1 至 20 项');
  if (!direction.acceptanceGates.some(gate => gate.blocking)) issues.push('至少一项验收门槛需设为阻断项');
  const gateIds = direction.acceptanceGates.map(gate => gate.gateId.trim());
  if (new Set(gateIds).size !== gateIds.length) issues.push('验收门槛编号不能重复');
  direction.acceptanceGates.forEach((gate, index) => {
    const position = `验收门槛 ${index + 1}`;
    if (!/^[a-z][a-z0-9._-]{1,119}$/i.test(gate.gateId.trim())) issues.push(`${position}编号格式不正确`);
    if (!oneLineText(gate.name, 160)) issues.push(`${position}名称需填写且不超过 160 字`);
    if (!oneLineText(gate.rule, 1_000)) issues.push(`${position}规则需填写且不超过 1000 字`);
    if (typeof gate.blocking !== 'boolean') issues.push(`${position}阻断值不正确`);
  });

  input.nodes.forEach((node, index) => {
    const position = `镜头 ${index + 1}`;
    if (!/^[a-z][a-z0-9._-]{1,119}$/i.test(node.nodeId.trim())) issues.push(`${position}编号格式不正确`);
    if (!oneLineText(node.shotFunction, 200) || !oneLineText(node.subject, 200) || !oneLineText(node.action, 200)) issues.push(`${position}需写清用途、拍摄对象和动作，每项不超过 200 字`);
    if (!node.environment || !oneLineText(node.environment, 300)) issues.push(`${position}拍摄环境需填写且不超过 300 字`);
    if (!oneLineText(node.composition, 500)) issues.push(`${position}构图说明需填写且不超过 500 字`);
    if (!['portrait', 'landscape', 'either'].includes(node.orientation)) issues.push(`${position}画面方向值不正确`);
    if (!['live_action', 'product_demo', 'process', 'talking_head', 'graphic'].includes(node.shotType)) issues.push(`${position}镜头类型值不正确`);
    if (!['extreme_close_up', 'close_up', 'medium', 'wide', 'detail'].includes(node.shotSize)) issues.push(`${position}景别值不正确`);
    if (!['static', 'pan', 'tilt', 'push_in', 'pull_out', 'tracking', 'handheld'].includes(node.cameraMovement)) issues.push(`${position}运镜值不正确`);
    if (!['cut', 'match_cut', 'dissolve', 'fade', 'wipe'].includes(node.transition)) issues.push(`${position}转场值不正确`);
    if (typeof node.required !== 'boolean') issues.push(`${position}必须值不正确`);
    if (!node.durationSeconds || !Number.isFinite(node.durationSeconds.minimum) || node.durationSeconds.minimum <= 0
      || !Number.isFinite(node.durationSeconds.maximum) || node.durationSeconds.maximum < node.durationSeconds.minimum
      || node.durationSeconds.maximum > 600) issues.push(`${position}时长需大于 0，最大值不小于最小值且不超过 600 秒`);
    (Object.keys(TEMPLATE_LABELS) as Array<keyof typeof TEMPLATE_LABELS>).forEach(key => {
      validateTemplate(node[key], `${position}${TEMPLATE_LABELS[key]}`, issues);
    });
  });
  return [...new Set(issues)];
}

function idempotencyKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `content-formula-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function request<T>(path = '', init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...authHeader(),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.method && init.method !== 'GET' ? { 'Idempotency-Key': idempotencyKey() } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(data.message || data.error || '爆款公式操作失败');
  return data;
}

function formulaPath(formula: ContentFormula): string {
  return `/${encodeURIComponent(formula.formulaId)}/${encodeURIComponent(formula.version)}`;
}

export async function listContentFormulas(): Promise<ContentFormula[]> {
  const data = await request<{ items?: ContentFormula[] }>();
  return Array.isArray(data.items) ? data.items : [];
}

export async function createContentFormula(input: CreateContentFormulaInput): Promise<ContentFormula> {
  const data = await request<{ formula: ContentFormula }>('', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.formula;
}

export async function createContentFormulaVersion(
  source: ContentFormula,
  input: { version: string; name?: string; direction?: ContentFormulaDirection; nodes?: ContentFormulaNode[]; note?: string },
): Promise<ContentFormula> {
  const data = await request<{ formula: ContentFormula }>(formulaPath(source), {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return data.formula;
}

export async function startContentFormulaTrial(formula: ContentFormula): Promise<ContentFormula> {
  const data = await request<{ formula: ContentFormula }>(`${formulaPath(formula)}/trial`, {
    method: 'POST', body: JSON.stringify({ note: '管理员发起内测' }),
  });
  return data.formula;
}

export async function publishContentFormula(
  formula: ContentFormula,
  status: 'gray' | 'active',
  options: { percentage?: number; tenantAllowlist?: string[] } = {},
): Promise<ContentFormula> {
  const percentage = status === 'active' ? 100 : options.percentage ?? 0;
  const tenantAllowlist = status === 'active' ? [] : options.tenantAllowlist ?? [];
  const data = await request<{ formula: ContentFormula }>(`${formulaPath(formula)}/publish`, {
    method: 'POST',
    body: JSON.stringify({
      status,
      rollout: { percentage, tenantAllowlist },
      note: status === 'active' ? '管理员全量发布' : `管理员向 ${tenantAllowlist.length} 个指定租户灰度发布`,
    }),
  });
  return data.formula;
}

export async function disableContentFormula(formula: ContentFormula): Promise<ContentFormula> {
  const data = await request<{ formula: ContentFormula }>(`${formulaPath(formula)}/disable`, {
    method: 'POST', body: JSON.stringify({ note: '管理员停用' }),
  });
  return data.formula;
}
