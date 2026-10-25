import { presenterVoicePolicy } from '../../shared/contracts/presenterVoicePolicy.js';
import { HeyGenPresenterClient } from './heygenPresenters.js';

/** Resolve the provider default for execution only. Never writes enterprise
 * preferences or substitutes a generic voice when the default is unavailable. */
export async function resolveCatalogPresenterVoice<T extends Parameters<typeof presenterVoicePolicy>[0]>(
  record: T, readLook = (avatarId: string) => new HeyGenPresenterClient(process.env.HEYGEN_API_KEY || '').look(avatarId),
): Promise<T> {
  const policy = presenterVoicePolicy(record);
  if (!policy.valid) throw Error('presenter_voice_policy_invalid');
  if (policy.voiceSelectionMode !== 'follow_avatar') return record;
  const look = await readLook(policy.avatarId);
  if (look.id !== policy.avatarId || look.status !== 'completed') throw Error('heygen_catalog_presenter_unavailable');
  if (!look.voiceId?.trim()) throw Error('user_input_required:heygen_catalog_default_voice_unresolved');
  return { ...record, avatarId: policy.avatarId, voiceId: look.voiceId,
    toolMappings: { ...record.toolMappings, heygen: { ...record.toolMappings?.heygen, avatarId: policy.avatarId, voiceId: look.voiceId } } };
}
