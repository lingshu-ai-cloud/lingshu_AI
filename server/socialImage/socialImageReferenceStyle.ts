import type { DataStore } from '../storage/datastore.js';
import type { ImageReferenceStyleElement } from '../../shared/contracts/imageReferenceProductionLabel.js';
import { videoAnalysisOf } from '../lib/videoAnalysisCodec.js';

export type ReferenceStyleObservation = { kind: 'advertising' | 'imitable'; elements: ImageReferenceStyleElement[]; sourceSha256: string; analysisVersion: 'image-post-evidence.v2' };
const allowed = new Set<ImageReferenceStyleElement>(['soft_light','hard_light','high_key','low_key','centered','asymmetric','close_up','minimal','layered']);

/** Reuse only same-tenant, byte-matched prior observations; never trigger analysis or collection. */
export async function readReferenceStyle(input: { store: DataStore; tenantId: string; sourceRecordId?: string; sourceSha256: string }): Promise<ReferenceStyleObservation | null> {
  if (!input.sourceRecordId || !/^[a-f0-9]{64}$/.test(input.sourceSha256)) return null;
  const row = await input.store.getById<Record<string, unknown>>('trend_videos', input.sourceRecordId);
  if (!row || String(row.tenantId || row.tenant_id || '') !== input.tenantId) return null;
  const analysis = videoAnalysisOf(row);
  if (analysis.contentFormat !== 'image' || !analysis.imageEvidence || typeof analysis.imageEvidence !== 'object') return null;
  const evidence = analysis.imageEvidence as Record<string, unknown>;
  if (evidence.version !== 2 || evidence.status !== 'analyzed' || !Array.isArray(evidence.productionLabels)) return null;
  const matches = evidence.productionLabels.filter((raw: unknown) => raw && typeof raw === 'object' && (raw as Record<string, unknown>).sourceSha256 === input.sourceSha256);
  if (matches.length !== 1) return null;
  const raw = (matches[0] as Record<string, unknown>).style;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const style = raw as Record<string, unknown>;
  if (!['advertising','imitable'].includes(String(style.kind)) || typeof style.confidence !== 'number' || style.confidence < .8 || style.confidence > 1 || !Number.isFinite(style.confidence) || typeof style.evidence !== 'string' || !style.evidence.trim() || !Array.isArray(style.elements)) return null;
  const elements = [...new Set(style.elements.filter((value): value is ImageReferenceStyleElement => allowed.has(value as ImageReferenceStyleElement)))];
  if (style.kind === 'imitable' && !elements.length) return null;
  return { kind: style.kind as 'advertising' | 'imitable', elements, sourceSha256: input.sourceSha256, analysisVersion: 'image-post-evidence.v2' };
}
