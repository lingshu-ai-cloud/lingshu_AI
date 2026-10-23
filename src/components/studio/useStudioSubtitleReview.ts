import { applyCaptionTextEdits, sourceCaptionEditKey, subtitleReviewCues } from '../../lib/subtitleReview';
import { useEffect, useMemo } from 'react';
import { studioApi, type SubCue } from '../../lib/studioApi';
import { productionVoiceCues } from '../../lib/voiceoverAlignment';
import { arrangeShotsWithinNarration, sourceCuesForShot, voiceoverMatchesNarrationSources } from '../../lib/narrationTimeline';
import { storyboardSlotScript } from './studioStoryboardMaterialMatching';
import { stripVoiceoverTimestamps } from './studioVoiceoverRules';
import { buildCues } from './studioSubtitleCues';
import { LANGS } from './studioLanguageRules';
import { SUBTITLE_FONTS } from './studioFontCatalog.js';
import type { StudioVoiceLifecyclePorts } from './studioVoiceLifecyclePorts.js';

export function createStudioSubtitleActions(ports: Pick<StudioVoiceLifecyclePorts,
  | "setSubtitleGenerating"
  | "setSubtitleNotice"
  | "alignedCuesByLang"
  | "voiceLangs"
  | "voiceDrafts"
  | "voiceoverAudios"
  | "voiceoverDur"
  | "totalDur"
  | "duration"
  | "setAlignedCuesByLang"
  | "setSubtitlesOn"
>) {

  const generateSubtitleDrafts = async () => {
    const {
      setSubtitleGenerating, setSubtitleNotice, alignedCuesByLang,
      voiceLangs, voiceDrafts, voiceoverAudios,
      voiceoverDur, totalDur, duration,
      setAlignedCuesByLang, setSubtitlesOn,
    } = ports;

    setSubtitleGenerating(true);
    setSubtitleNotice('正在按每个语言的真实口播时长生成字幕文案…');
    try {
      const next: Record<string, SubCue[]> = { ...alignedCuesByLang };
      const failed: string[] = [];
      for (const code of voiceLangs) {
        const text = voiceDrafts[code]?.trim();
        if (!text) {
          failed.push(LANGS.find(item => item.code === code)?.label || code);
          continue;
        }
        const audio = voiceoverAudios[code];
        const generated = audio?.cues?.length
          ? audio.cues
          : buildCues(text, audio?.duration || voiceoverDur || totalDur || duration);
        if (generated.length) next[code] = generated;
        else failed.push(LANGS.find(item => item.code === code)?.label || code);
      }
      setAlignedCuesByLang(next);
      setSubtitlesOn(true);
      setSubtitleNotice(failed.length
        ? `其余语言字幕已生成；${failed.join('、')}缺少可用文案，请先补全文案。`
        : `已生成 ${voiceLangs.length} 个语言的字幕文案，可直接逐条调整。`);
    } finally {
      setSubtitleGenerating(false);
    }
  };

  return { generateSubtitleDrafts };
}

export function useStudioSubtitlePreviewModel(ports: Pick<StudioVoiceLifecyclePorts,
  | "alignedCuesByLang"
  | "activeVoiceLang"
  | "activeSpokenScript"
  | "activeVoiceDuration"
  | "totalDur"
  | "subtitleStyle"
>) {
  const {
    activeSpokenScript, activeVoiceDuration, activeVoiceLang,
    alignedCuesByLang, totalDur, subtitleStyle,
  } = ports;
  const cues = useMemo(() => alignedCuesByLang[activeVoiceLang]?.length
    ? alignedCuesByLang[activeVoiceLang]
    : buildCues(activeSpokenScript, activeVoiceDuration || totalDur), [activeSpokenScript, activeVoiceDuration, activeVoiceLang, alignedCuesByLang, totalDur]);
  const subtitlePreviewStyle = { color: subtitleStyle.color, fontFamily: SUBTITLE_FONTS.find(item => item.id === subtitleStyle.font)?.css || SUBTITLE_FONTS[0]!.css, fontSize: `${Math.round(12 * subtitleStyle.fontScale)}px`, WebkitTextStroke: `${subtitleStyle.outlineWidth / 3}px ${subtitleStyle.outlineColor}`, textShadow: `0 1px 3px ${subtitleStyle.outlineColor}` };

  return { cues, subtitlePreviewStyle };
}

export function useStudioSubtitleReviewModel(ports: Pick<StudioVoiceLifecyclePorts,
  | "alignedCuesByLang"
  | "activeVoiceLang"
  | "voiceoverAudios"
  | "activeSpokenScript"
  | "voiceDrafts"
  | "masterSourceLanguage"
  | "masterSourceVoiceover"
  | "storyboardSlots"
  | "hasAvatarSourceVoice"
  | "voiceoverMode"
  | "setVoiceoverStaleLangs"
  | "presentationMode"
  | "materialById"
  | "storyboardAssignments"
  | "editForSlot"
  | "sourceCuesForMaterial"
  | "digitalHumanJob"
  | "sourceCaptionTextEdits"
  | "activeVoiceoverUrl"
  | "setSourceCaptionTextEdits"
  | "invalidateMusicRender"
>) {
  const {
    alignedCuesByLang, activeVoiceLang, voiceoverAudios,
    voiceoverMode, storyboardSlots, presentationMode,
    digitalHumanJob, sourceCaptionTextEdits,
  } = ports;
  const narrationMeasuredCues = productionVoiceCues(
    alignedCuesByLang[activeVoiceLang] || voiceoverAudios[activeVoiceLang]?.cues,
    voiceoverAudios[activeVoiceLang]?.alignmentSource,
    voiceoverAudios[activeVoiceLang]?.duration || 0,
  );
  const voiceoverMatchesCurrentShotSources = (code: string) => {
    const {
      activeSpokenScript, voiceDrafts, masterSourceLanguage,
      masterSourceVoiceover, hasAvatarSourceVoice,
    } = ports;

    const audio = voiceoverAudios[code];
    if (!audio?.url) return true;
    const lines = stripVoiceoverTimestamps(code === activeVoiceLang ? activeSpokenScript : voiceDrafts[code] || '')
      .split(/\n+/).map(line => line.trim()).filter(Boolean);
    const referenceLines = code === masterSourceLanguage ? undefined
      : stripVoiceoverTimestamps(masterSourceVoiceover).split(/\n+/).map(line => line.trim()).filter(Boolean);
    const sourceText = audio.text || audio.cues?.map(cue => cue.text).join(' ') || '';
    return voiceoverMatchesNarrationSources(storyboardSlots.map(slot => ({
      narration: storyboardSlotScript(slot.detail).voice, targetDuration: slot.end - slot.start,
      lockedSourceVoice: hasAvatarSourceVoice(slot),
    })), lines, sourceText, referenceLines);
  };
  const activeVoiceoverSourceMismatch = voiceoverMode === 'ai' && Boolean(voiceoverAudios[activeVoiceLang]?.url)
    && !voiceoverMatchesCurrentShotSources(activeVoiceLang);
  useEffect(() => {
    const {
      setVoiceoverStaleLangs,
    } = ports;

    if (activeVoiceoverSourceMismatch) setVoiceoverStaleLangs(current => current.includes(activeVoiceLang)
      ? current : [...current, activeVoiceLang]);
  }, [activeVoiceoverSourceMismatch, activeVoiceLang]);
  const narrationArrangementPreview = (() => {
    const {
      materialById, storyboardAssignments, editForSlot,
      hasAvatarSourceVoice, sourceCuesForMaterial, activeSpokenScript,
      masterSourceLanguage, masterSourceVoiceover,
    } = ports;

    const audio = voiceoverAudios[activeVoiceLang];
    const measured = narrationMeasuredCues;
    if (voiceoverMode !== 'ai' || !measured.length || !storyboardSlots.length || presentationMode !== 'material') return null;
    if (activeVoiceoverSourceMismatch) return { result: null, error: '数字人原声分镜归属已变化，现有配音仍包含旧台词，请重新生成非数字人口播' };
    try {
      return { result: arrangeShotsWithinNarration(storyboardSlots.map(slot => {
          const clip = materialById.get(storyboardAssignments[slot.id] || '');
          const edit = clip ? editForSlot(clip, slot) : undefined;
          const lockedSourceVoice = hasAvatarSourceVoice(slot);
          return { targetDuration: edit?.targetDuration || slot.end - slot.start,
            targetStart: slot.start, targetEnd: slot.end,
            trimStart: lockedSourceVoice ? 0 : edit?.trimStart || 0,
            trimEnd: lockedSourceVoice ? clip?.duration || slot.end - slot.start : edit?.trimEnd || slot.end - slot.start,
            narration: storyboardSlotScript(slot.detail).voice,
            lockedSourceVoice,
            lockedDuration: lockedSourceVoice ? clip?.duration || slot.end - slot.start : undefined,
            sourceCues: lockedSourceVoice ? sourceCuesForMaterial(clip, slot) : undefined };
        }), stripVoiceoverTimestamps(activeSpokenScript).split(/\n+/).map(line => line.trim()).filter(Boolean),
          measured, audio!.duration, audio!.alignmentSource || '',
          activeVoiceLang === masterSourceLanguage ? undefined : stripVoiceoverTimestamps(masterSourceVoiceover).split(/\n+/).map(line => line.trim()).filter(Boolean)), error: '' };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : '口播与分镜尚未对齐' };
    }
  })();
  const subtitleReviewAiCues = alignedCuesByLang[activeVoiceLang] || voiceoverAudios[activeVoiceLang]?.cues || [];
  const subtitleReviewTimeline = narrationArrangementPreview?.result?.timeline || storyboardSlots.map(slot => {
    const {
      materialById, storyboardAssignments, hasAvatarSourceVoice,
      editForSlot, sourceCuesForMaterial,
    } = ports;

    const clip = materialById.get(storyboardAssignments[slot.id] || '');
    const lockedSourceVoice = hasAvatarSourceVoice(slot);
    return { targetDuration: lockedSourceVoice ? clip?.duration || slot.end - slot.start
        : clip ? editForSlot(clip, slot).targetDuration || slot.end - slot.start : slot.end - slot.start,
      lockedSourceVoice, sourceCues: lockedSourceVoice ? sourceCuesForMaterial(clip, slot) : undefined };
  });
  const subtitleReviewBaseRows = presentationMode !== 'material' && digitalHumanJob?.subtitleCues?.length
    ? applyCaptionTextEdits(digitalHumanJob.subtitleCues, digitalHumanJob.id, digitalHumanJob.outputMaterialId, sourceCaptionTextEdits).map((cue, cueIndex) => ({ ...cue, source: 'job' as const, cueIndex, shotIndex: undefined }))
    : narrationArrangementPreview?.result || voiceoverMode === 'none'
      ? narrationArrangementPreview?.result
        ? narrationArrangementPreview.result.cues.map((cue, cueIndex) => {
          const source = subtitleReviewCues(subtitleReviewTimeline, []).find(row => Math.abs(row.start - cue.start) < .002 && Math.abs(row.end - cue.end) < .002 && row.text === cue.text);
          return source || { ...cue, source: 'ai' as const, cueIndex, shotIndex: undefined };
        }) : subtitleReviewCues(subtitleReviewTimeline, [])
      : [...subtitleReviewCues(subtitleReviewTimeline, []), ...subtitleReviewAiCues.map((cue, cueIndex) => ({ ...cue, source: 'ai' as const, cueIndex, shotIndex: undefined }))];
  const subtitleReviewRows = subtitleReviewBaseRows.map(row => {
    const {
      activeVoiceoverUrl,
    } = ports;

    const editKey = row.source === 'ai'
      ? sourceCaptionEditKey(`voice:${activeVoiceLang}:${activeVoiceoverUrl || ''}`, undefined, row) : '';
    return { ...row, editKey, text: editKey ? sourceCaptionTextEdits[editKey] ?? row.text : row.text };
  });
  const editReviewedSubtitle = (row: (typeof subtitleReviewRows)[number], text: string) => {
    const {
      setSourceCaptionTextEdits, materialById, storyboardAssignments,
      invalidateMusicRender,
    } = ports;

    if (row.source === 'job') {
      const cue = digitalHumanJob?.subtitleCues?.[row.cueIndex];
      if (!digitalHumanJob || !cue) return;
      setSourceCaptionTextEdits(current => ({ ...current, [sourceCaptionEditKey(digitalHumanJob.id, digitalHumanJob.outputMaterialId, cue)]: text }));
    } else if (row.source === 'source' && row.shotIndex !== undefined) {
      const slot = storyboardSlots[row.shotIndex];
      const clip = slot ? materialById.get(storyboardAssignments[slot.id] || '') : undefined;
      if (!clip) return;
      const raw = digitalHumanJob?.outputMaterialId === clip.id && digitalHumanJob.subtitleCues?.length
        ? digitalHumanJob.subtitleCues : clip.transcriptCues;
      const cue = sourceCuesForShot(raw, clip.duration)[row.cueIndex];
      if (!cue) return;
      setSourceCaptionTextEdits(current => ({ ...current, [sourceCaptionEditKey(clip.id, clip.contentSha256, cue)]: text }));
    } else {
      setSourceCaptionTextEdits(current => ({ ...current, [row.editKey]: text }));
    }
    invalidateMusicRender();
  };
  const narrationAudioHasMeasuredCues = Boolean(narrationMeasuredCues.length);

  return { narrationMeasuredCues, voiceoverMatchesCurrentShotSources, activeVoiceoverSourceMismatch, narrationArrangementPreview, subtitleReviewAiCues, subtitleReviewTimeline, subtitleReviewBaseRows, subtitleReviewRows, editReviewedSubtitle, narrationAudioHasMeasuredCues };
}

export function useStudioBilingualSubtitles(ports: Pick<StudioVoiceLifecyclePorts,
  | "step"
  | "subtitlesOn"
  | "subMode"
  | "lang"
  | "cues"
  | "setCueZh"
>) {
  const {
    step, subtitlesOn, subMode,
    lang, cues,
  } = ports;
  useEffect(() => {
    const {
      setCueZh,
    } = ports;

    if (step !== 'preview' || !subtitlesOn || subMode !== 'bilingual' || lang === 'zh' || cues.length === 0) {
      setCueZh([]); return;
    }
    let cancelled = false;
    (async () => {
      const zh = await Promise.all(cues.map(c => studioApi.translate({ text: c.text, target: 'zh' }).then(r => (r.ok ? r.text : ''))));
      if (!cancelled) setCueZh(zh);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, subtitlesOn, subMode, lang, cues]);
}

export function useStudioSubtitlePreviewBounds(ports: Pick<StudioVoiceLifecyclePorts,
  | "subPreviewIdx"
  | "cues"
  | "setSubPreviewIdx"
>) {
  const {
    cues, subPreviewIdx,
  } = ports;
  useEffect(() => {
    const {
      setSubPreviewIdx,
    } = ports;
    if (subPreviewIdx >= cues.length) setSubPreviewIdx(0); }, [cues.length, subPreviewIdx]);
}
