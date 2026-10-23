import { studioApi } from '../../lib/studioApi';
import { formatVoiceoverWithTimestamps, selectCompleteVoiceoverSource } from './studioVoiceoverRules';
import { LANGS, langZh, detectScriptLanguageCode, normalizeScriptTimestamps } from './studioLanguageRules';
import { resolveTranslatedVoiceover, VOICE_TRANSLATION_BATCH_TIMEOUT_MS, VOICE_TRANSLATION_SINGLE_TIMEOUT_MS, runVoiceTranslationWithTimeout } from './studioVoiceTranslation.js';
import type { StudioVoiceLifecyclePorts } from './studioVoiceLifecyclePorts.js';

export function createStudioVoiceTranslationActions(ports: Pick<StudioVoiceLifecyclePorts,
  | "voiceDraftRunRef"
  | "voiceDraftAbortRef"
  | "scriptView"
  | "voiceoverLines"
  | "script"
  | "setVoiceoverLines"
  | "setVoiceDraftLoading"
  | "setVoiceDraftFailedLangs"
  | "setVoiceDraftPendingLangs"
  | "setVoiceDraftNotice"
  | "voiceLangs"
  | "setVoiceLangs"
  | "voiceoverAudios"
  | "setVoiceoverStaleLangs"
  | "voiceDrafts"
  | "setVoiceDrafts"
  | "setActiveVoiceLang"
  | "setLang"
  | "setScriptView"
  | "setVoiceDraftStaleLangs"
  | "studioSpecEpochRef"
  | "workflowSourceLanguage"
  | "voiceDraftLoading"
  | "setVoiceoverAudios"
  | "setAlignedCuesByLang"
  | "setTtsLanguageSettings"
  | "setTtsFailuresByLang"
  | "setRenderOutputPath"
  | "setRenderOutputPreviewUrl"
  | "setLanguageRenderOutputs"
  | "setLanguageRenderVersions"
  | "activeVoiceLang"
>) {

  const extractVoiceoverText = (value: string) => {
    return formatVoiceoverWithTimestamps(value);
  };

  const generateVoiceDrafts = async () => {
    const {
      voiceDraftRunRef, voiceDraftAbortRef, scriptView,
      voiceoverLines, script, setVoiceoverLines,
      setVoiceDraftLoading, setVoiceDraftFailedLangs, setVoiceDraftPendingLangs,
      setVoiceDraftNotice, voiceLangs, setVoiceLangs,
      voiceoverAudios, setVoiceoverStaleLangs, voiceDrafts,
      setVoiceDrafts, setActiveVoiceLang, setLang,
      setScriptView, setVoiceDraftStaleLangs,
    } = ports;

    const runId = ++voiceDraftRunRef.current;
    voiceDraftAbortRef.current?.abort();
    const controller = new AbortController();
    voiceDraftAbortRef.current = controller;
    const isCurrentRequest = () => voiceDraftAbortRef.current === controller;
    const sourceText = scriptView === 'voiceover' ? (voiceoverLines || script) : script;
    const base = selectCompleteVoiceoverSource(script, sourceText);
    setVoiceoverLines(base);
    setVoiceDraftLoading(true);
    setVoiceDraftFailedLangs([]);
    setVoiceDraftPendingLangs([]);
    setVoiceDraftNotice(`正在提取口播，并生成 ${voiceLangs.length || 1} 个语种文案...`);
    try {
      if (!base.trim()) {
        setVoiceDraftNotice('当前脚本里没有可提取的口播台词，请先生成时间戳脚本或手动填写口播台词。');
        return;
      }
      const sourceLanguage = detectScriptLanguageCode(base);
      const langs = [sourceLanguage, ...voiceLangs.filter(code => code !== sourceLanguage)];
      setVoiceLangs(langs);
      const existingAudioCodes = langs.filter(code => Boolean(voiceoverAudios[code]?.url));
      if (existingAudioCodes.length) setVoiceoverStaleLangs(current => [...new Set([...current, ...existingAudioCodes])]);
      const immediate: Record<string, string> = { ...voiceDrafts, [sourceLanguage]: normalizeScriptTimestamps(base) };
      setVoiceDrafts(immediate);
      setActiveVoiceLang(sourceLanguage);
      setLang(sourceLanguage);
      setScriptView('voiceover');

      const improved: Record<string, string> = { ...immediate };
      const targets = langs.filter(code => code !== sourceLanguage);
      setVoiceDraftPendingLangs(targets);
      setVoiceDraftNotice(targets.length
        ? `已识别${langZh(sourceLanguage) || sourceLanguage}口播，正在批量翻译 ${targets.length} 个语种；可切换到其他栏目，任务会继续在后台运行。`
        : '');
      const failedLangs = new Set<string>();
      const failureReasons = new Map<string, string>();
      let translateError = '';
      if (targets.length) {
        const translated = await runVoiceTranslationWithTimeout(
          signal => studioApi.translateBatch(
            { text: normalizeScriptTimestamps(base), targets, source: sourceLanguage },
            { signal },
          ),
          controller.signal,
          VOICE_TRANSLATION_BATCH_TIMEOUT_MS,
        ).catch((err: any) => ({ ok: false, translations: {} as Record<string, string>, error: err?.message || '请求失败' }));
        if (controller.signal.aborted) throw new DOMException('翻译已取消', 'AbortError');
        translateError = translated.error || '';
        const unresolved: string[] = [];
        for (const code of targets) {
          const raw = translated.translations?.[code] || '';
          const normalized = raw.trim()
            ? resolveTranslatedVoiceover(base, raw, code)
            : '';
          if (normalized.trim()) {
            improved[code] = normalized;
            setVoiceDrafts(current => ({ ...current, [code]: normalized }));
          } else {
            unresolved.push(code);
          }
        }
        setVoiceDraftPendingLangs(unresolved);
        if (unresolved.length) {
          setVoiceDraftNotice(`批量翻译已返回 ${targets.length - unresolved.length}/${targets.length} 个语种，正在并行重试其余 ${unresolved.length} 个...`);
          await Promise.all(unresolved.map(async code => {
            let normalized = '';
            let failureReason = translateError || '模型未返回有效译文';
            try {
              const single = await runVoiceTranslationWithTimeout(
                signal => studioApi.translate(
                  { text: normalizeScriptTimestamps(base), target: code, source: sourceLanguage },
                  { signal },
                ),
                controller.signal,
                VOICE_TRANSLATION_SINGLE_TIMEOUT_MS,
              );
              const raw = single.ok ? single.text : '';
              normalized = raw.trim() ? resolveTranslatedVoiceover(base, raw, code) : '';
              failureReason = single.error || failureReason;
            } catch (err: any) {
              failureReason = err?.message || failureReason;
            }
            if (controller.signal.aborted || !isCurrentRequest()) return;
            if (normalized.trim()) {
              improved[code] = normalized;
              setVoiceDrafts(current => ({ ...current, [code]: normalized }));
            } else {
              failedLangs.add(code);
              failureReasons.set(code, failureReason);
              setVoiceDraftFailedLangs(current => [...new Set([...current, code])]);
            }
            setVoiceDraftPendingLangs(current => current.filter(item => item !== code));
          }));
        }
      }
      if (controller.signal.aborted) throw new DOMException('翻译已取消', 'AbortError');
      if (!isCurrentRequest()) return;
      const failed = [...failedLangs];
      const firstFailureReason = failed.map(code => failureReasons.get(code)).find(Boolean) || translateError;
      setVoiceDrafts(improved);
      setVoiceDraftPendingLangs([]);
      setVoiceDraftFailedLangs(failed);
      setVoiceDraftNotice(failed.length
        ? `已生成 ${langs.length - failed.length}/${langs.length} 个语种；${failed.map(code => LANGS.find(item => item.code === code)?.label || code).join('、')} 翻译失败：${firstFailureReason || '模型未返回有效译文'}。可再次点击重试。`
        : '');
      setVoiceDraftStaleLangs(failed);
    } catch (err: any) {
      if (isCurrentRequest()) {
        setVoiceDraftPendingLangs([]);
        setVoiceDraftNotice(controller.signal.aborted
          ? '已取消翻译；已完成的语种已保留，未完成语种可重新翻译。'
          : (err?.message || '多语种字幕生成失败，请稍后重试。'));
      }
    } finally {
      if (isCurrentRequest()) {
        voiceDraftAbortRef.current = null;
        setVoiceDraftLoading(false);
      }
    }
  };

  const retryVoiceDraft = async (code: string) => {
    const {
      studioSpecEpochRef, scriptView, voiceoverLines,
      script, setVoiceDraftNotice, voiceoverAudios,
      setVoiceoverStaleLangs, setVoiceDraftPendingLangs, setVoiceDraftFailedLangs,
      setVoiceDrafts, setVoiceDraftStaleLangs,
    } = ports;

    const specEpoch = studioSpecEpochRef.current;
    const isCurrentSpec = () => studioSpecEpochRef.current === specEpoch;
    const sourceText = scriptView === 'voiceover' ? (voiceoverLines || script) : script;
    const base = extractVoiceoverText(sourceText);
    if (!base.trim()) {
      setVoiceDraftNotice('当前脚本没有可翻译的口播文案。');
      return;
    }
    const sourceLanguage = detectScriptLanguageCode(base);
    if (voiceoverAudios[code]?.url) setVoiceoverStaleLangs(current => [...new Set([...current, code])]);
    setVoiceDraftPendingLangs(current => [...new Set([...current, code])]);
    setVoiceDraftFailedLangs(current => current.filter(item => item !== code));
    try {
      const normalized = code === sourceLanguage
        ? normalizeScriptTimestamps(base)
        : await studioApi.translate({ text: normalizeScriptTimestamps(base), target: code, source: sourceLanguage })
          .then(result => result.ok && result.text.trim() ? resolveTranslatedVoiceover(base, result.text, code) : Promise.reject(new Error(result.error || '模型未返回有效译文')));
      if (!isCurrentSpec()) return;
      if (!normalized.trim()) throw new Error('模型未返回有效译文');
      setVoiceDrafts(current => ({ ...current, [code]: normalized }));
      setVoiceDraftStaleLangs(current => current.filter(item => item !== code));
      setVoiceDraftNotice(`${LANGS.find(item => item.code === code)?.label || code}文案已更新，其他已完成语言保持不变。`);
    } catch (error: unknown) {
      if (!isCurrentSpec()) return;
      const reason = error instanceof Error ? error.message : '翻译失败';
      setVoiceDraftFailedLangs(current => [...new Set([...current, code])]);
      setVoiceDraftNotice(`${LANGS.find(item => item.code === code)?.label || code}翻译失败：${reason}`);
    } finally {
      if (isCurrentSpec()) setVoiceDraftPendingLangs(current => current.filter(item => item !== code));
    }
  };

  const removeTranslationLanguage = (code: string) => {
    const {
      workflowSourceLanguage, voiceDraftLoading, voiceDraftAbortRef,
      setVoiceDraftLoading, setVoiceDraftPendingLangs, setVoiceDraftNotice,
      setVoiceLangs, setVoiceDrafts, setVoiceDraftStaleLangs,
      setVoiceDraftFailedLangs, setVoiceoverAudios, setVoiceoverStaleLangs,
      setAlignedCuesByLang, setTtsLanguageSettings, setTtsFailuresByLang,
      setRenderOutputPath, setRenderOutputPreviewUrl, setLanguageRenderOutputs,
      setLanguageRenderVersions, activeVoiceLang, setActiveVoiceLang,
      setLang,
    } = ports;

    if (!code || code === workflowSourceLanguage) return;
    if (voiceDraftLoading) {
      voiceDraftAbortRef.current?.abort();
      voiceDraftAbortRef.current = null;
      setVoiceDraftLoading(false);
      setVoiceDraftPendingLangs([]);
      setVoiceDraftNotice('已按新的语种选择停止上一次翻译；已完成的文案已保留。');
    }
    setVoiceLangs(current => [workflowSourceLanguage, ...current.filter(item => item !== workflowSourceLanguage && item !== code)]);
    setVoiceDrafts(current => { const next = { ...current }; delete next[code]; return next; });
    setVoiceDraftStaleLangs(current => current.filter(item => item !== code));
    setVoiceDraftPendingLangs(current => current.filter(item => item !== code));
    setVoiceDraftFailedLangs(current => current.filter(item => item !== code));
    setVoiceoverAudios(current => { const next = { ...current }; delete next[code]; return next; });
    setVoiceoverStaleLangs(current => current.filter(item => item !== code));
    setAlignedCuesByLang(current => { const next = { ...current }; delete next[code]; return next; });
    setTtsLanguageSettings(current => { const next = { ...current }; delete next[code]; return next; });
    setTtsFailuresByLang(current => { const next = { ...current }; delete next[code]; return next; });
    // Render combinations encode language in their key. Clearing generated
    // outputs is safer than publishing a version for a language the user has
    // explicitly removed.
    setRenderOutputPath(null);
    setRenderOutputPreviewUrl(null);
    setLanguageRenderOutputs({});
    setLanguageRenderVersions({});
    if (activeVoiceLang === code) {
      setActiveVoiceLang(workflowSourceLanguage);
      setLang(workflowSourceLanguage);
    }
  };

  const toggleTranslationLanguage = (code: string) => {
    const {
      workflowSourceLanguage, voiceLangs, setVoiceLangs,
    } = ports;

    if (code === workflowSourceLanguage) return;
    if (voiceLangs.includes(code)) {
      removeTranslationLanguage(code);
      return;
    }
    setVoiceLangs(current => {
      const sourceFirst = [workflowSourceLanguage, ...current.filter(item => item !== workflowSourceLanguage)];
      return [...sourceFirst, code];
    });
  };

  return { extractVoiceoverText, generateVoiceDrafts, retryVoiceDraft, removeTranslationLanguage, toggleTranslationLanguage };
}
