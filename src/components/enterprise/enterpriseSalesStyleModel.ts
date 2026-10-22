import type { SalesStyleProfile } from './enterpriseProfileTypes';

export type EditableSalesStyleField = 'greeting_style' | 'quoting_stance' | 'followup_rhythm';

export function updateSalesStyleField(profile: SalesStyleProfile, key: EditableSalesStyleField, value: string): SalesStyleProfile {
  return {
    ...profile,
    [key]: { value, evidence: profile[key]?.evidence ?? '', manual: true },
  };
}

export function deleteSalesStyleField(profile: SalesStyleProfile, key: EditableSalesStyleField): SalesStyleProfile {
  const next = { ...profile };
  delete next[key];
  return next;
}

export function updateTabooPhrases(profile: SalesStyleProfile, value: string): SalesStyleProfile {
  return {
    ...profile,
    taboo_phrases: {
      value: value.split(/[,\n，、]+/).map(item => item.trim()).filter(Boolean),
      evidence: profile.taboo_phrases?.evidence ?? '',
      manual: true,
    },
  };
}

export function deleteTabooPhrases(profile: SalesStyleProfile): SalesStyleProfile {
  const next = { ...profile };
  delete next.taboo_phrases;
  return next;
}
