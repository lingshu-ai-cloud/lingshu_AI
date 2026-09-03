import { createHash } from 'node:crypto';

export const DIGITAL_HUMAN_INPUT_SIGNATURE_VERSION = 'digital-human-input-v2' as const;

export interface DigitalHumanInputAssetIdentity {
  materialId: string;
  avatarId?: string;
  version?: number;
  sourceHash?: string;
  sourceRevision?: string;
}

export interface DigitalHumanInputSignatureFields {
  tenantId: string;
  projectId?: string;
  storyboardSlotId?: string;
  audioStartSeconds?: number;
  audioEndSeconds?: number;
  voiceoverUrl: string;
  script: string;
  language: string;
  avatar: DigitalHumanInputAssetIdentity;
  performancePlanVersion?: string;
  performancePlan?: unknown;
  motionAssets?: DigitalHumanInputAssetIdentity[];
  pipelineVersion: string;
  mode: string;
  usagePurpose: string;
}

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue };

function normalizedText(value: unknown): string {
  return String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

function normalizedSeconds(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value)) throw new Error('digital human signature timing must be finite');
  return Math.round(value * 1_000) / 1_000;
}

function canonicalValue(value: unknown): CanonicalValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.normalize('NFC').replace(/\r\n?/g, '\n');
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('digital human signature data must contain finite numbers');
    return Math.round(value * 1_000_000) / 1_000_000;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record).sort().reduce<Record<string, CanonicalValue>>((result, key) => {
      if (record[key] !== undefined) result[key] = canonicalValue(record[key]);
      return result;
    }, {});
  }
  throw new Error(`digital human signature data contains unsupported ${typeof value}`);
}

function canonicalAsset(asset: DigitalHumanInputAssetIdentity): CanonicalValue {
  const version = Number(asset.version);
  return {
    avatarId: normalizedText(asset.avatarId),
    materialId: normalizedText(asset.materialId),
    sourceHash: normalizedText(asset.sourceHash).toLowerCase(),
    sourceRevision: normalizedText(asset.sourceRevision),
    version: Number.isFinite(version) ? Math.max(1, Math.round(version)) : 1,
  };
}

/**
 * Computes the only signature that the server may use for idempotent reuse.
 * Client-provided inputSignature values are deliberately absent: callers may
 * retain them as response-correlation IDs, but they cannot select an old job.
 */
export function digitalHumanCanonicalInputSignature(fields: DigitalHumanInputSignatureFields): string {
  const payload: CanonicalValue = {
    audio: {
      endSeconds: normalizedSeconds(fields.audioEndSeconds),
      startSeconds: normalizedSeconds(fields.audioStartSeconds),
      voiceoverUrl: normalizedText(fields.voiceoverUrl),
    },
    avatar: canonicalAsset(fields.avatar),
    language: normalizedText(fields.language).replace(/_/g, '-').toLowerCase(),
    mode: normalizedText(fields.mode).toLowerCase(),
    motionAssets: (fields.motionAssets || []).map(canonicalAsset),
    performance: {
      plan: canonicalValue(fields.performancePlan),
      version: normalizedText(fields.performancePlanVersion),
    },
    pipelineVersion: normalizedText(fields.pipelineVersion),
    projectId: normalizedText(fields.projectId),
    schemaVersion: DIGITAL_HUMAN_INPUT_SIGNATURE_VERSION,
    script: normalizedText(fields.script),
    storyboardSlotId: normalizedText(fields.storyboardSlotId),
    tenantId: normalizedText(fields.tenantId),
    usagePurpose: normalizedText(fields.usagePurpose).toLowerCase(),
  };
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `${DIGITAL_HUMAN_INPUT_SIGNATURE_VERSION}:${digest}`;
}
