import { useRef, useState } from 'react';
import { type CoverStyle, type SubCue, type TtsStyleOptions, type StudioAudioCapabilities } from '../../lib/studioApi';
import { DEFAULT_TTS_SETTINGS } from './studioWorkspaceCatalog.js';
import type { LanguageTtsSettings, ReferenceVoiceStrength } from './studioWorkspaceContracts.js';
import type { StudioVoiceLifecyclePorts } from './studioVoiceLifecyclePorts.js';

export function useStudioVoiceChoiceState() {
  const [voice, setVoice] = useState('v1');
  const [voiceCandidates, setVoiceCandidates] = useState<string[]>(['v1']);

  return { voice, setVoice, voiceCandidates, setVoiceCandidates };
}

export function useStudioVoiceDraftState() {
  const [voiceoverLines, setVoiceoverLines] = useState('');
  const [voiceLangs, setVoiceLangs] = useState<string[]>([]);
  const [enterpriseVoiceLangs, setEnterpriseVoiceLangs] = useState<string[]>([]);
  const [activeVoiceLang, setActiveVoiceLang] = useState('zh');
  const enterpriseScriptLanguage = voiceLangs[0] || enterpriseVoiceLangs[0] || '';
  const [voiceDrafts, setVoiceDrafts] = useState<Record<string, string>>({});
  const [voiceDraftStaleLangs, setVoiceDraftStaleLangs] = useState<string[]>([]);
  const [voiceDraftPendingLangs, setVoiceDraftPendingLangs] = useState<string[]>([]);
  const [voiceDraftFailedLangs, setVoiceDraftFailedLangs] = useState<string[]>([]);
  const [voiceDraftLoading, setVoiceDraftLoading] = useState(false);
  const voiceDraftRunRef = useRef(0);
  const [voiceDraftNotice, setVoiceDraftNotice] = useState('');
  const voiceDraftAbortRef = useRef<AbortController | null>(null);

  return { voiceoverLines, setVoiceoverLines, voiceLangs, setVoiceLangs, enterpriseVoiceLangs, setEnterpriseVoiceLangs, activeVoiceLang, setActiveVoiceLang, enterpriseScriptLanguage, voiceDrafts, setVoiceDrafts, voiceDraftStaleLangs, setVoiceDraftStaleLangs, voiceDraftPendingLangs, setVoiceDraftPendingLangs, voiceDraftFailedLangs, setVoiceDraftFailedLangs, voiceDraftLoading, setVoiceDraftLoading, voiceDraftRunRef, voiceDraftNotice, setVoiceDraftNotice, voiceDraftAbortRef };
}

export function useStudioVoicePreviewState() {
  const [voicePreviewIdx, setVoicePreviewIdx] = useState<number | null>(null);

  return { voicePreviewIdx, setVoicePreviewIdx };
}

export function useStudioVoiceControlsState() {
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [showVoiceAdvanced, setShowVoiceAdvanced] = useState(false);
  const [showSubtitleAdvanced, setShowSubtitleAdvanced] = useState(false);
  const [subtitleGenerating, setSubtitleGenerating] = useState(false);
  const [subtitleNotice, setSubtitleNotice] = useState('');

  return { showLanguagePicker, setShowLanguagePicker, showVoiceAdvanced, setShowVoiceAdvanced, showSubtitleAdvanced, setShowSubtitleAdvanced, subtitleGenerating, setSubtitleGenerating, subtitleNotice, setSubtitleNotice };
}

export function useStudioVoiceAudioState() {
  const [voiceoverUrl, setVoiceoverUrl] = useState<string | null>(null);
  const [voiceoverDur, setVoiceoverDur] = useState(0);
  const [voiceoverAudios, setVoiceoverAudios] = useState<Record<string, { url: string; duration: number; cues?: SubCue[]; text?: string; alignmentSource?: string; customVoiceStatus?: 'activated' }>>({});
  const [voiceoverStaleLangs, setVoiceoverStaleLangs] = useState<string[]>([]);
  const [alignedCuesByLang, setAlignedCuesByLang] = useState<Record<string, SubCue[]>>({});
  const [sourceCaptionTextEdits, setSourceCaptionTextEdits] = useState<Record<string, string>>({});

  return { voiceoverUrl, setVoiceoverUrl, voiceoverDur, setVoiceoverDur, voiceoverAudios, setVoiceoverAudios, voiceoverStaleLangs, setVoiceoverStaleLangs, alignedCuesByLang, setAlignedCuesByLang, sourceCaptionTextEdits, setSourceCaptionTextEdits };
}

export function useStudioVoiceSettingsState(ports: Pick<StudioVoiceLifecyclePorts,
  | "activeVoiceLang"
>) {
  const {
    activeVoiceLang,
  } = ports;
  const [ttsLanguageSettings, setTtsLanguageSettings] = useState<Record<string, LanguageTtsSettings>>({});
  const activeTtsSettings = ttsLanguageSettings[activeVoiceLang] || DEFAULT_TTS_SETTINGS;
  const patchActiveTtsSettings = (patch: Partial<LanguageTtsSettings>) => {
    setTtsLanguageSettings(current => ({
      ...current,
      [activeVoiceLang]: { ...(current[activeVoiceLang] || DEFAULT_TTS_SETTINGS), ...patch },
    }));
  };
  const ttsPreset = activeTtsSettings.preset;
  const ttsEmotion = activeTtsSettings.emotion;
  const ttsEmotionIntensity = activeTtsSettings.emotionIntensity;
  const ttsSpeed = activeTtsSettings.speed;
  const ttsPauseStyle = activeTtsSettings.pauseStyle;
  const ttsPronunciationText = activeTtsSettings.pronunciationText;
  const setTtsPreset = (value: TtsStyleOptions['preset']) => patchActiveTtsSettings({ preset: value });
  const setTtsEmotion = (value: string) => patchActiveTtsSettings({ emotion: value });
  const setTtsEmotionIntensity = (value: number) => patchActiveTtsSettings({ emotionIntensity: value });
  const setTtsSpeed = (value: number) => patchActiveTtsSettings({ speed: value });
  const setTtsPauseStyle = (value: LanguageTtsSettings['pauseStyle']) => patchActiveTtsSettings({ pauseStyle: value });
  const setTtsPronunciationText = (value: string) => patchActiveTtsSettings({ pronunciationText: value });
  const [referenceVoiceStrength, setReferenceVoiceStrength] = useState<ReferenceVoiceStrength>('balanced');
  const [useReferenceVoiceStyle, setUseReferenceVoiceStyle] = useState(true);
  const [audioCapabilities, setAudioCapabilities] = useState<StudioAudioCapabilities | null>(null);
  const [minimaxDiagnostic, setMinimaxDiagnostic] = useState('');
  const [minimaxDiagnosing, setMinimaxDiagnosing] = useState(false);

  return { ttsLanguageSettings, setTtsLanguageSettings, activeTtsSettings, patchActiveTtsSettings, ttsPreset, ttsEmotion, ttsEmotionIntensity, ttsSpeed, ttsPauseStyle, ttsPronunciationText, setTtsPreset, setTtsEmotion, setTtsEmotionIntensity, setTtsSpeed, setTtsPauseStyle, setTtsPronunciationText, referenceVoiceStrength, setReferenceVoiceStrength, useReferenceVoiceStyle, setUseReferenceVoiceStyle, audioCapabilities, setAudioCapabilities, minimaxDiagnostic, setMinimaxDiagnostic, minimaxDiagnosing, setMinimaxDiagnosing };
}

export function useStudioVoiceSynthesisState() {
  const [voiceoverMode, setVoiceoverMode] = useState<'unselected' | 'none' | 'ai' | 'upload'>('unselected');
  const [uploadedVoiceName, setUploadedVoiceName] = useState('');
  const [customVoiceId, setCustomVoiceId] = useState('');
  const [customVoiceName, setCustomVoiceName] = useState('');
  const [customVoiceUrl, setCustomVoiceUrl] = useState('');
  const [customVoices, setCustomVoices] = useState<Array<{ voiceId: string; name: string; url: string; duration: number; createdAt: string }>>([]);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsLoadingScope, setTtsLoadingScope] = useState<'all' | 'single' | 'upload' | null>(null);
  const [ttsActiveLangs, setTtsActiveLangs] = useState<string[]>([]);
  const [ttsFailuresByLang, setTtsFailuresByLang] = useState<Record<string, string>>({});
  const ttsRequestRef = useRef(0);
  const batchTtsLoading = ttsLoading && ttsLoadingScope === 'all';
  const singleTtsLoading = ttsLoading && ttsLoadingScope === 'single';
  const [ttsNotice, setTtsNotice] = useState('');
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsCurrentTime, setTtsCurrentTime] = useState(0);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceoverInputRef = useRef<HTMLInputElement>(null);
  const voiceSampleInputRef = useRef<HTMLInputElement>(null);

  return { voiceoverMode, setVoiceoverMode, uploadedVoiceName, setUploadedVoiceName, customVoiceId, setCustomVoiceId, customVoiceName, setCustomVoiceName, customVoiceUrl, setCustomVoiceUrl, customVoices, setCustomVoices, ttsLoading, setTtsLoading, ttsLoadingScope, setTtsLoadingScope, ttsActiveLangs, setTtsActiveLangs, ttsFailuresByLang, setTtsFailuresByLang, ttsRequestRef, batchTtsLoading, singleTtsLoading, ttsNotice, setTtsNotice, ttsPlaying, setTtsPlaying, ttsCurrentTime, setTtsCurrentTime, ttsAudioRef, voiceoverInputRef, voiceSampleInputRef };
}

export function useStudioSubtitleStyleState() {
  const [subtitleStyle, setSubtitleStyle] = useState({ font: 'sans' as CoverStyle['font'], color: '#ffffff', fontScale: 1, bottomRatio: 0.20, outlineColor: '#111827', outlineWidth: 3, lineWidth: 18 });

  return { subtitleStyle, setSubtitleStyle };
}

export function useStudioSubtitleState() {
  const [subtitlesOn, setSubtitlesOn] = useState(true);
  const [subMode, setSubMode] = useState<'target' | 'bilingual'>('target');
  const [subPreviewIdx, setSubPreviewIdx] = useState(0); // 预览叠层当前展示的 cue
  const [cueZh, setCueZh] = useState<string[]>([]);

  return { subtitlesOn, setSubtitlesOn, subMode, setSubMode, subPreviewIdx, setSubPreviewIdx, cueZh, setCueZh };
}
