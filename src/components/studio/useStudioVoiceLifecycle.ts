import { useEffect } from 'react';
import { studioApi } from '../../lib/studioApi';
import { isNonSpeechSfx } from './studioVoiceoverRules';
import { TTS_PRESETS } from './studioWorkspaceCatalog.js';
import type { StudioVoiceLifecyclePorts } from './studioVoiceLifecyclePorts.js';

export function useStudioVoiceTranslationCleanup(ports: Pick<StudioVoiceLifecyclePorts,
  | "voiceDraftAbortRef"
>) {
  useEffect(() => {
    const {
      voiceDraftAbortRef,
    } = ports;
    return () => voiceDraftAbortRef.current?.abort();
  }, []);
}

export function useStudioVoiceCatalog(ports: Pick<StudioVoiceLifecyclePorts,
  | "setAudioCapabilities"
  | "setCustomVoices"
  | "setVoiceCandidates"
>) {
  useEffect(() => {
    const {
      setAudioCapabilities, setCustomVoices, setVoiceCandidates,
    } = ports;

    void studioApi.audioCapabilities().then(setAudioCapabilities);
    void studioApi.listVoiceSamples().then(items => {
      setCustomVoices(items);
      if (items.length) setVoiceCandidates(current => [...new Set([...current, ...items.map(item => item.voiceId)])]);
    });
  }, []);
}

export function useStudioReferenceVoiceStyle(ports: Pick<StudioVoiceLifecyclePorts,
  | "mode"
  | "useReferenceVoiceStyle"
  | "setUseReferenceVoiceStyle"
  | "setTtsPreset"
  | "setTtsEmotion"
  | "setTtsEmotionIntensity"
  | "setTtsSpeed"
  | "setVoiceoverUrl"
  | "setVoiceoverAudios"
  | "setAlignedCuesByLang"
>) {
  const {
    mode, useReferenceVoiceStyle,
  } = ports;
  useEffect(() => {
    const {
      setUseReferenceVoiceStyle, setTtsPreset, setTtsEmotion,
      setTtsEmotionIntensity, setTtsSpeed, setVoiceoverUrl,
      setVoiceoverAudios, setAlignedCuesByLang,
    } = ports;

    if (mode === 'clone' || !useReferenceVoiceStyle) return;
    const fallback = TTS_PRESETS.find(item => item.id === 'authentic_review')!;
    setUseReferenceVoiceStyle(false);
    setTtsPreset(fallback.id);
    setTtsEmotion(fallback.emotion);
    setTtsEmotionIntensity(fallback.intensity);
    setTtsSpeed(fallback.speed);
    setVoiceoverUrl(null);
    setVoiceoverAudios({});
    setAlignedCuesByLang({});
  }, [mode, useReferenceVoiceStyle]);
}

export function useStudioReferenceVoicePresence(ports: Pick<StudioVoiceLifecyclePorts,
  | "mode"
  | "videoKickoff"
  | "setVoiceoverMode"
>) {
  const {
    mode, videoKickoff,
  } = ports;
  useEffect(() => {
    const {
      setVoiceoverMode,
    } = ports;

    if (mode !== 'clone' || !videoKickoff?.referenceAnalysis?.details?.length) return;
    const referenceHasVoice = videoKickoff.referenceAnalysis.details.some(item => !isNonSpeechSfx(item.dialogue || ''));
    setVoiceoverMode(referenceHasVoice ? 'ai' : 'none');
  }, [mode, videoKickoff]);
}
