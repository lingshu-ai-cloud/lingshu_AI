import type { DataStore } from '../storage/datastore.js';
import { paidProductionHash } from './socialContentPaidOperationPlan.js';

export interface BoundPresenterVoice {
  presenters: Array<{ id: string; assetVersion: number; avatarId: string; voiceId: string }>;
  provider: 'heygen'; voiceId: string; logicalVoice: string; fingerprint: string;
}

/** Only authoritative tenant assets may select a production voice. */
export async function readBoundPresenterVoice(store: DataStore, tenantId: string, ids: string[]): Promise<BoundPresenterVoice | null> {
  const selected = [...new Set(ids)].sort();
  if (!selected.length) return null;
  const rows = await store.list<any>('studio_production_defaults', { where: { tenant_id: tenantId }, perPage: 2 });
  if (rows.items.length !== 1 || rows.items[0].tenant_id !== tenantId) throw Error('selected_presenter_voice_registry_missing');
  const assets = rows.items[0].payload?.presenters || [];
  const presenters = selected.map(id => {
    const matches = assets.filter((item: any) => item.id === id);
    if (matches.length !== 1) throw Error('selected_presenter_voice_registry_ambiguous:' + id);
    const p = matches[0];
    const voiceId = String(p?.toolMappings?.heygen?.voiceId || p?.voiceId || '').trim();
    const avatarId = String(p?.toolMappings?.heygen?.avatarId || p?.avatarId || '').trim();
    if (p?.authorized !== true || !voiceId || !avatarId || (p.voiceId && p.voiceId !== voiceId) || (p?.avatarId && p.avatarId !== avatarId)) throw Error('selected_presenter_bound_voice_missing_or_conflicting:' + id);
    return { id, assetVersion: Math.max(1, p.assetVersion || 1), avatarId, voiceId };
  });
  if (new Set(presenters.map(p => p.voiceId)).size !== 1) throw Error('multiple_presenter_voices_require_separate_audio_tracks');
  const voiceId = presenters[0]!.voiceId;
  const fingerprint = paidProductionHash({ tenantId, presenters, provider: 'heygen', voiceId });
  return { presenters, provider: 'heygen', voiceId, fingerprint, logicalVoice: `heygen:${voiceId}:${fingerprint}` };
}

export function assertBoundPresenterAudio(expectedVoiceId: string, actual: { provider: string; physicalVoiceId: string }) {
  if (actual.provider !== 'heygen' || actual.physicalVoiceId !== expectedVoiceId) throw Error('selected_presenter_audio_voice_mismatch');
}
