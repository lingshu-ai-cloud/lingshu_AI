import { createHash } from 'node:crypto';

export const TRILINGUAL_RENDER_LANGUAGES = ['zh', 'en', 'es'] as const;
export type TrilingualRenderLanguage = typeof TRILINGUAL_RENDER_LANGUAGES[number];

export interface TrilingualRenderBatchItem<TSpec extends Record<string, unknown> = Record<string, unknown>> {
  language: TrilingualRenderLanguage;
  spec: TSpec;
}
export interface TrilingualRenderBatchRequest<TSpec extends Record<string, unknown> = Record<string, unknown>> {
  batchKey: string;
  sourceProjectId: string;
  renders: Array<TrilingualRenderBatchItem<TSpec>>;
}

function plainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter(key => record[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function stableAssetReference(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, 'http://local.invalid');
    return parsed.pathname;
  } catch {
    return raw.split(/[?#]/, 1)[0] || '';
  }
}

function semanticRenderSpec(spec: Record<string, unknown>): Record<string, unknown> {
  const timeline = Array.isArray(spec.timeline) ? spec.timeline.map(rawItem => {
    const item = plainRecord(rawItem);
    // Browser media URLs and posters are presentation hints. The server resolves
    // each clipId/name from its tenant-owned material index before authorization.
    return Object.fromEntries(Object.entries(item)
      .filter(([key]) => !['url', 'poster', 'authorizationToken'].includes(key)));
  }) : [];
  return {
    ...Object.fromEntries(Object.entries(spec)
      .filter(([key]) => !['timeline', 'voiceoverUrl', 'coverUrl', 'sourceProjectId', 'authorizationToken'].includes(key))),
    timeline,
    voiceoverUrl: stableAssetReference(spec.voiceoverUrl),
    coverUrl: stableAssetReference(spec.coverUrl),
  };
}

export function parseTrilingualRenderBatchRequest<TSpec extends Record<string, unknown> = Record<string, unknown>>(
  body: unknown,
): TrilingualRenderBatchRequest<TSpec> {
  const input = plainRecord(body);
  const batchKey = String(input.batchKey || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(batchKey)) {
    throw new Error('render batchKey must be 8-160 safe characters');
  }
  const sourceProjectId = String(input.sourceProjectId || '').trim();
  if (!sourceProjectId || sourceProjectId.length > 200) throw new Error('render batch sourceProjectId is required');
  if (!Array.isArray(input.renders) || input.renders.length !== 3) {
    throw new Error('render batch must contain exactly three render specs');
  }
  const byLanguage = new Map<TrilingualRenderLanguage, TrilingualRenderBatchItem<TSpec>>();
  for (const raw of input.renders) {
    const item = plainRecord(raw);
    const language = String(item.language || '') as TrilingualRenderLanguage;
    if (!TRILINGUAL_RENDER_LANGUAGES.includes(language)) throw new Error('render batch languages must be exactly zh, en, es');
    if (byLanguage.has(language)) throw new Error(`render batch language is duplicated: ${language}`);
    const spec = plainRecord(item.spec) as TSpec;
    if (!Object.keys(spec).length || String(spec.language || '') !== language) {
      throw new Error(`${language} render spec language does not match its batch item`);
    }
    const requestedProjectId = String(spec.sourceProjectId || sourceProjectId).trim();
    if (requestedProjectId !== sourceProjectId) throw new Error(`${language} render spec belongs to a different source project`);
    byLanguage.set(language, { language, spec: { ...spec, sourceProjectId } as TSpec });
  }
  if (TRILINGUAL_RENDER_LANGUAGES.some(language => !byLanguage.has(language))) {
    throw new Error('render batch languages must be exactly zh, en, es');
  }
  return {
    batchKey,
    sourceProjectId,
    renders: TRILINGUAL_RENDER_LANGUAGES.map(language => byLanguage.get(language)!),
  };
}

export function trilingualRenderBatchFingerprint(
  request: TrilingualRenderBatchRequest,
): string {
  const semantic = {
    schemaVersion: 'trilingual-render-batch-v1',
    sourceProjectId: request.sourceProjectId,
    renders: request.renders.map(item => ({
      language: item.language,
      spec: semanticRenderSpec(item.spec),
    })),
  };
  return createHash('sha256').update(canonicalJson(semantic)).digest('hex');
}
