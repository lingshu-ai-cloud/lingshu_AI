import StudioOperationalEvidencePanel from '../socialContent/StudioOperationalEvidencePanel';
import ShotSourceDecisionPanel from './ShotSourceDecisionPanel';
import { salesPresenterRecognition } from '../../../shared/contracts/presenterShotRecognition';
import { socialContentApi } from '../../lib/socialContentApi';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Mic, Loader2, Upload, X, ChevronDown } from 'lucide-react';
import { type CoverStyle, type TtsStyleOptions } from '../../lib/studioApi';
import { type EffectIntensity, type EffectPresetId } from '../../../shared/contracts/effectPlan';
import SocialContentOrderOperations from '../socialContent/SocialContentOrderOperations';
import EnterprisePresenters from '../enterprise/EnterprisePresenters';
import DigitalHumanProductionOverview from './DigitalHumanProductionOverview';
import { patchShot } from '../../lib/shotProduction';
import { productionApi } from '../../lib/productionApi';
import { storyboardSlotScript } from './studioStoryboardMaterialMatching';
import { isAutomaticViralMaterialCandidate } from './studioSourceMaterial';
import { detectScriptLanguageCode } from './studioLanguageRules';
import { VOICES, TTS_PRESETS, DEFAULT_TTS_SETTINGS } from './studioWorkspaceCatalog.js';
import { SUBTITLE_FONTS } from './studioFontCatalog.js';
import { publicVoiceFailureReason } from './studioAsyncSupport.js';
import type { StepId } from './studioWorkspaceContracts.js';
import type { StudioPropertyPanelViewInputs } from './studioPropertyPanelViewInputs.js';

export function renderStudioPropertyPanel(input: StudioPropertyPanelViewInputs) {
  const {
    threeStepWorkflow, step, setProductionDefaults,
    setModeNotice, frozenStudioSpecRef, frozenOperationalEvidence,
    socialContentTaskId, setSceneReworkTask, subtitleSourceBlockReason,
    avatarCaptionBusy, projectId, refreshAvatarSourceCaptions,
    subtitleNotice, workbenchHasFormalVideo, replicationNeedsVoiceover,
    startReplicationRender, rendering, batchRenderingLangs,
    ttsLoading, freeCanGenerateVoiceover, voiceoverAlignmentBlockReason,
    replicationTimingBlocked, renderPct, voice,
    setVoice, setTtsLanguageSettings, activeVoiceLang,
    setVoiceoverStaleLangs, invalidateMusicRender, customVoices,
    replicationSpeechSpeed, setReplicationSpeechSpeed, activeVoiceoverUrl,
    workbenchProductionPanel, subtitlesOn, setSubtitlesOn,
    effectPreset, setEffectPreset, effectIntensity,
    setEffectIntensity, effectSoundsOn, setEffectSoundsOn,
    socialViralTask, modeActionLoading, replicationPreparationError,
    modeActionStatus, generateSetupScriptAndContinue, replicationConfirmedLinesRef,
    navigateReplicationStep, aigcBudgetPreview, activeWorkbenchSlot,
    storyboardTopicFor, presenterEvidenceFor, sourcePlanFor,
    productionFor, canRequestShootingFor, chooseReplicationShotMode,
    storyboardAssignments, materialById, videoKickoff,
    activeWorkbenchClip, editForSlot, activeMaterialAssessment,
    setCanvasView, setPreviewClip, setShotLibraryError,
    setShotLibrarySlotId, clearWorkbenchMaterial, openProduction,
    createBoundShootingTask, materialSelectLoading, smartSelectMaterialsFast,
    shootingBusy, storyboardGenerating, generateStoryboardShot,
    batchShotSummary, batchShotResults, focusWorkbenchStoryboardSlot,
    storyboardSlots, agentSourceContext, focusProductContext,
    contentMode, setupReadiness, mode,
    onNavigate, stageIdx, assignedCount,
    bgm, cover, activeSteps,
    setStepIdx, hasTimestampScript, hasRequestedVoiceDrafts,
    hasReadyVoiceStrategy, hasRequestedSubtitles, setScriptStageTab,
    scriptStageTab, activeSlotTime, setShowFullScriptEditor,
    showFullScriptEditor, presentationMode, presentationSources,
    setPresentationSources, setRendered, setRenderOutputPath,
    setRenderOutputPreviewUrl, updateWorkbenchStoryboardSlot, script,
    applyTimestampScript, storyboardFeasibility, referenceRecoveryMessage,
    languageSwitcher, activeVoiceDuration, totalDur,
    voiceDrafts, enterpriseScriptLanguage, voiceoverLines,
    extractVoiceoverText, setVoiceDrafts, setVoiceDraftFailedLangs,
    setVoiceDraftStaleLangs, voiceLangs, setTtsFailuresByLang,
    setVoiceoverLines, voiceDraftNotice, voiceDraftFailedLangs,
    retryVoiceDraft, voiceoverInputRef, handleVoiceoverUpload,
    clearVoiceover, setVoiceoverMode, voiceoverMode,
    uploadedVoiceName, ttsNotice, setShowVoiceAdvanced,
    showVoiceAdvanced, activeTtsSettings, patchActiveTtsSettings,
    voiceoverAudios, voiceCandidates, ttsPreset,
    setTtsPreset, ttsEmotion, setTtsEmotion,
    ttsSpeed, setTtsSpeed, voiceVol,
    playTtsForLang, ttsPlaying, coverFrameUrl,
    selectedClips, subtitleStyle, subtitlePreviewStyle,
    alignedCuesByLang, cues, generateSubtitleDrafts,
    subtitleGenerating, activeLanguageLabel, setAlignedCuesByLang,
    setShowSubtitleAdvanced, showSubtitleAdvanced, subMode,
    setSubMode, setSubtitleStyle, shootingTasks,
    activeAssemblyId, shootingSlots, shootingError,
    setApplyDigitalToSales, setStoryboardSourcePlans, setShotProductions,
    productionKey, setShootingError, heygenAvatarId,
    setHeygenAvatarId, setHeygenBindingConsent, heygenAvatars,
    heygenAvatarOrientation, setHeygenAvatarOrientation, heygenBindingConsent,
    heygenAvatarBinding, bindHeygenAvatarToShot, productionFingerprint,
    productionDefaults, productionPlans, productionExecutions,
    setProductionEditorId, setProductionError, savingProj,
    autosaveStatus, autosaveError, saveProject,
    renderReadiness, narrationArrangementPreview, currentRenderReviewed,
    previewRenderBlockers, missingAvatarSourceCues, narrationAudioHasMeasuredCues,
    narrationMeasuredCues, storyboardSpeechGroups, hasAvatarSourceVoice,
    patchStoryboardClipEdit, voiceoverStaleLangs, handleVoiceSampleUpload,
    genTts, subtitleReviewRows, editReviewedSubtitle,
    renderTimeline, disabledEffectSceneIds, setDisabledEffectSceneIds,
    renderStep,
  } = input;

  return (
    (
      <>
        {threeStepWorkflow && step === 'material' && <EnterprisePresenters contentProduction onInitialSelection={() => {
          void productionApi.defaults().then(setProductionDefaults).catch(error => setModeNotice(error instanceof Error ? error.message : '数字人形象刷新失败'));
        }} />}
        {frozenStudioSpecRef.current?.resolvedStudioContract && <StudioOperationalEvidencePanel contract={{...(frozenStudioSpecRef.current.resolvedStudioContract as Parameters<typeof StudioOperationalEvidencePanel>[0]['contract']),operationalEvidence:frozenOperationalEvidence}} />}
        {socialContentTaskId && <SocialContentOrderOperations key={socialContentTaskId} taskId={socialContentTaskId}
          onChanged={() => { void socialContentApi.getTask(socialContentTaskId).then(setSceneReworkTask).catch(() => undefined); }} />}
        {threeStepWorkflow && step === 'preview' ? (
          <section className="space-y-3" aria-label="成片操作">
            {subtitleSourceBlockReason && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5">
              <p>{subtitleSourceBlockReason}</p>
              <button type="button" disabled={avatarCaptionBusy || !projectId} onClick={() => void refreshAvatarSourceCaptions()} className="mt-2 w-full rounded-lg border border-amber-400 bg-white px-3 py-2 font-bold disabled:opacity-50">{avatarCaptionBusy ? '正在补取原声字幕…' : '补取原声字幕'}</button>
              <p className="mt-1 text-[10px] text-text-muted">优先读取已有字幕；需要付费转写时会单独确认。</p>
            </div>}
            {subtitleNotice && <p role="status" className="text-xs leading-5 text-text-secondary">{subtitleNotice}</p>}
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
              <p className="text-sm font-semibold text-text-primary">生成成片</p>
              <p className="mt-1 text-[11px] text-text-muted">生成镜头使用口播脚本字幕，按镜头时长显示；已有实测字幕时沿用实测时间码。</p>
              <p className="mt-1 text-[11px] leading-5 text-text-secondary">{workbenchHasFormalVideo ? '效果调整后，可在这里重新生成。' : replicationNeedsVoiceover ? '点击后自动生成配音并渲染成片。' : '点击后开始渲染成片。'}</p>
              <button type="button" onClick={startReplicationRender} disabled={rendering || batchRenderingLangs || ttsLoading || Boolean(subtitleSourceBlockReason) && !freeCanGenerateVoiceover || Boolean(voiceoverAlignmentBlockReason) && !replicationNeedsVoiceover || replicationTimingBlocked} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-xs font-semibold text-white shadow-none hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                {(rendering || batchRenderingLangs || ttsLoading) && <Loader2 size={15} className="animate-spin" />}
                {rendering || batchRenderingLangs ? `正在生成 ${renderPct}%` : ttsLoading ? '正在生成配音…' : workbenchHasFormalVideo ? '重新生成成片' : replicationNeedsVoiceover ? '生成配音并渲染成片' : '生成成片'}
              </button>
            </div>

            <details className="rounded-lg border border-border bg-white p-3" aria-label="调整效果">
              <summary className="cursor-pointer text-xs font-semibold text-text-primary">调整效果</summary>
              <div className="mt-4 space-y-4 border-t border-border pt-4">
                <section aria-label="配音设置">
                  <p className="text-[11px] font-semibold text-text-primary">配音</p>
                  <label className="mt-2 block text-[10px] font-bold text-text-secondary">音色<select aria-label="配音音色" value={voice} onChange={event => { setVoice(event.target.value); setTtsLanguageSettings(current => ({ ...current, [activeVoiceLang]: { ...(current[activeVoiceLang] || DEFAULT_TTS_SETTINGS), voiceId: event.target.value } })); setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]); invalidateMusicRender(); }} className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs">{[...VOICES, ...customVoices.map(item => ({ id: item.voiceId, name: item.name }))].map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  <label className="mt-2 block text-[10px] font-bold text-text-secondary">语速 · {replicationSpeechSpeed.toFixed(2)} 倍<input aria-label="配音语速" type="range" min="0.85" max="1.30" step="0.05" value={replicationSpeechSpeed} onChange={event => { const speed = Number(event.target.value); setReplicationSpeechSpeed(speed); setTtsLanguageSettings(current => ({ ...current, [activeVoiceLang]: { ...(current[activeVoiceLang] || DEFAULT_TTS_SETTINGS), speed } })); setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]); invalidateMusicRender(); }} className="mt-2 w-full accent-blue-600" /></label>
                  {activeVoiceoverUrl && <audio src={activeVoiceoverUrl} controls aria-label="成片配音试听" className="mt-2 w-full" />}
                </section>
                <section className="border-t border-border pt-3" aria-label="配乐设置"><p className="mb-2 text-[11px] font-semibold text-text-primary">配乐</p>{workbenchProductionPanel}</section>
                <section className="border-t border-border pt-3" aria-label="字幕设置">
                  <p className="text-[11px] font-semibold text-text-primary">字幕</p>
                  <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={subtitlesOn} onChange={event => { setSubtitlesOn(event.target.checked); invalidateMusicRender(); }} />显示字幕</label>
                </section>
                <section className="border-t border-border pt-3" aria-label="动效设置">
                  <p className="text-[11px] font-semibold text-text-primary">画面动效</p>
                  <select aria-label="动效风格" value={effectPreset} onChange={event => { setEffectPreset(event.target.value as EffectPresetId); invalidateMusicRender(); }} className="mt-2 w-full rounded border border-border p-2 text-xs"><option value="natural">自然</option><option value="dynamic">动感</option><option value="tech">科技</option><option value="cinematic">电影</option></select>
                  <select aria-label="动效强度" value={effectIntensity} onChange={event => { setEffectIntensity(Number(event.target.value) as EffectIntensity); invalidateMusicRender(); }} className="mt-2 w-full rounded border border-border p-2 text-xs"><option value={0}>关闭</option><option value={1}>弱</option><option value={2}>中</option><option value={3}>强</option></select>
                  <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={effectSoundsOn} onChange={event => { setEffectSoundsOn(event.target.checked); invalidateMusicRender(); }} />跟随动效添加音效</label>
                </section>
              </div>
            </details>
          </section>
        ) : <div className="space-y-4">
          {socialViralTask && step !== 'mode' && step !== 'material' && (modeActionLoading || replicationPreparationError) && <div role={replicationPreparationError ? 'alert' : 'status'} aria-live="polite" className="flex shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950">
            {modeActionLoading && <Loader2 size={16} className="shrink-0 animate-spin" />}
            <span className="min-w-0 flex-1">{replicationPreparationError || modeActionStatus || '正在准备口播与分镜…'}{!replicationPreparationError && ' 可先查看分镜和素材。'}</span>
            {replicationPreparationError && <><button type="button" onClick={() => void generateSetupScriptAndContinue(replicationConfirmedLinesRef.current)} className="shrink-0 font-bold underline">重试口播准备</button><button type="button" onClick={() => void navigateReplicationStep(0)} className="shrink-0 underline">返回修改口播</button></>}
          </div>}
          {socialViralTask && step === 'material' && aigcBudgetPreview && aigcBudgetPreview.aigcShots > 0 && (
            <details className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-[10px] leading-5 text-sky-950" aria-label="智能生成成本测算">
              <summary className="cursor-pointer font-bold">智能生成成本测算 · {aigcBudgetPreview.aigcShots} 镜</summary>
              <p className="mt-2">本批计划上限 ¥{aigcBudgetPreview.batchBudgetCny.toFixed(2)}，并非账户余额。按每镜 4 秒估算：480p 约 ¥{aigcBudgetPreview.estimate480pCny.toFixed(2)}，720p 约 ¥{aigcBudgetPreview.estimate720pCny.toFixed(2)}；实际以确认的镜头时长和生成规格结算。</p>
              <p className="mt-1">超过计划上限的镜头不会自动提交，也不会因此产生生成费用。可逐镜改用已有企业素材，或调整本批任务预算。</p>
            </details>
          )}
          {socialViralTask && step === 'material' && activeWorkbenchSlot && (() => {
            const slot = activeWorkbenchSlot;
            const isPresenter = storyboardTopicFor(slot) === 'presenter' && salesPresenterRecognition(presenterEvidenceFor(slot)) === 'confirmed';
            const plan = sourcePlanFor(slot);
            const shot = productionFor(slot);
            const allowShooting = canRequestShootingFor(slot.id);
            const options = isPresenter
              ? [
                { id: 'video_twin', title: '视频数字人', detail: '复用已授权企业人物，自然口播' },
                { id: 'photo_talking', title: '照片数字人复刻', detail: '按原片构图与动作逐镜还原' },
              ] as const
              : [
                { id: 'local', title: '企业素材匹配', detail: '从已有视频和图片中选择画面' },
                { id: 'smart', title: '智能生成画面', detail: '有本地素材则参考，否则直接生成' },
                ...(allowShooting ? [{ id: 'shoot' as const, title: '列入待拍', detail: '创建拍摄任务，上传后回填' }] : []),
              ] as const;
            const selectedMode = isPresenter && plan.userSource !== 'material' && plan.userSource !== 'shoot'
              ? shot.digitalHuman?.presenterMode || 'video_twin'
              : plan.userSource === 'shoot' ? 'shoot' : plan.mode === 'ai' || plan.mode === 'hybrid' ? 'smart' : 'local';
            return <section aria-label={isPresenter ? '数字人分镜制作' : '非数字人分镜制作'} className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
              <div><p className="text-xs font-semibold text-text-primary">{isPresenter ? '数字人分镜' : '非数字人分镜'} · 制作模式</p><p className="mt-1 text-[10px] text-text-muted">先确认当前分镜的路线，再选择素材或打开制作设置。</p></div>
              {storyboardTopicFor(slot) === 'presenter' && !isPresenter && <p role="status" className="text-[10px] text-amber-700">人物口播推荐数字人制作；请先确认画面中的销售主讲人物，确认前可使用企业素材，其他兜底路线以服务端能力检查为准。</p>}
              <div className={`grid gap-2 ${isPresenter || !allowShooting ? 'grid-cols-2' : 'grid-cols-3'}`}>{options.map(option => <button key={option.id} type="button" aria-pressed={selectedMode === option.id} disabled={shot.locked} onClick={() => chooseReplicationShotMode(slot, option.id)} className={`min-w-0 rounded-lg border p-2 text-left disabled:opacity-50 ${selectedMode === option.id ? 'border-emerald-600 bg-white text-emerald-900 shadow-none' : 'border-border bg-white/70 text-text-secondary'}`}><span className="block text-[11px] font-semibold">{option.title}</span><span className="mt-1 block text-[9px] leading-4">{option.detail}</span></button>)}</div>
              {selectedMode === 'shoot' && !allowShooting ? <p role="status" className="text-[10px] leading-4 text-amber-700">原实拍选择等待服务端重新确认，当前不会创建新的拍摄任务。</p> : null}
              {!isPresenter && selectedMode === 'smart' && <p className="text-[10px] leading-4 text-text-secondary">{[storyboardAssignments[slot.id], plan.referenceClipId].some(id => { const clip = id ? materialById.get(id) : undefined; return clip && isAutomaticViralMaterialCandidate(clip, videoKickoff); }) ? '已关联本地素材，生成时自动作为参考。' : '暂无关联本地素材，生成时直接使用 AIGC。'}</p>}
              {activeWorkbenchClip && <div className="rounded-lg border border-border bg-white p-2 text-[10px]"><p className="font-bold text-text-primary">当前素材：{activeWorkbenchClip.name}</p><p className="mt-1 text-text-muted">{editForSlot(activeWorkbenchClip, slot).trimStart.toFixed(1)}–{editForSlot(activeWorkbenchClip, slot).trimEnd.toFixed(1)}s · {plan.matchReason || activeMaterialAssessment?.reason || '手动选择'}</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => { setCanvasView('creation'); setPreviewClip(activeWorkbenchClip); }} className="font-bold text-emerald-700">预览</button><button type="button" onClick={() => { setShotLibraryError(''); setShotLibrarySlotId(slot.id); }} className="font-bold text-emerald-700">更换</button><button type="button" onClick={() => clearWorkbenchMaterial(slot.id)} className="font-bold text-red-700">移除</button></div></div>}
              {isPresenter ? <><button type="button" onClick={() => openProduction(slot)} className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">配置数字人分镜</button>{allowShooting ? <button type="button" onClick={() => { chooseReplicationShotMode(slot, 'shoot'); void createBoundShootingTask(storyboardSlotScript(slot.detail).visual || slot.title, slot.id); }} className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold">列入待拍</button> : <p className="rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-semibold leading-4 text-amber-800">人物口播只能使用已选择的数字人形象；当前流程不允许新增待拍任务。</p>}</>
                : selectedMode === 'local' ? <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => { setShotLibraryError(''); setShotLibrarySlotId(slot.id); }} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">选择企业素材</button><button type="button" disabled={materialSelectLoading} onClick={() => void smartSelectMaterialsFast()} className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-50">一键分析匹配</button></div>
                  : selectedMode === 'shoot' ? allowShooting ? <button type="button" disabled={shootingBusy} onClick={() => void createBoundShootingTask(storyboardSlotScript(slot.detail).visual || slot.title, slot.id)} className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">创建待拍任务</button> : null
                    : <div className="space-y-2">
                      <button type="button" disabled={shot.locked || Boolean(storyboardGenerating[slot.id])} onClick={() => void generateStoryboardShot(slot, { ...plan, mode: plan.mode === 'hybrid' ? 'hybrid' : 'ai', decided: true, confirmed: false })} className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{storyboardGenerating[slot.id] ? '正在生成首帧…' : '生成首帧并预览'}</button>
                      {plan.error && <p role="alert" className="text-[10px] leading-4 text-red-700">{plan.error}</p>}
                    </div>}
            </section>;
          })()}
          {threeStepWorkflow && step === 'material' && (batchShotSummary || batchShotResults.length > 0) && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
              {batchShotSummary && <p role="status" className="mt-2 text-[10px] leading-4 text-emerald-950">已提交 {batchShotSummary.submitted} · 复用素材 {batchShotSummary.matched} · 待补素材 {batchShotSummary.needsMaterial} · 阻塞 {batchShotSummary.blocked}。已提交的数字人任务需等待候选生成和验收。</p>}
              {batchShotResults.length > 0 && <ol aria-label="逐镜批量制作结果" className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {batchShotResults.map((item, index) => <li key={`${item.shotId}-${index}`} className="rounded-lg border border-emerald-100 bg-white px-2.5 py-2 text-[10px] leading-4">
                  <button type="button" onClick={() => focusWorkbenchStoryboardSlot(item.slotId)} className="w-full text-left">
                    <span className="font-semibold text-text-primary">分镜 {storyboardSlots.findIndex(slot => slot.id === item.slotId) + 1 || index + 1}</span>
                    <span className={`ml-2 font-semibold ${item.state === 'blocked' ? 'text-red-700' : item.state === 'needs_material' ? 'text-amber-700' : 'text-emerald-700'}`}>{item.state === 'submitted' ? '已提交数字人' : item.state === 'matched' ? '已关联本地素材' : item.state === 'needs_material' ? '待补素材' : '阻塞'}</span>
                    <span className="mt-1 block break-words text-text-secondary">{item.reason || '未提供原因'}</span>
                  </button>
                </li>)}
              </ol>}
            </div>
          )}
          <section aria-label="本次创作信息" className="rounded-lg border border-sky-100 bg-sky-50/60 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-sky-700">本次创作信息</p>
            <dl className="mt-2 space-y-1.5 text-[10px] leading-4">
              <div className="flex gap-2"><dt className="shrink-0 text-text-muted">创作方式</dt><dd className="min-w-0 break-words font-bold text-text-primary">{agentSourceContext}</dd></div>
              <div className="flex gap-2"><dt className="shrink-0 text-text-muted">焦点产品</dt><dd className="min-w-0 break-words font-bold text-text-primary">{focusProductContext}</dd></div>
            </dl>
          </section>
          {contentMode === 'video' && step === 'mode' && (
            <section className={`rounded-lg border p-3 ${setupReadiness.status === 'ready' ? 'border-emerald-200 bg-emerald-50/60' : setupReadiness.status === 'adjustable' ? 'border-amber-200 bg-amber-50/60' : 'border-red-200 bg-red-50/60'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold text-text-primary">当前模式的创作依据</p>
                  <p className="mt-1 text-xs font-semibold text-text-primary">{setupReadiness.title}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold ${setupReadiness.status === 'ready' ? 'bg-emerald-100 text-emerald-700' : setupReadiness.status === 'adjustable' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                  {setupReadiness.status === 'ready' ? '可执行' : setupReadiness.status === 'adjustable' ? '可先继续' : '需补充'}
                </span>
              </div>
              <p className="mt-2 text-[10px] leading-4 text-text-secondary">{setupReadiness.detail}</p>
              {mode === 'clone' && setupReadiness.status === 'blocked' && <button type="button" onClick={() => onNavigate?.('socialInspiration')} className="mt-2 text-[10px] font-semibold text-amber-800 underline">前往灵感中心复核原片 →</button>}
            </section>
          )}
          {contentMode === 'video' && stageIdx === 2 && !socialViralTask && (
            <section className="border-b border-border pb-3" aria-label="成片制作任务">
              <p className="px-1 pb-2 text-[10px] font-bold text-text-muted">成片制作任务</p>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { id: 'material', label: '素材匹配', done: storyboardSlots.length > 0 && assignedCount === storyboardSlots.length },
                  { id: 'bgm', label: '配乐', done: Boolean(bgm) },
                  { id: 'cover', label: '封面', done: Boolean(cover) },
                  { id: 'preview', label: '合成输出', done: workbenchHasFormalVideo },
                ] as Array<{ id: StepId; label: string; done: boolean }>).map(task => {
                  const taskIndex = activeSteps.findIndex(item => item.id === task.id);
                  const active = step === task.id;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => { if (taskIndex >= 0) setStepIdx(taskIndex); }}
                      className={`flex min-w-0 items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-[11px] font-bold transition ${active ? 'border-slate-400 bg-white text-text-primary shadow-none' : 'border-transparent text-text-secondary hover:border-border hover:bg-white'}`}
                    >
                      <span className="truncate">{task.label}</span>
                      {task.done && <Check size={12} className="shrink-0 text-emerald-600" aria-label="已完成" />}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {step === 'script' && (
            <nav className="grid grid-cols-5 gap-1 rounded-lg bg-surface-2 p-1" aria-label="脚本与声音阶段">
              {([
                { id: 'theme' as const, label: '分镜脚本' },
                { id: 'voiceover' as const, label: '口播与翻译' },
                { id: 'audio' as const, label: '口播语音' },
                { id: 'subtitle' as const, label: '字幕文案' },
                { id: 'bgm' as const, label: '配乐' },
              ]).map(item => {
                const unavailable = item.id !== 'theme' && (!hasTimestampScript
                  || (item.id === 'audio' && !hasRequestedVoiceDrafts)
                  || (item.id === 'subtitle' && (!hasRequestedVoiceDrafts || !hasReadyVoiceStrategy))
                  || (item.id === 'bgm' && (!hasRequestedVoiceDrafts || !hasRequestedSubtitles)));
                return (
                  <button key={item.id} type="button" disabled={unavailable} title={unavailable ? '请按顺序完成前面的步骤' : undefined} onClick={() => setScriptStageTab(item.id)} className={`min-w-0 whitespace-nowrap rounded-lg px-0.5 py-2 text-[9px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${scriptStageTab === item.id ? 'bg-white text-text-primary shadow-none' : 'text-text-muted hover:text-text-secondary'}`}>
                    {item.label}
                  </button>
                );
              })}
            </nav>
          )}
          {step === 'script' && scriptStageTab === 'theme' && (
            <section className="space-y-3">
              {activeWorkbenchSlot ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div><p className="text-xs font-semibold text-text-primary">分镜 {storyboardSlots.findIndex(item => item.id === activeWorkbenchSlot.id) + 1}</p><p className="mt-0.5 text-[10px] text-text-muted">{activeSlotTime} · 修改后会同步更新完整脚本</p></div>
                    <button type="button" onClick={() => setShowFullScriptEditor(value => !value)} className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-bold text-text-secondary hover:bg-surface-2">{showFullScriptEditor ? '收起整稿' : '编辑完整脚本'}</button>
                  </div>
                  {presentationMode === 'heygen' && <label className="block text-xs font-bold">本镜画面来源<select className="mt-1 w-full rounded border p-2" value={presentationSources[activeWorkbenchSlot.id] || (storyboardSlots.indexOf(activeWorkbenchSlot) === 0 || storyboardSlots.indexOf(activeWorkbenchSlot) === storyboardSlots.length - 1 ? 'avatar' : 'material')} onChange={event => { setPresentationSources(prev => ({ ...prev, [activeWorkbenchSlot.id]: event.target.value as 'avatar' | 'material' })); setRendered(false); setRenderOutputPath(null); setRenderOutputPreviewUrl(null); }}><option value="avatar">数字人</option><option value="material">指定素材（在素材匹配中选择）</option></select></label>}
                  <label className="block text-[10px] font-bold text-text-secondary">当前分镜内容
                    <textarea value={activeWorkbenchSlot.detail} rows={8} onChange={event => updateWorkbenchStoryboardSlot(activeWorkbenchSlot.id, event.target.value)} className="mt-1.5 w-full resize-y rounded-lg border border-border bg-surface-2 p-3 text-xs leading-6 text-text-secondary outline-none focus:border-accent" />
                  </label>
                  {showFullScriptEditor && <label className="block border-t border-border pt-3 text-[10px] font-bold text-text-secondary">完整时间轴脚本<textarea value={script} rows={12} onChange={event => applyTimestampScript(event.target.value)} className="mt-1.5 w-full resize-y rounded-lg border border-border bg-white p-3 font-mono text-[11px] leading-5 text-text-secondary outline-none focus:border-accent" /></label>}
                  <div className={`rounded-lg border p-3 ${storyboardFeasibility.status === 'ready' ? 'border-emerald-200 bg-emerald-50/60' : storyboardFeasibility.status === 'adjustable' ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-surface-2'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div><p className="text-[10px] font-semibold text-text-primary">制作可行性摘要</p><p className="mt-1 text-[10px] leading-4 text-text-secondary">脚本完成不代表画面已经齐全；这里按镜头功能检查，不按文件数量判断。</p></div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold ${storyboardFeasibility.status === 'ready' ? 'bg-emerald-100 text-emerald-700' : storyboardFeasibility.status === 'adjustable' ? 'bg-amber-100 text-amber-700' : 'bg-white text-text-muted'}`}>{storyboardFeasibility.status === 'ready' ? '可直接制作' : storyboardFeasibility.status === 'adjustable' ? '建议确认' : '存在素材缺口'}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-1.5">
                      <div className="rounded-lg bg-white px-2 py-2"><p className="text-[9px] text-text-muted">直接匹配</p><p className="mt-0.5 text-sm font-semibold text-emerald-700">{storyboardFeasibility.direct}</p></div>
                      <div className="rounded-lg bg-white px-2 py-2"><p className="text-[9px] text-text-muted">需确认</p><p className="mt-0.5 text-sm font-semibold text-amber-700">{storyboardFeasibility.review}</p></div>
                      <div className="rounded-lg bg-white px-2 py-2"><p className="text-[9px] text-text-muted">缺口</p><p className="mt-0.5 text-sm font-semibold text-red-600">{storyboardFeasibility.missing.length}</p></div>
                    </div>
                    {storyboardFeasibility.missing.length > 0 && <p className="mt-2 text-[10px] leading-4 text-text-secondary">缺少：{storyboardFeasibility.missing.slice(0, 3).map(item => item.slot.title || item.slot.time).join('、')}{storyboardFeasibility.missing.length > 3 ? ` 等 ${storyboardFeasibility.missing.length} 个镜头` : ''}。优先补真实素材；事实证明镜头不会用无关画面自动顶替。</p>}
                    <button type="button" onClick={() => { const materialIndex = activeSteps.findIndex(item => item.id === 'material'); if (materialIndex >= 0) setStepIdx(materialIndex); }} className="mt-3 w-full rounded-lg border border-border bg-white px-3 py-2 text-[10px] font-bold text-text-secondary hover:bg-surface-2">查看并处理素材方案</button>
                  </div>
                </>
              ) : <div className="rounded-lg border border-dashed border-border bg-surface-2 px-4 py-8 text-center text-xs text-text-muted">{referenceRecoveryMessage || '尚未生成分镜。参考分析完成后，可在当前工作台继续生成脚本与口播。'}</div>}
            </section>
          )}
          {step === 'script' && scriptStageTab !== 'theme' && (
            <div className="space-y-3">
              {scriptStageTab === 'voiceover' && <section className="space-y-3 pt-1">
                {languageSwitcher}
                {activeVoiceDuration > 0 && <p className={`rounded-lg border px-3 py-2 text-[10px] ${activeVoiceDuration > totalDur + .2 ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>实测口播 {activeVoiceDuration.toFixed(1)} 秒 · 当前分镜 {totalDur.toFixed(1)} 秒{activeVoiceDuration > totalDur + .2 ? '。口播超出分镜时长，请调整文案或延长分镜。' : '，时长可容纳。'}</p>}
                <div><p className="text-xs font-semibold text-text-primary">当前语言文案</p><p className="mt-0.5 text-[10px] text-text-muted">先选择需要的翻译语种，再用底部按钮一次生成全部文案。</p></div>
                <textarea
                  value={voiceDrafts[activeVoiceLang] || ((activeVoiceLang === enterpriseScriptLanguage || (!enterpriseScriptLanguage && activeVoiceLang === detectScriptLanguageCode(script))) ? (voiceoverLines || extractVoiceoverText(script)) : '')}
                  onChange={event => {
                    const nextValue = event.target.value;
                    const sourceLanguage = enterpriseScriptLanguage || detectScriptLanguageCode(script);
                    setVoiceDrafts(current => ({ ...current, [activeVoiceLang]: nextValue }));
                    setVoiceDraftFailedLangs(current => current.filter(code => code !== activeVoiceLang));
                    setVoiceDraftStaleLangs(current => activeVoiceLang === sourceLanguage
                      ? [...new Set([...current.filter(code => code !== activeVoiceLang), ...voiceLangs.filter(code => code !== activeVoiceLang)])]
                      : current.filter(code => code !== activeVoiceLang));
                    setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]);
                    setTtsFailuresByLang(current => { const next = { ...current }; delete next[activeVoiceLang]; return next; });
                    if (activeVoiceLang === sourceLanguage) setVoiceoverLines(nextValue);
                  }}
                  rows={5}
                  dir={activeVoiceLang === 'ar' ? 'rtl' : 'ltr'}
                  placeholder="输入该语言的口播文案"
                  className="w-full resize-y rounded-lg border border-border bg-surface-2 p-3 text-xs leading-6 text-text-secondary outline-none focus:border-accent"
                />
                {voiceDraftNotice && <div className={`rounded-lg border px-3 py-2 text-[10px] leading-4 ${voiceDraftFailedLangs.length ? 'border-red-200 bg-red-50 text-red-700' : 'border-border bg-surface-2 text-text-muted'}`}><p>{voiceDraftNotice}</p>{voiceDraftFailedLangs.includes(activeVoiceLang) && <button type="button" onClick={() => void retryVoiceDraft(activeVoiceLang)} className="mt-2 rounded-md border border-red-200 bg-white px-2 py-1 font-bold">重试当前语言</button>}</div>}
              </section>}

              {scriptStageTab === 'audio' && <section className="space-y-3 pt-1">
                {languageSwitcher}
                <input ref={voiceoverInputRef} type="file" accept="audio/*" className="hidden" onChange={event => { void handleVoiceoverUpload(event.target.files); event.target.value = ''; }} />
                <div><p className="text-xs font-semibold text-text-primary">声音策略</p><p className="mt-0.5 text-[10px] text-text-muted">先选策略，再用底部按钮一次生成所选语言口播。</p></div>
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    { id: 'ai' as const, label: 'AI 配音', icon: <Mic size={13} /> },
                    { id: 'upload' as const, label: '上传口播', icon: <Upload size={13} /> },
                    { id: 'none' as const, label: '无口播', icon: <X size={13} /> },
                  ]).map(option => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        if (option.id === 'none') clearVoiceover();
                        else if (option.id === 'ai') setVoiceoverMode('ai');
                        else voiceoverInputRef.current?.click();
                      }}
                      className={`flex min-w-0 flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[10px] font-bold transition ${voiceoverMode === option.id ? 'border-slate-400 bg-surface-2 text-text-primary' : 'border-border bg-white text-text-muted hover:bg-surface-2'}`}
                    >
                      {option.icon}<span className="truncate">{option.label}</span>
                    </button>
                  ))}
                </div>
                {(uploadedVoiceName || ttsNotice) && (
                  <div className={`rounded-lg border px-3 py-2 text-[10px] leading-4 ${/欠费|额度|余额|鉴权|失败|不可用/.test(ttsNotice) ? 'border-red-200 bg-red-50 text-red-700' : 'border-border bg-surface-2 text-text-muted'}`}>
                    <p>{uploadedVoiceName ? `已上传：${uploadedVoiceName}。` : ''}{ttsNotice ? publicVoiceFailureReason(ttsNotice) : ''}</p>
                    {/欠费|额度|余额|鉴权|失败|不可用/.test(ttsNotice) && <button type="button" onClick={() => voiceoverInputRef.current?.click()} className="mt-2 rounded-md border border-red-200 bg-white px-2 py-1 font-bold">改用上传口播</button>}
                  </div>
                )}
                {voiceoverMode === 'ai' && <div className="border-t border-border pt-3">
                  <button type="button" onClick={() => setShowVoiceAdvanced(value => !value)} className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-left text-[10px] font-semibold text-text-secondary"><span>高级设置 · 当前语言</span><ChevronDown size={13} className={`transition ${showVoiceAdvanced ? 'rotate-180' : ''}`} /></button>
                  {showVoiceAdvanced && <div className="mt-2 space-y-3 rounded-lg border border-border bg-surface-2 p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[10px] font-bold text-text-secondary">音色<select value={activeTtsSettings.voiceId || voice} onChange={event => { patchActiveTtsSettings({ voiceId: event.target.value }); if (voiceoverAudios[activeVoiceLang]?.url) setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]); }} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-[10px]">{voiceCandidates.map(item => <option key={item} value={item}>{VOICES.find(option => option.id === item)?.name || item}</option>)}</select></label>
                      <label className="text-[10px] font-bold text-text-secondary">风格<select value={ttsPreset} onChange={event => { setTtsPreset(event.target.value as TtsStyleOptions['preset']); if (voiceoverAudios[activeVoiceLang]?.url) setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]); }} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-[10px]">{TTS_PRESETS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                      <label className="col-span-2 text-[10px] font-bold text-text-secondary">情绪<select value={ttsEmotion} onChange={event => { setTtsEmotion(event.target.value); if (voiceoverAudios[activeVoiceLang]?.url) setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]); }} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-[10px]">{[...new Set(TTS_PRESETS.map(item => item.emotion))].map(item => <option key={item} value={item}>{item}</option>)}</select></label>
                    </div>
                    <label className="block text-[10px] font-bold text-text-secondary">全片统一语速 · {ttsSpeed.toFixed(1)}x<input type="range" min="0.7" max="1.3" step="0.05" value={ttsSpeed} onChange={event => { setTtsSpeed(Number(event.target.value)); if (voiceoverAudios[activeVoiceLang]?.url) setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]); }} className="mt-2 w-full accent-emerald-600" /></label>
                    <label className="block text-[10px] font-bold text-text-secondary">试听音量 · {Math.round((activeTtsSettings.volume ?? voiceVol / 100) * 100)}%<input type="range" min="0" max="1" step="0.05" value={activeTtsSettings.volume ?? voiceVol / 100} onChange={event => patchActiveTtsSettings({ volume: Number(event.target.value) })} className="mt-2 w-full accent-emerald-600" /></label>
                    {voiceoverAudios[activeVoiceLang]?.url && <button type="button" onClick={() => playTtsForLang(activeVoiceLang)} className="rounded-lg border border-border bg-white px-3 py-2 text-[10px] font-bold text-text-secondary">{ttsPlaying ? '暂停试听' : '试听当前语言'}</button>}
                  </div>}
                </div>}
              </section>
              }
              {scriptStageTab === 'subtitle' && <section className="space-y-3 pt-1">
                {languageSwitcher}
                <div className="mx-auto relative aspect-[9/16] w-36 overflow-hidden rounded-lg bg-slate-950" aria-label="真实画面字幕预览">
                  {(coverFrameUrl || selectedClips[0]?.poster) ? <img src={coverFrameUrl || selectedClips[0]?.poster} alt="当前素材预览帧" className="h-full w-full object-cover" /> : selectedClips[0]?.type === 'video' ? <video src={selectedClips[0].url} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : selectedClips[0]?.url && <img src={selectedClips[0].url} alt="当前素材预览帧" className="h-full w-full object-cover" />}
                  <div className="absolute inset-x-2 text-center" style={{ bottom: `${subtitleStyle.bottomRatio * 100}%` }}><span className="inline-block font-bold leading-tight whitespace-normal break-words" style={{ ...subtitlePreviewStyle, maxWidth: `${Math.min(100, subtitleStyle.lineWidth * 5)}%` }}>{(alignedCuesByLang[activeVoiceLang] || cues)[0]?.text || '字幕效果预览'}</span></div>
                </div>
                <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold text-text-primary">字幕文案</p><p className="mt-0.5 text-[10px] text-text-muted">按已生成的文案和真实口播时长生成字幕。</p></div>{hasRequestedSubtitles && <button type="button" onClick={() => void generateSubtitleDrafts()} disabled={subtitleGenerating} className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-bold text-text-secondary">重新生成</button>}</div>
                {subtitleNotice && <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-[10px] leading-4 text-text-muted">{subtitleNotice}</p>}
                <div className="rounded-lg border border-border bg-surface-2 px-3 py-3"><p className="text-[10px] font-bold text-text-secondary">{activeLanguageLabel}</p><p className="mt-1 text-xs font-semibold text-text-primary">{alignedCuesByLang[activeVoiceLang]?.length || 0} 条字幕</p></div>
                <div>
                  <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-semibold text-text-primary">逐条调整</p><span className="text-[9px] text-text-muted">修改后自动保存到当前草稿</span></div>
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">{(alignedCuesByLang[activeVoiceLang] || []).length ? (alignedCuesByLang[activeVoiceLang] || []).map((cue, index) => <div key={`${cue.start}-${index}`} className="rounded-lg border border-border bg-white p-2"><p className="text-[9px] font-bold text-text-muted">{cue.start.toFixed(1)}s – {cue.end.toFixed(1)}s</p><textarea value={cue.text} rows={2} onChange={event => setAlignedCuesByLang(current => ({ ...current, [activeVoiceLang]: (current[activeVoiceLang] || []).map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) }))} className="mt-1 w-full resize-y rounded-md border border-border px-2 py-1.5 text-[10px] leading-4 text-text-secondary outline-none focus:border-accent" /></div>) : <p className="rounded-lg border border-dashed border-border bg-surface-2 px-3 py-6 text-center text-[10px] text-text-muted">请先一键生成字幕文案。</p>}</div>
                </div>
                <div className="border-t border-border pt-3">
                  <button type="button" onClick={() => setShowSubtitleAdvanced(value => !value)} className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-left text-[10px] font-semibold text-text-secondary"><span>高级设置 · 字幕样式</span><ChevronDown size={13} className={`transition ${showSubtitleAdvanced ? 'rotate-180' : ''}`} /></button>
                  {showSubtitleAdvanced && <div className="mt-2 space-y-3 rounded-lg border border-border bg-surface-2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><label className="inline-flex items-center gap-2 text-[10px] font-bold text-text-secondary"><input type="checkbox" checked={subtitlesOn} onChange={event => setSubtitlesOn(event.target.checked)} className="accent-emerald-600" />烧录字幕</label><select value={subMode} onChange={event => setSubMode(event.target.value as 'target' | 'bilingual')} className="h-8 rounded-lg border border-border bg-white px-2 text-[10px] font-bold text-text-secondary"><option value="target">单语字幕</option><option value="bilingual">双语字幕</option></select></div>
                    <div className="grid grid-cols-2 gap-2"><label className="text-[10px] font-bold text-text-secondary">字体<select value={subtitleStyle.font} onChange={event => setSubtitleStyle(current => ({ ...current, font: event.target.value as CoverStyle['font'] }))} className="mt-1 h-8 w-full rounded-lg border border-border bg-white px-2 text-[10px]">{SUBTITLE_FONTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="text-[10px] font-bold text-text-secondary">字号比例<input aria-label="字幕字号比例" type="number" min="0.7" max="1.4" step="0.05" value={subtitleStyle.fontScale} onChange={event => setSubtitleStyle(current => ({ ...current, fontScale: Math.max(.7, Math.min(1.4, Number(event.target.value) || 1)) }))} className="mt-1 h-8 w-full rounded-lg border border-border bg-white px-2 text-[10px]" /></label></div>
                    <div className="grid grid-cols-2 gap-2"><label className="text-[10px] font-bold text-text-secondary">字幕颜色<input aria-label="字幕颜色" type="color" value={subtitleStyle.color} onChange={event => setSubtitleStyle(current => ({ ...current, color: event.target.value }))} className="mt-1 h-8 w-full" /></label><label className="text-[10px] font-bold text-text-secondary">描边颜色<input aria-label="字幕描边颜色" type="color" value={subtitleStyle.outlineColor} onChange={event => setSubtitleStyle(current => ({ ...current, outlineColor: event.target.value }))} className="mt-1 h-8 w-full" /></label></div>
                    <label className="block text-[10px] font-bold text-text-secondary">描边宽度 · {subtitleStyle.outlineWidth}<input aria-label="字幕描边宽度" type="range" min="0" max="8" step="1" value={subtitleStyle.outlineWidth} onChange={event => setSubtitleStyle(current => ({ ...current, outlineWidth: Number(event.target.value) }))} className="mt-1 w-full" /></label>
                    <label className="block text-[10px] font-bold text-text-secondary">距画面底部 · {Math.round(subtitleStyle.bottomRatio * 100)}%<input aria-label="字幕底部位置" type="range" min="0.08" max="0.35" step="0.01" value={subtitleStyle.bottomRatio} onChange={event => setSubtitleStyle(current => ({ ...current, bottomRatio: Number(event.target.value) }))} className="mt-1 w-full" /></label>
                    <label className="block text-[10px] font-bold text-text-secondary">每行宽度 · 约 {subtitleStyle.lineWidth} 字符<input aria-label="字幕每行宽度" type="range" min="8" max="28" step="1" value={subtitleStyle.lineWidth} onChange={event => setSubtitleStyle(current => ({ ...current, lineWidth: Number(event.target.value) }))} className="mt-1 w-full" /></label>
                  </div>}
                </div>
              </section>}
            </div>
          )}
          {step === 'material' && activeWorkbenchSlot && !socialViralTask && <ShotSourceDecisionPanel
            disabled={productionFor(activeWorkbenchSlot).locked}
            digitalHumanAvailable={salesPresenterRecognition(presenterEvidenceFor(activeWorkbenchSlot)) === 'confirmed'}
            allowShooting={canRequestShootingFor(activeWorkbenchSlot.id)}
            shootingBusy={shootingBusy}
            shootingScheduled={shootingTasks.some(task => task.sourceProjectId === projectId && task.sourceAssemblyId === activeAssemblyId && task.sourceShotId === shootingSlots.find(item => item.slotId === activeWorkbenchSlot.id)?.id)}
            error={shootingError}
            onDigitalHuman={() => {
              const salesSlot = storyboardSlots.find(slot => salesPresenterRecognition(presenterEvidenceFor(slot)) === 'confirmed') || activeWorkbenchSlot;
              setApplyDigitalToSales(true);
              setStoryboardSourcePlans(current => {
                const next = { ...current };
                for (const slot of storyboardSlots) {
                  if (salesPresenterRecognition(presenterEvidenceFor(slot)) !== 'confirmed' || productionFor(slot).locked || ['material', 'shoot'].includes(current[slot.id]?.userSource || '')) continue;
                  next[slot.id] = { ...sourcePlanFor(slot), userSource: 'avatar', decided: true, confirmed: false };
                }
                return next;
              });
              openProduction(salesSlot);
              setShotProductions(current => {
                const next = { ...current };
                for (const slot of storyboardSlots) {
                  if (salesPresenterRecognition(presenterEvidenceFor(slot)) !== 'confirmed' || productionFor(slot).locked || ['material', 'shoot'].includes(sourcePlanFor(slot).userSource || '')) continue;
                  const key = productionKey(slot.id);
                  next[key] = patchShot(current[key] || productionFor(slot), { source: 'avatar', contentType: 'enterprise_presenter', sound: 'source' });
                }
                return next;
              });
            }}
            onMaterials={() => { setShotLibraryError(''); setShotLibrarySlotId(activeWorkbenchSlot.id); }}
            onShoot={() => { setShootingError(''); void createBoundShootingTask(storyboardSlotScript(activeWorkbenchSlot.detail).visual || activeWorkbenchSlot.title, activeWorkbenchSlot.id); }}
          />}
          {step === 'material' && activeWorkbenchSlot && productionFor(activeWorkbenchSlot).source === 'avatar' && <details className="rounded-lg border border-border bg-white p-3">
            <summary className="cursor-pointer text-xs font-bold">HeyGen 账号资产</summary>
            <label className="mt-2 block text-[10px] font-bold text-text-secondary">选择人物<select aria-label="HeyGen 账号人物" value={heygenAvatarId} onChange={event => { setHeygenAvatarId(event.target.value); setHeygenBindingConsent(false); }} className="mt-1 w-full rounded border border-border bg-white p-2"><option value="">请选择</option>{heygenAvatars.map(avatar => <option key={avatar.id} value={avatar.id}>{avatar.name}</option>)}</select></label>
            <label className="mt-2 block text-[10px] font-bold text-text-secondary">素材原生画幅<select aria-label="HeyGen 人物画幅" value={heygenAvatarOrientation} onChange={event => { setHeygenAvatarOrientation(event.target.value as 'unknown' | 'portrait' | 'landscape' | 'square'); setHeygenBindingConsent(false); }} className="mt-1 w-full rounded border border-border bg-white p-2"><option value="unknown">待确认</option><option value="portrait">竖屏</option><option value="landscape">横屏</option><option value="square">方形</option></select></label>
            <label className="mt-2 flex gap-2 text-[10px] leading-4 text-text-secondary"><input type="checkbox" checked={heygenBindingConsent} onChange={event => setHeygenBindingConsent(event.target.checked)} />我确认人物为成年人，并已授权本产品和 HeyGen 处理人物、声音及商业使用</label>
            <button type="button" disabled={heygenAvatarBinding || !heygenAvatarId || !heygenBindingConsent} onClick={() => void bindHeygenAvatarToShot(activeWorkbenchSlot)} className="mt-2 w-full rounded bg-blue-600 px-2 py-1.5 text-[10px] font-bold text-white disabled:opacity-50">{heygenAvatarBinding ? '绑定中…' : '绑定当前分镜'}</button>
          </details>}
          {!socialViralTask && <DigitalHumanProductionOverview
            shots={storyboardSlots.flatMap((slot, index) => {
              const shot = productionFor(slot); if (shot.source !== 'avatar') return [];
              const persistedShotId = shootingSlots.find(item => item.slotId === slot.id)?.id || slot.id;
              const fingerprint = productionFingerprint(slot, shot);
              const presenterVersion = Math.max(1, productionDefaults.presenters.find(item => item.id === shot.presenterId)?.assetVersion || 1);
              return [{ shotId: slot.id, title: `分镜 ${index + 1} · ${slot.title}`, plan: productionPlans.find(item => item.projectId === projectId && item.assemblyId === activeAssemblyId && item.shotId === persistedShotId && item.fingerprint === fingerprint && item.presenterAssetVersion === presenterVersion),
                executions: productionExecutions.filter(item => item.projectId === projectId && item.assemblyId === activeAssemblyId && item.shotId === persistedShotId && item.fingerprint === fingerprint && item.presenterAssetVersion === presenterVersion) }];
            })}
            onOpenShot={shotId => { setProductionEditorId(shotId); setProductionError(''); }}
          />}
          {threeStepWorkflow && step === 'preview' ? <section className="space-y-2" aria-label="成片渲染与导出">
            <div className="rounded-lg border border-border bg-white p-3 text-xs" aria-label="成片制作检查清单">
              <p className="font-semibold text-text-primary">成片制作检查清单</p>
              <p className="mt-1 text-[10px] leading-4 text-text-muted">配置就绪后仍需实际渲染；爆款复刻可直接导出当前成片。</p>
              <ul className="mt-2 space-y-2 text-[11px] leading-5">
                <li>草稿保存 · {savingProj || autosaveStatus === 'saving' ? '保存中' : autosaveStatus === 'error' ? `失败：${autosaveError || '保存失败，请重试'}` : autosaveStatus === 'saved' ? '已保存' : '待保存'}{autosaveStatus === 'error' && <button type="button" disabled={savingProj} onClick={() => void saveProject('draft').catch(error => setModeNotice(error.message))} className="ml-2 font-bold text-emerald-700 underline disabled:opacity-50">重试保存</button>}</li>
                <li>分镜脚本 · {hasTimestampScript ? '已就绪' : '待处理：请先确认有效分镜脚本'}</li>
                <li>分镜素材 · {renderReadiness.unreadyShots.length ? `待处理：${renderReadiness.unreadyShots.length} 个分镜未就绪` : storyboardSlots.length ? '已就绪' : '待处理：尚无分镜'}</li>
                <li>口播与镜头编排 · {narrationArrangementPreview?.error ? `待处理：${narrationArrangementPreview.error}` : voiceoverAlignmentBlockReason ? `待处理：${voiceoverAlignmentBlockReason}` : '配置就绪，渲染后检查衔接'}</li>
                <li>成片配音 · {ttsLoading ? '正在生成' : replicationNeedsVoiceover ? '待处理：需生成当前语言配音' : voiceoverMode === 'none' ? '配置就绪：无配音' : '配置就绪，渲染后试听'}</li>
                <li>字幕 · {!subtitlesOn ? '配置就绪：已关闭' : subtitleSourceBlockReason ? `待处理：${subtitleSourceBlockReason}` : '配置就绪，渲染后检查字幕'}</li>
                <li>配乐 · {bgm ? '配置就绪，渲染后检查混音' : '配置就绪：不使用配乐'}</li>
                <li>画面动效与音效 · 配置就绪，渲染后检查效果</li>
                <li>成片与导出 · {rendering || batchRenderingLangs ? `正在渲染 ${renderPct}%` : workbenchHasFormalVideo ? mode === 'clone' ? '当前成片已生成，可导出' : currentRenderReviewed ? '已检查当前成片，可导出' : '已生成成片，待检查确认后导出' : '待处理：尚未生成成片'}</li>
              </ul>
              {previewRenderBlockers.length > 0 && <div role="status" className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">
                <p className="font-bold">当前暂不能渲染</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">{previewRenderBlockers.map(reason => <li key={reason}>{reason}</li>)}</ul>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(!renderReadiness.ready && !freeCanGenerateVoiceover) && <button type="button" onClick={() => setStepIdx(activeSteps.findIndex(item => item.id === 'material'))} className="rounded border border-amber-300 px-2 py-1 font-bold">返回步骤二处理分镜</button>}
                  {subtitleSourceBlockReason && <button type="button" onClick={() => { document.getElementById('preview-narration-arrangement')?.scrollIntoView({ block: 'nearest' }); }} className="rounded border border-amber-300 px-2 py-1 font-bold">查看原字幕补取</button>}
                  {(replicationNeedsVoiceover || voiceoverAlignmentBlockReason) && <button type="button" onClick={() => document.getElementById('preview-voiceover-settings')?.scrollIntoView({ block: 'nearest' })} className="rounded border border-amber-300 px-2 py-1 font-bold">查看配音设置</button>}
                </div>
              </div>}
            </div>

            <div id="preview-narration-arrangement" className="rounded-lg border border-border bg-white p-3 text-xs" aria-label="口播段落与镜头编排">
              <p className="font-semibold text-text-primary">口播段落与镜头编排</p>
              {missingAvatarSourceCues.length > 0 && <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-2 text-amber-900">
                <p>数字人分镜 {missingAvatarSourceCues.map(item => item.index + 1).join('、')} 缺少当前源片的实测字幕时间码。开启字幕导出前请补取；不会借用另一次 AI 配音的时间码。</p>
                <button type="button" disabled={avatarCaptionBusy || !projectId} onClick={() => void refreshAvatarSourceCaptions()} className="mt-1 rounded border border-amber-400 px-2 py-1 font-bold disabled:opacity-50">{avatarCaptionBusy ? '正在提取源片字幕…' : '补取原字幕（无原字幕时需确认付费 ASR）'}</button>
                {subtitleNotice && <p className="mt-1">{subtitleNotice}</p>}
              </div>}
              {(!narrationArrangementPreview || narrationArrangementPreview.error) ? <>
                {narrationArrangementPreview?.error && <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 leading-5 text-amber-800">口播编排尚未完成：{narrationArrangementPreview.error}。下方保留粗排，方便继续调整。</p>}
                <p className="mt-1 leading-5 text-text-muted">{activeVoiceoverUrl
                  ? narrationAudioHasMeasuredCues
                    ? '配音已有实测时间码；当前编排仍需调整，下面暂显示脚本粗排。'
                    : '配音已生成，但当前还没有可用于精确校准的实测时间码，下面继续显示脚本粗排。标记原声的镜头保留现有时间。'
                  : '当前为脚本时间粗排。标记原声的镜头保留素材时长；生成非数字人口播并取得实测时间码后，才会显示校准后的逐句时间和段内切点。'}</p>
                {narrationArrangementPreview?.error && narrationMeasuredCues.length > 0 && <div className="mt-2 rounded bg-surface-2 px-2 py-2 text-text-secondary">
                  <p className="font-bold">已生成口播的实测片段（以下为配音文件内时间）</p>
                  <div className="mt-1 max-h-28 space-y-1 overflow-y-auto">{narrationMeasuredCues.map((cue, index) => <p key={index}>{index + 1}. {cue.start.toFixed(1)}–{cue.end.toFixed(1)} 秒 · {cue.text}</p>)}</div>
                </div>}
                {storyboardSpeechGroups.length ? <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">{storyboardSpeechGroups.map((group, index) => <div key={group.line.id} className="rounded bg-surface-2 px-2 py-2 text-text-secondary">
                  <p className="font-bold">口播 {index + 1} · {group.line.time} · 覆盖 {group.items.length} 个分镜 · 待校准</p>
                  <p className="mt-0.5 line-clamp-2 text-text-muted">{group.line.draft}</p>
                  <div className="mt-1 flex flex-wrap gap-1">{group.items.map(item => {
                    const shotIndex = storyboardSlots.findIndex(slot => slot.id === item.id);
                    const shot = storyboardSlots[shotIndex];
                    if (!shot) return null;
                    const sourceVoice = hasAvatarSourceVoice(shot);
                    return <span key={shot.id} className={`rounded border px-1.5 py-0.5 text-[10px] ${sourceVoice ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-border bg-white text-text-muted'}`}>镜头 {shotIndex + 1} · {sourceVoice ? `${(materialById.get(storyboardAssignments[shot.id] || '')?.duration || shot.end - shot.start).toFixed(1)} 秒 · 原声时长锁定` : `${shot.start.toFixed(1)}–${shot.end.toFixed(1)} 秒 · 粗排`}</span>;
                  })}</div>
                </div>)}</div> : <p className="mt-2 text-amber-700">口播与分镜的段落归属尚未完全匹配，请先在分镜列表确认。</p>}
              </> : <>
                <p className="mt-1 text-text-muted">数字人沿用已生成素材的原声和固定时长，起点随前段口播顺延；其他分镜按新配音的实测时间码校准。成片约 {narrationArrangementPreview.result!.duration.toFixed(1)} 秒。</p>
                <p className="mt-1 text-text-muted">AI 配音段内按各镜头目标时长分配切点；在分镜素材中修改目标时长即可调整快切比例。与数字人原声同段的普通镜头不会借用其他段配音，请查看下方静音提示。</p>
                <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">{narrationArrangementPreview.result!.paragraphs.map((paragraph, index) => <div key={index} className="rounded bg-surface-2 px-2 py-1.5 text-text-secondary">
                  <p><strong>{paragraph.source === 'avatar' ? '数字人原声 · 时长锁定' : paragraph.source === 'mixed' ? '数字人原声与静音素材 · 镜头粗排' : 'AI 配音'}</strong> · {paragraph.start.toFixed(1)}–{paragraph.end.toFixed(1)} 秒 · 分镜 {paragraph.firstShot}{paragraph.lastShot > paragraph.firstShot ? `–${paragraph.lastShot}` : ''}</p>
                  <p className="truncate text-text-muted">{paragraph.text}</p>
                  {paragraph.source === 'ai' && paragraph.lastShot > paragraph.firstShot && Array.from({ length: paragraph.lastShot - paragraph.firstShot + 1 }, (_, offset) => paragraph.firstShot - 1 + offset).map(shotIndex => {
                    const slot = storyboardSlots[shotIndex];
                    const clip = slot ? materialById.get(storyboardAssignments[slot.id] || '') : undefined;
                    if (!slot || !clip) return null;
                    const edit = editForSlot(clip, slot);
                    const allocated = narrationArrangementPreview.result!.timeline[shotIndex]?.targetDuration || 0;
                    return <label key={slot.id} className="mt-1 flex items-center gap-2 text-[10px] text-text-muted"><span className="w-14 shrink-0">镜头 {shotIndex + 1}</span><input type="range" min="0.5" max="12" step="0.1" value={Math.min(12, edit.targetDuration || slot.end - slot.start)} disabled={productionFor(slot).locked} onChange={event => patchStoryboardClipEdit(slot, clip, 'targetDuration', Number(event.target.value))} className="min-w-0 flex-1 accent-emerald-600" /><span className="w-10 text-right">{allocated.toFixed(1)} 秒</span></label>;
                  })}
                </div>)}</div>
                {narrationArrangementPreview.result!.warnings.map((warning, index) => <p key={index} className="mt-1 text-amber-700">{warning}</p>)}
              </>}
            </div>
            {threeStepWorkflow && <div id="preview-voiceover-settings" className="rounded-lg border border-border bg-white p-3">
              <p className="text-xs font-semibold text-text-primary">成片配音口播</p>
              <p className="mt-1 text-[10px] leading-4 text-text-muted">已生成的数字人镜头保留原声；这里只为其他分镜生成口播。点击底部渲染按钮会自动补齐缺少的配音，也可先生成并试听。</p>
              <p role="status" className="mt-2 text-[10px] leading-4 text-text-secondary">{voiceoverStaleLangs.includes(activeVoiceLang)
                ? '口播文本或音色已变化，请重新生成配音后渲染。'
                : activeVoiceoverUrl ? '成片配音已生成，可试听并渲染。' : '成片配音尚未生成，渲染时会自动生成。'}</p>
              <label className="mt-3 block text-[10px] font-bold text-text-secondary">配音音色<select aria-label="配音音色" value={voice} onChange={event => { setVoice(event.target.value); setTtsLanguageSettings(current => ({ ...current, [activeVoiceLang]: { ...(current[activeVoiceLang] || DEFAULT_TTS_SETTINGS), voiceId: event.target.value } })); setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]); invalidateMusicRender(); }} className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs">{[...VOICES, ...customVoices.map(item => ({ id: item.voiceId, name: item.name }))].map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="mt-3 block text-[10px] font-bold text-text-secondary">配音语速 · {replicationSpeechSpeed.toFixed(2)} 倍<input aria-label="配音语速" type="range" min="0.85" max="1.30" step="0.05" value={replicationSpeechSpeed} onChange={event => { const speed = Number(event.target.value); setReplicationSpeechSpeed(speed); setTtsLanguageSettings(current => ({ ...current, [activeVoiceLang]: { ...(current[activeVoiceLang] || DEFAULT_TTS_SETTINGS), speed } })); setVoiceoverStaleLangs(current => [...new Set([...current, activeVoiceLang])]); invalidateMusicRender(); }} className="mt-2 w-full accent-blue-600" /></label>
              <label className="mt-3 block text-[10px] font-bold text-text-secondary">上传个人声音样本<input aria-label="上传个人声音样本" type="file" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4" onChange={event => { void handleVoiceSampleUpload(event.target.files); event.target.value = ''; }} className="mt-1 block w-full text-[10px]" /></label>
              <button type="button" disabled={ttsLoading || !storyboardSlots.length} onClick={() => void genTts(activeVoiceLang)} className="mt-3 w-full rounded-lg border border-emerald-500 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-50">{ttsLoading ? '正在生成配音…' : activeVoiceoverUrl ? '重新生成成片配音' : '生成成片配音'}</button>
              {activeVoiceoverUrl && <audio src={activeVoiceoverUrl} controls aria-label="成片配音试听" className="mt-3 w-full" />}
              {ttsNotice && <p role="status" className="mt-2 text-[10px] leading-4 text-text-muted">{ttsNotice}</p>}
            </div>}
            <details className="rounded-lg border border-border p-3" open><summary className="cursor-pointer text-xs font-bold">配乐</summary><div className="mt-3">{workbenchProductionPanel}</div></details>
            <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-xs font-bold">字幕确认</summary>
              <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={subtitlesOn} onChange={event => { setSubtitlesOn(event.target.checked); invalidateMusicRender(); }} />显示字幕</label>
              <p className="mt-2 text-[10px] text-text-muted">{subtitleReviewRows.length} 条字幕 · 数字人字幕沿用源片实测时间码，文字修改会用于成片。</p>
              {narrationArrangementPreview?.error && <p role="status" className="mt-2 text-[10px] text-orange-700">口播尚未校准：{narrationArrangementPreview.error}。当前 AI 字幕显示配音时间，校准后显示成片时间。</p>}
              {missingAvatarSourceCues.length > 0 && <p role="status" className="mt-2 text-[10px] text-orange-700">分镜 {missingAvatarSourceCues.map(item => item.index + 1).join('、')} 缺少源片字幕，请先补取原字幕。</p>}
              <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">{subtitleReviewRows.map((cue, index) => <label key={`${cue.source}-${cue.shotIndex ?? ''}-${cue.cueIndex}`} className="block text-[10px]">{cue.start.toFixed(1)}–{cue.end.toFixed(1)}s · {cue.source === 'ai' ? 'AI 配音' : `数字人原声${cue.shotIndex === undefined ? '' : ` · 分镜 ${cue.shotIndex + 1}`}`}<textarea aria-label={`字幕 ${index + 1}`} value={cue.text} readOnly={cue.source === 'ai' && presentationMode === 'material' && !narrationArrangementPreview?.result} rows={2} onChange={event => editReviewedSubtitle(cue, event.target.value)} className="mt-1 w-full rounded border border-border p-2" /></label>)}{!subtitleReviewRows.length && <p className="text-text-muted">请先生成配音字幕或补取数字人源片字幕。</p>}</div>
            </details>
            <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-xs font-bold">画面可控动效</summary>
              <select aria-label="动效风格" value={effectPreset} onChange={event => { setEffectPreset(event.target.value as EffectPresetId); invalidateMusicRender(); }} className="mt-3 w-full rounded border border-border p-2 text-xs"><option value="natural">自然</option><option value="dynamic">动感</option><option value="tech">科技</option><option value="cinematic">电影</option></select>
              <select aria-label="动效强度" value={effectIntensity} onChange={event => { setEffectIntensity(Number(event.target.value) as EffectIntensity); invalidateMusicRender(); }} className="mt-2 w-full rounded border border-border p-2 text-xs"><option value={0}>关闭</option><option value={1}>弱</option><option value={2}>中</option><option value={3}>强</option></select>
              <div className="mt-2 max-h-40 overflow-y-auto">{renderTimeline.map((item, index) => { const id = String(item.clipId || index); return <label key={`${id}-${index}`} className="flex items-center justify-between py-1 text-[10px]">分镜 {index + 1}<input type="checkbox" checked={!disabledEffectSceneIds.includes(id)} onChange={event => { setDisabledEffectSceneIds(current => event.target.checked ? current.filter(value => value !== id) : [...current, id]); invalidateMusicRender(); }} /></label>; })}</div>
            </details>
            <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-xs font-bold">音效配合</summary><label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={effectSoundsOn} onChange={event => { setEffectSoundsOn(event.target.checked); invalidateMusicRender(); }} />跟随中、强动效添加音效</label></details>

          </section> : workbenchProductionPanel}
          {step !== 'script' && step !== 'material' && step !== 'bgm' && step !== 'cover' && step !== 'preview' && (
            <AnimatePresence mode="wait">
              <motion.div key={`${step}-${scriptStageTab}`} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
                {renderStep()}
              </motion.div>
            </AnimatePresence>
          )}
        </div>}
      </>
    )
  );
}
