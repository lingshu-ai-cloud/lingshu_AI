import { createHash } from 'node:crypto';
/** Provider capability evidence for the exact selected voice. No voice substitution. */
export type HeyGenSpeechEngine = 'orca' | 'starfish';
export interface HeyGenVoiceMetadata { voice_id: string; available_engines: string[]; default_engine?: string }
export function selectHeyGenSpeechEngine(value: HeyGenVoiceMetadata, voiceId: string): HeyGenSpeechEngine {
  if (value.voice_id !== voiceId || !Array.isArray(value.available_engines)) throw Error('selected_presenter_voice_metadata_invalid');
  const supported = value.available_engines.filter((engine): engine is HeyGenSpeechEngine => engine === 'orca' || engine === 'starfish');
  const preferred = value.default_engine;
  if (preferred) {
    if (!supported.includes(preferred as HeyGenSpeechEngine)) throw Error('user_input_required:presenter_narration_capability_unavailable:heygen:' + preferred);
    return preferred as HeyGenSpeechEngine;
  }
  if (supported.length !== 1) throw Error('selected_presenter_voice_engine_ambiguous');
  return supported[0]!;
}
export function createHeyGenVoiceCapabilityCache() {
  return { values: new Map<string, { expires: number; value: HeyGenVoiceMetadata }>(),
    inflight: new Map<string, Promise<HeyGenVoiceMetadata>>(), generation: new Map<string, number>() };
}
const defaultCapabilityCache = createHeyGenVoiceCapabilityCache();
interface VoiceMetadataPorts {
  fetch?: typeof fetch; key?: string; fresh?: boolean;
  cache?: ReturnType<typeof createHeyGenVoiceCapabilityCache>; now?: () => number;
}
export async function readHeyGenVoiceMetadata(voiceId: string, ports: VoiceMetadataPorts = {}): Promise<HeyGenVoiceMetadata> {
  const key = ports.key || process.env.HEYGEN_API_KEY?.trim();
  if (!key || !voiceId.trim()) throw Error('selected_presenter_voice_metadata_credential_missing');
  // Custom fixture transports are isolated unless their caller supplies a cache.
  const cache = ports.cache || (!ports.fetch ? defaultCapabilityCache : undefined);
  if (!cache) return fetchHeyGenVoiceMetadata(voiceId, { ...ports, key });
  const identity = createHash('sha256').update(key).digest('hex') + ':' + voiceId;
  const now = ports.now || Date.now;
  const cached = cache.values.get(identity);
  if (!ports.fresh && cached && cached.expires > now()) return structuredClone(cached.value);
  if (cached && cached.expires <= now()) cache.values.delete(identity);
  const flightKey = identity + (ports.fresh ? ':fresh' : ':normal');
  const previous = cache.inflight.get(flightKey);
  if (previous) return structuredClone(await previous);
  const generation = (cache.generation.get(identity) || 0) + 1;
  cache.generation.set(identity, generation);
  const pending = fetchHeyGenVoiceMetadata(voiceId, { ...ports, key }).then(value => {
    if (cache.generation.get(identity) === generation) cache.values.set(identity, { expires: now() + 60000, value: structuredClone(value) });
    return value;
  });
  cache.inflight.set(flightKey, pending);
  try { return structuredClone(await pending); }
  finally { if (cache.inflight.get(flightKey) === pending) cache.inflight.delete(flightKey); }
}
async function fetchHeyGenVoiceMetadata(voiceId: string, ports: VoiceMetadataPorts): Promise<HeyGenVoiceMetadata> {
  const key = ports.key || process.env.HEYGEN_API_KEY?.trim();
  if (!key || !voiceId.trim()) throw Error('selected_presenter_voice_metadata_credential_missing');
  const response = await (ports.fetch || fetch)(`https://api.heygen.com/v3/voices/${encodeURIComponent(voiceId)}`, {
    headers: { 'x-api-key': key }, redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error('selected_presenter_voice_inventory_unavailable:' + response.status);
  const raw = await response.json();
  const value = raw.data || raw;
  if (value.voice_id !== voiceId) throw Error('selected_presenter_voice_metadata_invalid');
  if (Array.isArray(value.available_engines)) return value;
  // The detail endpoint currently omits engine capabilities for some public
  // catalogue voices. Only the exact same ID from the supplier list may fill it.
  for (const scope of ['private', 'public']) {
    let token = ''; const seen = new Set<string>();
    for (let page = 0; page < 30; page++) {
      const url = 'https://api.heygen.com/v3/voices?limit=100&type=' + scope + (token ? '&token=' + encodeURIComponent(token) : '');
      const listed = await (ports.fetch || fetch)(url, { headers: { 'x-api-key': key }, redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (scope === 'private' && listed.status === 403) break;
      if (!listed.ok) throw Error('selected_presenter_voice_inventory_unavailable:' + listed.status);
      const catalog = await listed.json();
      if (!Array.isArray(catalog.data)) throw Error('selected_presenter_voice_metadata_invalid');
      const matches = catalog.data.filter((item: any) => item.voice_id === voiceId);
      if (matches.length > 1) throw Error('selected_presenter_voice_metadata_ambiguous');
      if (matches.length && Array.isArray(matches[0].available_engines)) return matches[0];
      if (!catalog.has_more) break;
      if (typeof catalog.next_token !== 'string' || !catalog.next_token || seen.has(catalog.next_token)) throw Error('selected_presenter_voice_inventory_pagination_invalid');
      seen.add(catalog.next_token); token = catalog.next_token;
    }
  }
  throw Error('selected_presenter_voice_metadata_invalid');
}
/** Legacy frozen three-part identities retain their explicitly historical Starfish route. */
export function parseBoundHeyGenLogicalVoice(value: string): { voiceId: string; engine: HeyGenSpeechEngine } {
  const parts = value.split(':');
  if (parts[0] !== 'heygen' || !parts[1] || !parts[2] || (parts.length !== 3 && parts.length !== 4)
    || (parts.length === 4 && parts[3] !== 'orca' && parts[3] !== 'starfish')) throw Error('selected_presenter_frozen_voice_identity_invalid');
  return { voiceId: parts[1], engine: (parts[3] || 'starfish') as HeyGenSpeechEngine };
}
