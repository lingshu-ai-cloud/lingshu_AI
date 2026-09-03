export type DigitalHumanVoiceStrategy = 'smart' | 'brand' | 'person';
export type ResolvedDigitalHumanVoiceStrategy = Exclude<DigitalHumanVoiceStrategy, 'smart'>;

export interface DigitalHumanVoicePolicyInput {
  requested?: unknown;
  allShotsUseSamePerson: boolean;
  mixedWithLocalMaterial: boolean;
  personVoiceAvailable: boolean;
  personVoiceAuthorized: boolean;
  brandVoiceAvailable: boolean;
}

export interface DigitalHumanVoicePolicyDecision {
  requested: DigitalHumanVoiceStrategy;
  resolved: ResolvedDigitalHumanVoiceStrategy;
  reason: string;
  fallback: boolean;
}

export function resolveDigitalHumanVoicePolicy(input: DigitalHumanVoicePolicyInput): DigitalHumanVoicePolicyDecision {
  const requested: DigitalHumanVoiceStrategy = input.requested === 'brand' || input.requested === 'person' ? input.requested : 'smart';
  const personReady = input.personVoiceAvailable && input.personVoiceAuthorized;
  if (requested === 'brand') {
    if (!input.brandVoiceAvailable) throw new Error('固定品牌声音不可用，无法建立全片唯一主音轨');
    return { requested, resolved: 'brand', reason: 'user_selected_brand_voice', fallback: false };
  }
  if (requested === 'person') {
    if (personReady) return { requested, resolved: 'person', reason: 'user_selected_person_voice', fallback: false };
    if (!input.brandVoiceAvailable) throw new Error('人物声音未绑定或未授权，且固定品牌声音不可用');
    return { requested, resolved: 'brand', reason: 'person_voice_unavailable_fallback_to_brand', fallback: true };
  }
  if (input.mixedWithLocalMaterial || !input.allShotsUseSamePerson) {
    if (!input.brandVoiceAvailable) throw new Error('混合分镜需要固定品牌声音来建立全片唯一主音轨');
    return { requested, resolved: 'brand', reason: input.mixedWithLocalMaterial ? 'mixed_timeline_prefers_brand_voice' : 'multiple_people_require_brand_voice', fallback: false };
  }
  if (personReady) return { requested, resolved: 'person', reason: 'single_person_native_voice_available', fallback: false };
  if (!input.brandVoiceAvailable) throw new Error('没有可用且已授权的统一主声音源');
  return { requested, resolved: 'brand', reason: 'person_voice_unavailable_fallback_to_brand', fallback: true };
}
