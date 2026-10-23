import type * as React from 'react';

export interface StudioLanguageSwitcherViewInputs {
  voiceLangs: string[];
  activeVoiceLang: string;
  voiceDraftFailedLangs: string[];
  ttsFailuresByLang: Record<string, string>;
  workflowSourceLanguage: string;
  setActiveVoiceLang: React.Dispatch<React.SetStateAction<string>>;
  setLang: React.Dispatch<React.SetStateAction<string>>;
  removeTranslationLanguage: (code: string) => void;
  setShowLanguagePicker: React.Dispatch<React.SetStateAction<boolean>>;
  showLanguagePicker: boolean;
  toggleTranslationLanguage: (code: string) => void;
}
