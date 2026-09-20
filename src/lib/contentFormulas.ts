import { authHeader } from './auth';

const BASE = '/api/overseas/starter-198/social-content/internal/content-formulas';

export type ContentThemeId =
  | 'product_value'
  | 'scenario_solution'
  | 'supplier_capability'
  | 'customization_process'
  | 'customer_case';

export type ContentFormulaStatus = 'draft' | 'internal_trial' | 'gray' | 'active' | 'disabled';

export type ContentFormulaNode = {
  nodeId: string;
  shotFunction: string;
  subject: string;
  action: string;
  environment: string | null;
  orientation: 'portrait' | 'landscape' | 'either';
  durationSeconds: { minimum: number; maximum: number } | null;
  required: boolean;
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
  nodes: ContentFormulaNode[];
};

export type CreateContentFormulaInput = Pick<ContentFormula, 'formulaId' | 'version' | 'name' | 'themeId' | 'nodes'> & {
  note?: string;
};

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
  input: { version: string; name?: string; nodes?: ContentFormulaNode[]; note?: string },
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
