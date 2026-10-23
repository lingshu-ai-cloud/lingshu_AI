import { useEffect, useMemo, useRef } from 'react';
import { voiceoverDraftCoversSource, selectCompleteVoiceoverSource } from './studioVoiceoverRules';
import { detectScriptLanguageCode } from './studioLanguageRules';
import type { StudioVoiceLifecyclePorts } from './studioVoiceLifecyclePorts.js';

export function useStudioVoiceSourceModel(ports: Pick<StudioVoiceLifecyclePorts,
  | "script"
  | "voiceoverLines"
  | "voiceDrafts"
  | "activeVoiceLang"
  | "voiceoverMode"
  | "voiceoverStaleLangs"
  | "voiceoverAudios"
  | "voiceoverUrl"
  | "voiceoverDur"
  | "alignedCuesByLang"
>) {
  const {
    script, voiceoverLines, voiceDrafts,
    activeVoiceLang, voiceoverMode, voiceoverStaleLangs,
    voiceoverAudios, voiceoverUrl, voiceoverDur,
  } = ports;
  const masterSourceVoiceover = useMemo(
    () => selectCompleteVoiceoverSource(script, voiceoverLines),
    [script, voiceoverLines],
  );
  const masterSourceLanguage = detectScriptLanguageCode(masterSourceVoiceover || script);
  const activeSpokenScript = voiceDrafts[activeVoiceLang] || masterSourceVoiceover || script;
  const activeVoiceoverAudio = voiceoverMode === 'ai' && !voiceoverStaleLangs.includes(activeVoiceLang)
    ? voiceoverAudios[activeVoiceLang]
    : undefined;
  const activeVoiceoverUrl = voiceoverMode === 'none'
    ? ''
    : voiceoverMode === 'ai'
      ? activeVoiceoverAudio?.url || ''
      : voiceoverUrl || '';
  const activeVoiceDuration = voiceoverMode === 'none'
    ? 0
    : voiceoverMode === 'ai'
      ? activeVoiceoverAudio?.duration || 0
      : voiceoverDur;
  const voiceoverForLanguage = (code: string) => {
    const {
      alignedCuesByLang,
    } = ports;

    if (voiceoverMode === 'none') return { url: '', duration: 0, cues: alignedCuesByLang[code] || [] };
    if (voiceoverMode === 'ai') {
      if (voiceoverStaleLangs.includes(code)) return { url: '', duration: 0, cues: [] };
      const audio = voiceoverAudios[code];
      return {
        url: audio?.url || '',
        duration: audio?.duration || 0,
        cues: alignedCuesByLang[code] || audio?.cues || [],
      };
    }
    const isActiveUpload = code === activeVoiceLang;
    return {
      url: isActiveUpload ? voiceoverUrl || '' : '',
      duration: isActiveUpload ? voiceoverDur : 0,
      cues: alignedCuesByLang[code] || [],
    };
  };

  return { masterSourceVoiceover, masterSourceLanguage, activeSpokenScript, activeVoiceoverAudio, activeVoiceoverUrl, activeVoiceDuration, voiceoverForLanguage };
}

export function useStudioVoiceDraftFreshness(ports: Pick<StudioVoiceLifecyclePorts,
  | "script"
  | "voiceDrafts"
  | "setVoiceDraftStaleLangs"
  | "voiceLangs"
  | "masterSourceLanguage"
>) {
  const {
    script, masterSourceLanguage, voiceDrafts,
    voiceLangs,
  } = ports;
  const masterScriptSnapshot = useRef(script);
  useEffect(() => {
    const {
      setVoiceDraftStaleLangs,
    } = ports;

    if (masterScriptSnapshot.current !== script && Object.keys(voiceDrafts).length) {
      setVoiceDraftStaleLangs(current => [...new Set([...current, ...voiceLangs.filter(code => code !== masterSourceLanguage)])]);
    }
    masterScriptSnapshot.current = script;
  }, [masterSourceLanguage, script, voiceDrafts, voiceLangs]);

  return { masterScriptSnapshot };
}

export function createStudioVoiceReadiness(ports: Pick<StudioVoiceLifecyclePorts,
  | "voiceLangs"
  | "voiceDrafts"
  | "voiceoverAudios"
  | "masterSourceVoiceover"
  | "voiceoverStaleLangs"
  | "voiceDraftFailedLangs"
  | "voiceDraftStaleLangs"
  | "voiceDraftPendingLangs"
  | "alignedCuesByLang"
  | "voiceoverMode"
  | "voiceoverUrl"
>) {
  const {
    voiceLangs, voiceoverMode, voiceoverUrl,
    voiceoverAudios,
  } = ports;
  const hasRequestedVoiceDrafts = voiceLangs.length > 0 && voiceLangs.every(code => {
    const {
      voiceDrafts, masterSourceVoiceover, voiceoverStaleLangs,
      voiceDraftFailedLangs, voiceDraftStaleLangs, voiceDraftPendingLangs,
    } = ports;
    return Boolean((voiceDrafts[code] || voiceoverAudios[code]?.text)?.trim())
      && (voiceoverDraftCoversSource(masterSourceVoiceover, voiceDrafts[code] || voiceoverAudios[code]?.text || '')
        || (Boolean(voiceoverAudios[code]?.url) && !voiceoverStaleLangs.includes(code)))
      && !voiceDraftFailedLangs.includes(code)
      && !voiceDraftStaleLangs.includes(code)
      && !voiceDraftPendingLangs.includes(code);
  });
  const hasRequestedVoiceovers = voiceLangs.length > 0 && voiceLangs.every(code => {
    const {
      voiceoverStaleLangs,
    } = ports;
    return Boolean(voiceoverAudios[code]?.url) && !voiceoverStaleLangs.includes(code);
  });
  const hasRequestedSubtitles = voiceLangs.length > 0 && voiceLangs.every(code => {
    const {
      alignedCuesByLang,
    } = ports;
    return Boolean(alignedCuesByLang[code]?.length);
  });
  const hasReadyVoiceStrategy = voiceoverMode === 'none'
    || (voiceoverMode === 'upload' && Boolean(voiceoverUrl))
    || (voiceoverMode === 'ai' && hasRequestedVoiceovers);
  const hasAnyVoiceover = Object.entries(voiceoverAudios).some(([code, audio]) => {
    const {
      voiceoverStaleLangs,
    } = ports;
    return Boolean(audio?.url) && !voiceoverStaleLangs.includes(code);
  });

  return { hasRequestedVoiceDrafts, hasRequestedVoiceovers, hasRequestedSubtitles, hasReadyVoiceStrategy, hasAnyVoiceover };
}

export function createStudioVoiceWorkflowSource(ports: Pick<StudioVoiceLifecyclePorts,
  | "voiceoverLines"
  | "extractVoiceoverText"
  | "script"
  | "voiceLangs"
>) {
  const {
    voiceoverLines, extractVoiceoverText, script,
    voiceLangs,
  } = ports;
  const workflowSourceLanguage = detectScriptLanguageCode(voiceoverLines || extractVoiceoverText(script)) || voiceLangs[0] || 'zh';

  return { workflowSourceLanguage };
}
