import { fileToDataUrl } from '../../lib/studioFileInputs';
import { studioApi, type SubCue, type TtsStyleOptions } from '../../lib/studioApi';
import { isMeasuredVoiceAlignment } from '../../lib/voiceoverAlignment';
import { durationForUnfixedNarration, narrationForUnfixedShots } from '../../lib/narrationTimeline';
import { storyboardSlotScript } from './studioStoryboardMaterialMatching';
import { withStudioTimeout } from './studioAuthenticatedMedia';
import { stripVoiceoverTimestamps, voiceoverDraftCoversSource, selectCompleteVoiceoverSource } from './studioVoiceoverRules';
import { parsePronunciationRules } from './studioSubtitleCues';
import { LANGS, detectScriptLanguageCode, normalizeScriptTimestamps } from './studioLanguageRules';
import { probeAudioDuration } from './studioMediaProbes.js';
import { DEFAULT_TTS_SETTINGS } from './studioWorkspaceCatalog.js';
import { publicVoiceFailureReason } from './studioAsyncSupport.js';
import { resolveTranslatedVoiceover } from './studioVoiceTranslation.js';
import type { StudioVoiceLifecyclePorts } from './studioVoiceLifecyclePorts.js';

export function createStudioVoiceSynthesisActions(ports: Pick<StudioVoiceLifecyclePorts,
  | "setVoiceoverMode"
  | "setVoiceoverUrl"
  | "setVoiceoverDur"
  | "setVoiceoverAudios"
  | "setAlignedCuesByLang"
  | "setUploadedVoiceName"
  | "setTtsNotice"
  | "setTtsPlaying"
  | "ttsAudioRef"
  | "setTtsLoading"
  | "setTtsLoadingScope"
  | "activeVoiceLang"
  | "setVoiceoverStaleLangs"
  | "setRenderOutputPath"
  | "setRenderOutputPreviewUrl"
  | "setLanguageRenderOutputs"
  | "setLanguageRenderVersions"
  | "setStoryboardVideoVersions"
  | "setProductVideoVersions"
  | "setSubtitlesOn"
  | "setSubMode"
  | "activeSpokenScript"
  | "lang"
  | "setVoiceoverLines"
  | "setVoiceDrafts"
  | "setVoice"
  | "setCustomVoiceId"
  | "setCustomVoiceName"
  | "setCustomVoiceUrl"
  | "setCustomVoices"
  | "setVoiceCandidates"
  | "setAudioCapabilities"
  | "ttsRequestRef"
  | "script"
  | "voiceoverLines"
  | "extractVoiceoverText"
  | "voiceLangs"
  | "setTtsActiveLangs"
  | "setTtsFailuresByLang"
  | "voiceoverAudios"
  | "voiceDrafts"
  | "alignedCuesByLang"
  | "storyboardSlots"
  | "hasAvatarSourceVoice"
  | "storyboardTimelineEnd"
  | "ttsLanguageSettings"
  | "mode"
  | "useReferenceVoiceStyle"
  | "referenceVoice"
  | "duration"
  | "threeStepWorkflow"
  | "presentationMode"
  | "voice"
  | "setVoiceDraftStaleLangs"
  | "setActiveVoiceLang"
  | "setLang"
>) {

  const clearVoiceover = () => {
    const {
      setVoiceoverMode, setVoiceoverUrl, setVoiceoverDur,
      setVoiceoverAudios, setAlignedCuesByLang, setUploadedVoiceName,
      setTtsNotice, setTtsPlaying, ttsAudioRef,
    } = ports;

    setVoiceoverMode('none');
    setVoiceoverUrl(null);
    setVoiceoverDur(0);
    setVoiceoverAudios({});
    setAlignedCuesByLang({});
    setUploadedVoiceName('');
    setTtsNotice('');
    setTtsPlaying(false);
    if (ttsAudioRef.current) ttsAudioRef.current.pause();
  };

  const handleVoiceoverUpload = async (files: FileList | null) => {
    const {
      setTtsLoading, setTtsLoadingScope, setVoiceoverMode,
      setVoiceoverUrl, setVoiceoverDur, setVoiceoverAudios,
      activeVoiceLang, setVoiceoverStaleLangs, setRenderOutputPath,
      setRenderOutputPreviewUrl, setLanguageRenderOutputs, setLanguageRenderVersions,
      setStoryboardVideoVersions, setProductVideoVersions, setUploadedVoiceName,
      setSubtitlesOn, setSubMode, activeSpokenScript,
      setTtsNotice, lang, setVoiceoverLines,
      setVoiceDrafts, setAlignedCuesByLang,
    } = ports;

    const f = files?.[0];
    if (!f) return;
    setTtsLoading(true);
    setTtsLoadingScope('upload');
    try {
      const [dataBase64, duration] = await Promise.all([fileToDataUrl(f), probeAudioDuration(f)]);
      const r = await studioApi.uploadVoiceover({ name: f.name, dataBase64, mimeType: f.type, duration });
      if (!r.ok || !r.url) throw new Error(r.error || '口播音频上传失败');
      setVoiceoverMode('upload');
      setVoiceoverUrl(r.url);
      setVoiceoverDur(r.duration || duration);
      setVoiceoverAudios({ [activeVoiceLang || 'zh']: { url: r.url, duration: r.duration || duration } });
      setVoiceoverStaleLangs(current => current.filter(code => code !== (activeVoiceLang || 'zh')));
      setRenderOutputPath(null);
      setRenderOutputPreviewUrl(null);
      setLanguageRenderOutputs({});
      setLanguageRenderVersions({});
      setStoryboardVideoVersions({});
      setProductVideoVersions([]);
      setUploadedVoiceName(f.name);
      setSubtitlesOn(true);
      setSubMode('target');
      const audioDuration = r.duration || duration;
      const transcriptHint = stripVoiceoverTimestamps(activeSpokenScript);
      if (audioDuration > 0) {
        setTtsNotice('口播已上传，正在识别语音并生成字幕时间轴…');
        const transcription = await studioApi.transcribeVoiceover({
          url: r.url,
          duration: audioDuration,
          language: activeVoiceLang || lang,
          transcriptHint,
        });
        if (transcription.ok && transcription.matches !== false && transcription.text && transcription.cues?.length) {
          const code = activeVoiceLang || 'zh';
          setVoiceoverLines(transcription.text);
          setVoiceDrafts(current => ({ ...current, [code]: transcription.text }));
          setAlignedCuesByLang(current => ({ ...current, [code]: transcription.cues }));
          setVoiceoverAudios({ [code]: { url: r.url, duration: audioDuration, cues: transcription.cues, text: transcription.text, alignmentSource: transcription.source } });
          setTtsNotice(transcription.source === 'audio_ai' || transcription.source === 'qwen_asr'
            ? '已根据上传音频自动识别口播，并生成逐句/逐词字幕时间轴。'
            : '已生成字幕时间轴；当前使用脚本比例对齐，建议播放后人工确认。');
        } else {
          setTtsNotice(`音频已上传，${transcription.matches === false ? '识别内容与当前台词不一致，未覆盖文案。' : transcription.error || '请点击千问转写/刷新，确认提交或读取已有任务。'}`);
        }
      }
    } catch (err: any) {
      alert(err?.message || '口播音频上传失败，请稍后重试。');
    } finally {
      setTtsLoading(false);
      setTtsLoadingScope(null);
    }
  };

  const handleVoiceSampleUpload = async (files: FileList | null) => {
    const {
      setTtsLoading, setTtsLoadingScope, setVoice,
      setCustomVoiceId, setCustomVoiceName, setCustomVoiceUrl,
      setCustomVoices, setVoiceCandidates, setVoiceoverMode,
      setVoiceoverUrl, setVoiceoverAudios, setAudioCapabilities,
      setTtsNotice,
    } = ports;

    const f = files?.[0];
    if (!f) return;
    setTtsLoading(true);
    setTtsLoadingScope('upload');
    try {
      const [dataBase64, duration] = await Promise.all([fileToDataUrl(f), probeAudioDuration(f)]);
      const r = await studioApi.uploadVoiceSample({ name: f.name, dataBase64, mimeType: f.type, duration });
      if (!r.ok || !r.voiceId) throw new Error(r.error || '真人音色录入失败');
      setVoice(r.voiceId);
      setCustomVoiceId(r.voiceId);
      setCustomVoiceName(r.name || f.name);
      setCustomVoiceUrl(r.url || '');
      setCustomVoices(current => [{ voiceId: r.voiceId!, name: r.name || f.name, url: r.url || '', duration: r.duration || duration, createdAt: new Date().toISOString() }, ...current.filter(item => item.voiceId !== r.voiceId)]);
      setVoiceCandidates(current => current.includes(r.voiceId!) ? current : [...current, r.voiceId!]);
      setVoiceoverMode('ai');
      setVoiceoverUrl(null);
      setVoiceoverAudios({});
      setAudioCapabilities(current => current ? {
        ...current,
        customVoice: { ...current.customVoice, synthesis: Boolean(r.synthesisReady), message: r.warning || (r.synthesisReady ? `真人音色合成可用（${r.engine === 'xtts' ? 'XTTS/Coqui' : 'MiniMax'}）` : current.customVoice.message) },
      } : current);
      setTtsNotice(r.synthesisReady
        ? `已录入真人音色，可通过 ${r.engine === 'xtts' ? 'XTTS/Coqui' : 'MiniMax'} 生成配音。`
        : `声音样本已保存，但暂不能合成：${r.warning || '服务器未配置真人音色克隆引擎。'}`);
    } catch (err: any) {
      alert(err?.message || '真人音色录入失败，请检查音频文件后重试。');
    } finally {
      setTtsLoading(false);
      setTtsLoadingScope(null);
    }
  };

  const genTts = async (onlyLanguage?: string) => {
    const {
      ttsRequestRef, setTtsLoading, setTtsLoadingScope,
      script, voiceoverLines, extractVoiceoverText,
      voiceLangs, setTtsActiveLangs, setTtsFailuresByLang,
      setTtsNotice, voiceoverAudios, setVoiceoverStaleLangs,
      setVoiceoverUrl, setAlignedCuesByLang, voiceDrafts,
      setVoiceoverLines, setVoiceDrafts, alignedCuesByLang,
      storyboardSlots, hasAvatarSourceVoice, storyboardTimelineEnd,
      ttsLanguageSettings, mode, useReferenceVoiceStyle,
      referenceVoice, duration, threeStepWorkflow,
      presentationMode, voice, activeVoiceLang,
      setVoiceoverMode, setVoiceoverAudios, setRenderOutputPath,
      setRenderOutputPreviewUrl, setLanguageRenderOutputs, setLanguageRenderVersions,
      setStoryboardVideoVersions, setProductVideoVersions, setVoiceDraftStaleLangs,
      setActiveVoiceLang, setLang, setVoiceoverDur,
      setUploadedVoiceName, setSubtitlesOn, setSubMode,
    } = ports;

    const requestId = ++ttsRequestRef.current;
    const isCurrentTtsRequest = () => ttsRequestRef.current === requestId;
    setTtsLoading(true);
    setTtsLoadingScope(onlyLanguage ? 'single' : 'all');
    const completeSourceVoiceover = selectCompleteVoiceoverSource(script, voiceoverLines);
    const detectedSourceLanguage = detectScriptLanguageCode(completeSourceVoiceover || extractVoiceoverText(script));
    const requestedLangs = onlyLanguage ? [onlyLanguage] : (voiceLangs.length ? voiceLangs : [detectedSourceLanguage]);
    const failureReasonsByLang: Record<string, string> = {};
    setTtsActiveLangs(requestedLangs);
    setTtsFailuresByLang(current => Object.fromEntries(Object.entries(current).filter(([code]) => !requestedLangs.includes(code))));
    setTtsNotice(`正在生成 ${requestedLangs.length} 个语种配音...`);
    const existingRequestedAudioCodes = requestedLangs.filter(code => Boolean(voiceoverAudios[code]?.url));
    if (existingRequestedAudioCodes.length) setVoiceoverStaleLangs(current => [...new Set([...current, ...existingRequestedAudioCodes])]);
    if (!onlyLanguage) {
      setVoiceoverUrl(null);
      setAlignedCuesByLang({});
    }
    try {
      const langs = requestedLangs;
      const base = completeSourceVoiceover || extractVoiceoverText(script) || script;
      const sourceLanguage = detectScriptLanguageCode(base);
      const drafts: Record<string, string> = { ...voiceDrafts, [sourceLanguage]: base };
      const missingTranslationLangs: string[] = [];
      const targetsToTranslate: string[] = [];
      for (const code of langs) {
        if (code === sourceLanguage) {
          drafts[sourceLanguage] = base;
        } else if (drafts[code]?.trim() && voiceoverDraftCoversSource(base, drafts[code])) {
          continue;
        } else {
          delete drafts[code];
          targetsToTranslate.push(code);
        }
      }
      if (targetsToTranslate.length) {
        const translated = await studioApi.translateBatch({ text: normalizeScriptTimestamps(base), targets: targetsToTranslate, source: sourceLanguage })
          .catch((err: any) => ({ ok: false, translations: {} as Record<string, string>, error: err?.message || '请求失败' }));
        for (const code of targetsToTranslate) {
          let raw = translated.translations?.[code] || '';
          let normalized = raw.trim()
            ? resolveTranslatedVoiceover(base, raw, code)
            : '';
          if (!normalized.trim()) {
            const single = await withStudioTimeout(studioApi.translate({ text: normalizeScriptTimestamps(base), target: code, source: sourceLanguage }))
              .catch(() => ({ ok: false, text: '' }));
            if (!isCurrentTtsRequest()) return;
            raw = single.ok ? single.text : '';
            normalized = raw.trim() ? resolveTranslatedVoiceover(base, raw, code) : '';
          }
          if (normalized.trim()) drafts[code] = normalized;
          else missingTranslationLangs.push(`${code}:${translated.error || '模型未返回有效译文'}`);
        }
      }
      if (!isCurrentTtsRequest()) return;
      setVoiceoverLines(base);
      setVoiceDrafts(drafts);

      const audios: Record<string, { url: string; duration: number; cues?: SubCue[]; text?: string; alignmentSource?: string; customVoiceStatus?: 'activated' }> = { ...voiceoverAudios };
      const aligned: Record<string, SubCue[]> = onlyLanguage ? { ...alignedCuesByLang } : {};
      const generatedCodes = new Set<string>();
      const failures: string[] = [];
      const availableLangs = langs.filter(code => drafts[code]?.trim());
      const sourceReferenceLines = stripVoiceoverTimestamps(base).split(/\n+/).map(line => line.trim()).filter(Boolean);
      const voiceLockedShots = storyboardSlots.map(slot => ({
        narration: storyboardSlotScript(slot.detail).voice,
        targetDuration: Math.max(0.5, slot.end - slot.start),
        lockedSourceVoice: hasAvatarSourceVoice(slot),
      }));
      const hasVoiceLockedShots = voiceLockedShots.some(shot => shot.lockedSourceVoice);
      const unfixedTargetDuration = hasVoiceLockedShots
        ? durationForUnfixedNarration(voiceLockedShots, sourceReferenceLines)
        : storyboardTimelineEnd;
      const ttsJobs = availableLangs.map(code => {
        const draftLines = stripVoiceoverTimestamps(drafts[code]).split(/\n+/).map(line => line.trim()).filter(Boolean);
        const sentenceLines = hasVoiceLockedShots
          ? narrationForUnfixedShots(voiceLockedShots, draftLines, code === sourceLanguage ? undefined : sourceReferenceLines)
          : draftLines;
        const text = hasVoiceLockedShots ? sentenceLines.join('\n') : drafts[code];
        if (!text.trim()) throw new Error('当前分镜全部使用数字人原声，无需生成额外配音');
        const settings = ttsLanguageSettings[code] || DEFAULT_TTS_SETTINGS;
        const inheritReferenceRhythm = mode === 'clone' && useReferenceVoiceStyle && referenceVoice.available;
        const style: Partial<TtsStyleOptions> = {
          preset: settings.preset,
          emotion: inheritReferenceRhythm
            ? `${referenceVoice.emotion}；沿用对标口播的信息密度、能量推进和自然停顿，不复制原声音身份`
            : settings.emotion,
          emotionIntensity: inheritReferenceRhythm ? 78 : settings.emotionIntensity,
          speed: inheritReferenceRhythm ? referenceVoice.baseSpeed : settings.speed,
          targetDuration: (mode === 'material' || mode === 'clone') && unfixedTargetDuration > 0 ? unfixedTargetDuration : duration,
          pauseStyle: inheritReferenceRhythm ? 'natural' : settings.pauseStyle,
          pronunciations: parsePronunciationRules(settings.pronunciationText),
        };
        return { code, text, sentenceLines, measuredSentenceTiming: threeStepWorkflow && presentationMode === 'material', voiceId: settings.voiceId || voice, style };
      });
      const acceptTtsResult = (code: string, r: Awaited<ReturnType<typeof studioApi.tts>>) => {
        if (r.ok && r.url) {
          audios[code] = { url: r.url, duration: r.duration ?? 0, cues: r.cues, text: r.text, alignmentSource: r.alignmentSource, customVoiceStatus: r.customVoiceStatus };
          generatedCodes.add(code);
          if (r.cues?.length && isMeasuredVoiceAlignment(r.alignmentSource)) aligned[code] = r.cues;
          if (r.text?.trim() && !hasVoiceLockedShots) {
            // TTS providers return plain spoken text without storyboard
            // timestamps. Keep/rebuild the cue timeline here; replacing the
            // draft with plain text makes the completed audio fail the next
            // step's coverage gate after autosave or reload.
            drafts[code] = resolveTranslatedVoiceover(completeSourceVoiceover, r.text, code)
              || drafts[code]
              || r.text;
          }
        } else {
          const label = LANGS.find(item => item.code === code)?.label || code;
          const reason = publicVoiceFailureReason(r.error || (r.source === 'local' ? '后端连接失败或额度不可用' : '未返回音频'));
          failureReasonsByLang[code] = reason;
          failures.push(`${label}：${reason}`);
        }
      };
      if (onlyLanguage) {
        await Promise.all(ttsJobs.map(async job => {
          const result = await studioApi.tts({ text: stripVoiceoverTimestamps(job.text), sentenceLines: job.sentenceLines,
            measuredSentenceTiming: job.measuredSentenceTiming, voice: job.voiceId, language: job.code, style: job.style });
          acceptTtsResult(job.code, result);
        }));
      } else {
        const groups = new Map<string, typeof ttsJobs>();
        for (const job of ttsJobs) {
          const key = JSON.stringify({ voice: job.voiceId, style: job.style });
          groups.set(key, [...(groups.get(key) || []), job]);
        }
        for (const jobs of groups.values()) {
          if (!isCurrentTtsRequest()) return;
          const batch = await studioApi.ttsBatch({
            voice: jobs[0]!.voiceId,
            style: jobs[0]!.style,
            items: jobs.map(job => ({ code: job.code, language: job.code, text: stripVoiceoverTimestamps(job.text),
              sentenceLines: job.sentenceLines, measuredSentenceTiming: job.measuredSentenceTiming })),
          });
          for (const job of jobs) acceptTtsResult(job.code, batch.audios[job.code] || { ok: false, source: 'batch', error: batch.error || '批量配音未返回音频' });
        }
      }
      if (!isCurrentTtsRequest()) return;
      await Promise.all(Object.entries(audios).filter(([code]) => availableLangs.includes(code)).map(async ([code, audio]) => {
        const text = audio.text || ttsJobs.find(job => job.code === code)?.text || '';
        if (isMeasuredVoiceAlignment(audio.alignmentSource) && audio.cues?.length) {
          aligned[code] = audio.cues;
          return;
        }
        if (!text || !audio.url || !audio.duration) return;
        const result = await studioApi.alignTts({ text, url: audio.url, duration: audio.duration });
        if (result.ok && result.cues?.length && isMeasuredVoiceAlignment(result.source)) {
          audio.cues = result.cues;
          audio.alignmentSource = result.source;
          aligned[code] = result.cues;
        } else {
          audio.alignmentSource = 'pending_alignment';
          delete aligned[code];
        }
      }));
      if (!isCurrentTtsRequest()) return;
      const activeCode = langs.includes(activeVoiceLang) ? activeVoiceLang : langs[0] || 'zh';
      const activeAudio = generatedCodes.has(activeCode)
        ? audios[activeCode]
        : [...generatedCodes].map(code => audios[code]).find(Boolean);
      if (!activeAudio) {
        throw new Error(failures[0] || '没有生成可用配音，请检查 TTS Key 或试用额度。');
      }
      setVoiceoverMode('ai');
      setVoiceoverAudios(audios);
      setRenderOutputPath(null);
      setRenderOutputPreviewUrl(null);
      setLanguageRenderOutputs({});
      setLanguageRenderVersions({});
      setStoryboardVideoVersions({});
      setProductVideoVersions([]);
      setVoiceDrafts({ ...drafts });
      setVoiceDraftStaleLangs(current => current.filter(code => !availableLangs.includes(code)));
      setVoiceoverStaleLangs(current => current.filter(code => !generatedCodes.has(code)));
      setActiveVoiceLang(activeCode);
      setLang(activeCode);
      setVoiceoverUrl(activeAudio.url);
      setVoiceoverDur(activeAudio.duration);
      setUploadedVoiceName('');
      setSubtitlesOn(true);
      setSubMode('target');
      missingTranslationLangs.forEach(item => {
        const separatorIndex = item.indexOf(':');
        const code = separatorIndex >= 0 ? item.slice(0, separatorIndex) : item;
        const reason = separatorIndex >= 0 ? item.slice(separatorIndex + 1) : '翻译失败';
        failureReasonsByLang[code] = `翻译失败，未生成配音（${reason || '未知原因'}）`;
      });
      if (Object.keys(failureReasonsByLang).length) {
        setTtsFailuresByLang(current => ({ ...current, ...failureReasonsByLang }));
      }
      setTtsNotice(failures.length || missingTranslationLangs.length
        ? `本次已生成 ${availableLangs.length - failures.length}/${langs.length} 个语种配音；${[...failures, ...missingTranslationLangs.map(item => {
          const [code, reason] = item.split(':');
          return `${LANGS.find(langItem => langItem.code === code)?.label || code}：翻译失败，未生成配音（${reason || '未知原因'}）`;
        })].join('；')}`
        : voice.startsWith('custom:') && Object.values(audios).some(item => item.customVoiceStatus === 'activated')
          ? `已生成 ${langs.length} 个语种配音，真人音色已通过正式 TTS 激活并保存。下一步可一键生成字幕。`
          : `已生成 ${langs.length} 个语种配音。下一步可一键生成字幕。`);
    } catch (err: any) {
      if (!isCurrentTtsRequest()) return;
      const reason = err?.message || '配音生成失败，请稍后重试。';
      setTtsFailuresByLang(current => ({
        ...current,
        ...Object.fromEntries(requestedLangs.map(code => [code, failureReasonsByLang[code] || reason])),
      }));
      setTtsNotice(reason);
    } finally {
      if (isCurrentTtsRequest()) {
        setTtsLoading(false);
        setTtsLoadingScope(null);
        setTtsActiveLangs([]);
      }
    }
  };

  return { clearVoiceover, handleVoiceoverUpload, handleVoiceSampleUpload, genTts };
}
