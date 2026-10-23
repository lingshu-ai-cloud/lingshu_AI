import { useEffect } from 'react';
import { playAudioWithAuthenticatedFallback } from './studioAuthenticatedMedia';
import type { StudioVoiceLifecyclePorts } from './studioVoiceLifecyclePorts.js';

export function createStudioVoicePlaybackActions(ports: Pick<StudioVoiceLifecyclePorts,
  | "voiceoverAudios"
  | "setVoiceoverMode"
  | "setActiveVoiceLang"
  | "setLang"
  | "setVoiceoverUrl"
  | "setVoiceoverDur"
  | "ttsAudioRef"
  | "ttsLanguageSettings"
  | "voiceVol"
  | "setTtsPlaying"
  | "setTtsNotice"
>) {

  const playTtsForLang = (code: string) => {
    const {
      voiceoverAudios, setVoiceoverMode, setActiveVoiceLang,
      setLang, setVoiceoverUrl, setVoiceoverDur,
      ttsAudioRef, ttsLanguageSettings, voiceVol,
      setTtsPlaying, setTtsNotice,
    } = ports;

    const audio = voiceoverAudios[code];
    if (!audio?.url) return;
    setVoiceoverMode('ai');
    setActiveVoiceLang(code);
    setLang(code);
    setVoiceoverUrl(audio.url);
    setVoiceoverDur(audio.duration);
    const el = ttsAudioRef.current;
    if (!el) return;
    void playAudioWithAuthenticatedFallback(el, audio.url, ttsLanguageSettings[code]?.volume ?? voiceVol / 100)
      .then(() => setTtsPlaying(true))
      .catch((error: unknown) => {
        setTtsPlaying(false);
        const message = error instanceof Error ? error.message : String(error || '浏览器未能加载音频');
        setTtsNotice(`配音播放失败：${message}。请重新生成配音后再试。`);
      });
  };

  return { playTtsForLang };
}

export function useStudioActiveVoiceAudio(ports: Pick<StudioVoiceLifecyclePorts,
  | "voiceoverAudios"
  | "activeVoiceLang"
  | "voiceoverMode"
  | "setVoiceoverUrl"
  | "setVoiceoverDur"
>) {
  const {
    activeVoiceLang, voiceoverAudios, voiceoverMode,
  } = ports;
  useEffect(() => {
    const {
      setVoiceoverUrl, setVoiceoverDur,
    } = ports;

    const audio = voiceoverAudios[activeVoiceLang];
    if (!audio || voiceoverMode !== 'ai') return;
    setVoiceoverUrl(audio.url);
    setVoiceoverDur(audio.duration);
  }, [activeVoiceLang, voiceoverAudios, voiceoverMode]);
}

export function useStudioVoicePlaybackProgress(ports: Pick<StudioVoiceLifecyclePorts,
  | "ttsAudioRef"
  | "setTtsCurrentTime"
  | "cues"
  | "setSubPreviewIdx"
>) {
  const {
    cues,
  } = ports;
  useEffect(() => {
    const {
      ttsAudioRef, setTtsCurrentTime, setSubPreviewIdx,
    } = ports;

    const el = ttsAudioRef.current;
    if (!el) return;
    const update = () => {
      setTtsCurrentTime(el.currentTime);
      if (!cues.length) return;
      const current = cues.findIndex(cue => el.currentTime >= cue.start && el.currentTime < cue.end);
      if (current >= 0) setSubPreviewIdx(current);
    };
    el.addEventListener('timeupdate', update);
    return () => el.removeEventListener('timeupdate', update);
  }, [cues]);
}

export function useStudioVoicePlaybackStop(ports: Pick<StudioVoiceLifecyclePorts,
  | "step"
  | "ttsAudioRef"
  | "setTtsPlaying"
  | "setVoicePreviewIdx"
>) {
  const {
    step,
  } = ports;
  useEffect(() => {
    const {
      ttsAudioRef, setTtsPlaying, setVoicePreviewIdx,
    } = ports;

    if (step !== 'script' && ttsAudioRef.current) { ttsAudioRef.current.pause(); setTtsPlaying(false); }
    if (step !== 'script') setVoicePreviewIdx(null);
  }, [step]);
}
