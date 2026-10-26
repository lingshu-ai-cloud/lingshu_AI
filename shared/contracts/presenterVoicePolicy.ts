export type PresenterSource = 'enterprise_created' | 'heygen_catalog';
export type PresenterVoiceMode = 'explicit' | 'follow_avatar';
export interface PresenterVoicePolicyFields {
  presenterSource?: PresenterSource;
  voiceSelectionMode?: PresenterVoiceMode;
}
type VoiceRecord = {
  presenterSource?: unknown; voiceSelectionMode?: unknown; avatarId?: unknown; voiceId?: unknown;
  toolMappings?: { heygen?: { avatarId?: unknown; voiceId?: unknown } };
  rightsEvidence?: { authorizationRef?: unknown };
};
/** Historical records keep their explicit voice identity. Only a retained
 * catalogue licence can support following an avatar's provider default. */
export function presenterVoicePolicy(record: VoiceRecord) {
  const avatarId = String(record.toolMappings?.heygen?.avatarId || record.avatarId || '').trim();
  const voiceId = String(record.toolMappings?.heygen?.voiceId || record.voiceId || '').trim();
  const catalog = Boolean(avatarId && record.rightsEvidence?.authorizationRef === `license://heygen/public-catalog/${avatarId}`);
  const presenterSource: PresenterSource = catalog ? 'heygen_catalog' : 'enterprise_created';
  const voiceSelectionMode: PresenterVoiceMode = record.voiceSelectionMode === 'follow_avatar' ? 'follow_avatar' : 'explicit';
  const valid = (record.presenterSource === undefined || record.presenterSource === presenterSource)
    && (record.voiceSelectionMode === undefined || ['explicit', 'follow_avatar'].includes(String(record.voiceSelectionMode)))
    && (voiceSelectionMode !== 'follow_avatar' || catalog);
  return { presenterSource, voiceSelectionMode, avatarId, voiceId, valid,
    voiceReady: valid && Boolean(voiceId || voiceSelectionMode === 'follow_avatar') };
}

/** Native speech and detached narration are separate capabilities. A TTS
 * engine mismatch must never invalidate an otherwise licensed avatar. */
export function presenterSpeechCapabilities(input: {
  nativeSpeechAvailable: boolean; independentVoiceEngines: string[];
  supportedNarrationEngines: string[]; originalTrackReusable: boolean;
}) {
  const independentNarration = input.independentVoiceEngines.some(engine => input.supportedNarrationEngines.includes(engine));
  return { nativeSpeech: input.nativeSpeechAvailable, independentNarration,
    narration: independentNarration ? 'same_voice_tts' as const : input.originalTrackReusable ? 'original_speech_track' as const : 'needs_voice_review' as const,
    code: independentNarration || input.originalTrackReusable ? null : 'presenter_narration_capability_unavailable' };
}
