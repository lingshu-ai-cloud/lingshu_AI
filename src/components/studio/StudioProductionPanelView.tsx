import { Play, Check, X, Pause, ChevronDown, Heart } from 'lucide-react';
import { type CoverStyle } from '../../lib/studioApi';
import { STUDIO_ACCENT } from './studioWorkspaceConfig.js';
import { fmtDur } from './studioMaterialPresentation.js';
import { COVER_FONTS } from './studioFontCatalog.js';
import type { StudioProductionPanelViewInputs } from './studioProductionPanelViewInputs.js';

export function renderStudioProductionPanel(input: StudioProductionPanelViewInputs) {
  const {
    threeStepWorkflow, step, scriptStageTab,
    bgmLibraryRef, bgmInputRef, handleBgmUpload,
    selectedBgmTrack, togglePlay, playingBgm,
    bgmVol, bgm, setBgmVol,
    invalidateMusicRender, setBgmLibraryOpen, bgms,
    bgmLibraryOpen, bgmUploading, applyWorkbenchBgm,
    audioRef, setPlayingBgm, toggleFavoriteBgm,
    favoriteBgms, bgmNotice, cover,
    setCover, setCapturedCoverFrameUrl, setCoverTimelineCaptureMode,
    setCoverUrl, frameCandidates, setCanvasView,
    coverTimelineCaptureMode, captureWorkbenchCoverFrame, coverCaptureNotice,
    coverRecommendationClips, setCoverCaptureNotice, capturedCoverFrameUrl,
    coverTitle, setCoverTitle, regenCovers,
    coverLoading, openCanvaCoverEditor, coverCanvaOpening,
    coverStyle, setCoverStyle, selectedOutputStale,
    subtitleSourceBlockReason, voiceoverAlignmentBlockReason, renderReadiness,
    setActiveStoryboardSlotId, setStepIdx, activeSteps,
    replicationNeedsVoiceover, workbenchRenderableVersionCount, replicationTimingBlocked,
    replicationPreparationError, workbenchHasFormalVideo, assemblyName,
    activeLanguageLabel, coverClip, mode,
    currentRenderReviewed, updateRenderAcceptance, currentProjectQualityRecord,
    projectQualityBusy, requalityCurrentProject, projectQualityNotice,
    freeThreeStep, manualHandoffBusy, submitManualHandoff,
    manualHandoffs, currentReviewedOutputPath, manualHandoffNotice,
  } = input;

  return (
    ((threeStepWorkflow && step === 'preview') || step === 'bgm' || (step === 'script' && scriptStageTab === 'bgm')) ? (
      <section ref={bgmLibraryRef} className="space-y-3">
        <input ref={bgmInputRef} type="file" accept="audio/*" className="hidden" onChange={event => { void handleBgmUpload(event.target.files); event.target.value = ''; }} />
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="text-xs font-semibold text-text-primary">当前配乐</p><p className="mt-1 truncate text-[10px] text-text-muted">{selectedBgmTrack?.name || '不配乐，仅保留素材原声和口播'}</p></div>
            {selectedBgmTrack && <button type="button" onClick={() => togglePlay(selectedBgmTrack)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-text-secondary">{playingBgm === selectedBgmTrack.id ? <Pause size={13} /> : <Play size={13} />}</button>}
          </div>
          <label className="mt-3 block text-[10px] font-bold text-text-secondary">配乐音量 · {bgmVol}%<input type="range" min="0" max="100" value={bgmVol} disabled={!bgm} onChange={event => { setBgmVol(Number(event.target.value)); invalidateMusicRender(); }} className="mt-2 w-full accent-emerald-600 disabled:opacity-35" /></label>
        </div>
        <button type="button" onClick={() => setBgmLibraryOpen(value => !value)} className="flex w-full items-center justify-between rounded-lg border border-border bg-white px-3 py-3 text-left">
          <span><span className="block text-xs font-semibold text-text-primary">选择配乐</span><span className="mt-0.5 block text-[10px] text-text-muted">{bgms.length} 首音乐，可试听后选择</span></span>
          <ChevronDown size={14} className={`text-text-muted transition ${bgmLibraryOpen ? 'rotate-180' : ''}`} />
        </button>
        {bgmLibraryOpen && (
          <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-2">
            <div className="flex items-center justify-between gap-2 px-1 pb-1"><p className="text-[10px] font-bold text-text-muted">曲库</p><button type="button" onClick={() => bgmInputRef.current?.click()} disabled={bgmUploading} className="rounded-md border border-border bg-white px-2 py-1 text-[9px] font-bold text-text-secondary">{bgmUploading ? '上传中…' : '上传音乐'}</button></div>
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              <button type="button" onClick={() => { applyWorkbenchBgm(''); audioRef.current?.pause(); setPlayingBgm(null); }} className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left ${!bgm ? 'border-emerald-300 bg-emerald-50' : 'border-border bg-white'}`}><span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-2"><X size={12} /></span><span className="min-w-0 flex-1 text-[10px] font-semibold text-text-primary">不配乐</span>{!bgm && <Check size={12} className="text-emerald-600" />}</button>
              {bgms.map(track => (
                <div key={track.id} className={`flex items-center gap-2 rounded-lg border p-2 ${bgm === track.id ? 'border-emerald-300 bg-emerald-50' : 'border-border bg-white'}`}>
                  <button type="button" onClick={() => togglePlay(track)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-secondary">{playingBgm === track.id ? <Pause size={12} /> : <Play size={12} />}</button>
                  <button type="button" onClick={() => applyWorkbenchBgm(track.id)} className="min-w-0 flex-1 text-left"><span className="block truncate text-[10px] font-semibold text-text-primary">{track.name}</span><span className="mt-0.5 block truncate text-[9px] text-text-muted">{track.mood || '背景音乐'} · {fmtDur(track.duration)}</span></button>
                  <button type="button" onClick={() => toggleFavoriteBgm(track.id)} className="flex h-7 w-7 shrink-0 items-center justify-center text-text-muted"><Heart size={12} fill={favoriteBgms.includes(track.id) ? 'currentColor' : 'none'} /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setBgmLibraryOpen(false)} className="w-full rounded-lg border border-border bg-white px-3 py-2 text-[10px] font-bold text-text-secondary">收起曲库</button>
          </div>
        )}
        {bgmNotice && <p className={`rounded-lg border px-3 py-2 text-[10px] leading-4 ${/失败|错误|未返回/.test(bgmNotice) ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{bgmNotice}</p>}

      </section>
    ) : step === 'cover' ? (
      <section className="space-y-3">
        <div><p className="text-xs font-semibold text-text-primary">封面与标题</p><p className="mt-1 text-[10px] leading-4 text-text-muted">中间区域实时显示封面，这里只保留必要参数。</p></div>
        <label className="block text-[10px] font-bold text-text-secondary">封面底图<select value={cover} onChange={event => { setCover(event.target.value); setCapturedCoverFrameUrl(''); setCoverTimelineCaptureMode(false); setCoverUrl(null); }} className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-2 text-[10px]">{frameCandidates.length ? frameCandidates.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">暂无可用素材</option>}</select></label>
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="flex items-center justify-between gap-2"><div><p className="text-[10px] font-semibold text-text-primary">从素材截取封面</p><p className="mt-0.5 text-[9px] text-text-muted">拖动底部整片时间轴定位画面，再截取当前帧。</p></div><button type="button" onClick={() => { setCoverTimelineCaptureMode(true); setCanvasView('creation'); }} className="shrink-0 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[9px] font-bold text-text-secondary">选择画面</button></div>
          {coverTimelineCaptureMode && <button type="button" onClick={captureWorkbenchCoverFrame} className="mt-2 w-full rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-semibold text-white">截取当前帧</button>}
          {coverCaptureNotice && <p className={`mt-2 text-[9px] leading-4 ${/不允许|无法|尚未/.test(coverCaptureNotice) ? 'text-red-600' : 'text-emerald-700'}`}>{coverCaptureNotice}</p>}
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-semibold text-text-primary">推荐封面</p><span className="text-[9px] text-text-muted">从真实素材中推荐 3 张</span></div>
          <div className="grid grid-cols-3 gap-2">
            {coverRecommendationClips.map((item, index) => <button key={item.id} type="button" onClick={() => { setCover(item.id); setCapturedCoverFrameUrl(''); setCoverTimelineCaptureMode(false); setCoverUrl(null); setCoverCaptureNotice(`已选择推荐封面 ${index + 1}`); }} className={`overflow-hidden rounded-lg border text-left ${cover === item.id && !capturedCoverFrameUrl ? 'border-emerald-400 ring-1 ring-emerald-200' : 'border-border'}`}><div className="aspect-[4/3] bg-slate-950">{item.poster || item.type === 'image' ? <img src={item.poster || item.url} alt="" className="h-full w-full object-cover" /> : <video src={item.url} muted preload="metadata" className="h-full w-full object-cover" />}</div><p className="truncate bg-white px-1.5 py-1 text-[8px] font-bold text-text-secondary">推荐 {index + 1}</p></button>)}
          </div>
        </div>
        <label className="block text-[10px] font-bold text-text-secondary">封面标题<textarea value={coverTitle} rows={3} onChange={event => { setCoverTitle(event.target.value); setCoverUrl(null); }} className="mt-1 w-full resize-y rounded-lg border border-border bg-white p-2 text-xs leading-5 outline-none focus:border-accent" /></label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={regenCovers} disabled={coverLoading} className="rounded-lg border border-border bg-white px-3 py-2 text-[10px] font-bold text-text-secondary">{coverLoading ? '生成中…' : 'AI 重写标题'}</button>
          <button type="button" onClick={() => void openCanvaCoverEditor()} disabled={coverCanvaOpening} className="rounded-lg border border-border bg-white px-3 py-2 text-[10px] font-bold text-text-secondary">{coverCanvaOpening ? '打开中…' : '精细编辑封面'}</button>
        </div>
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] font-bold text-text-secondary">字体<select value={coverStyle.font} onChange={event => setCoverStyle(current => ({ ...current, font: event.target.value as CoverStyle['font'] }))} className="mt-1 h-8 w-full rounded-lg border border-border bg-white px-2 text-[10px]">{COVER_FONTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="text-[10px] font-bold text-text-secondary">字号<select value={coverStyle.size} onChange={event => setCoverStyle(current => ({ ...current, size: event.target.value as CoverStyle['size'] }))} className="mt-1 h-8 w-full rounded-lg border border-border bg-white px-2 text-[10px]"><option value="S">小</option><option value="M">中</option><option value="L">大</option></select></label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">{['#ffffff', '#111827', '#16a34a', '#14b8a6', '#ef4444', '#3b82f6'].map(color => <button key={color} type="button" onClick={() => setCoverStyle(current => ({ ...current, color }))} className="h-6 w-6 rounded-full border" style={{ background: color, borderColor: coverStyle.color === color ? STUDIO_ACCENT : 'var(--color-border)', boxShadow: coverStyle.color === color ? `0 0 0 2px ${STUDIO_ACCENT}` : undefined }} />)}</div>
        </div>
      </section>
    ) : step === 'preview' ? (
      <section className="space-y-3">
        {threeStepWorkflow && selectedOutputStale && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">现有成片对应旧脚本、旧素材或未记录版本校验，请重新渲染当前版本后再预览、确认或导出。</p>}
        {threeStepWorkflow && subtitleSourceBlockReason && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">{subtitleSourceBlockReason}</p>}
        {threeStepWorkflow && voiceoverAlignmentBlockReason && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">{voiceoverAlignmentBlockReason}</p>}
        {threeStepWorkflow && !renderReadiness.ready && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3" role="status">
          <p className="text-xs font-semibold text-amber-950">成片前还需处理 {renderReadiness.issues.length} 项</p>
          <p className="mt-1 text-[10px] text-amber-900">已就绪 {renderReadiness.readyCount}/{renderReadiness.totalCount} 镜。点击问题返回对应分镜。</p>
          <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">{renderReadiness.issues.map((issue, index) => <button key={`${issue.code}-${issue.slotId || 'global'}-${index}`} type="button" onClick={() => { if (issue.slotId) setActiveStoryboardSlotId(issue.slotId); setStepIdx(activeSteps.findIndex(item => item.id === (issue.code === 'script_missing' ? 'mode' : 'material'))); setCanvasView('creation'); }} className="block w-full rounded-lg bg-white px-2 py-1.5 text-left text-[10px] text-amber-950 hover:bg-amber-100">{issue.message} →</button>)}</div>
        </div>}
        {threeStepWorkflow && renderReadiness.ready && !replicationNeedsVoiceover && workbenchRenderableVersionCount === 0 && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">当前没有可渲染的视频版本。请检查脚本及每个分镜的素材链接。</p>}
        {threeStepWorkflow && replicationTimingBlocked && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">{replicationPreparationError || '内容准备尚未完成，请稍候。'}</p>}
        <div className={`rounded-lg border p-3 ${workbenchHasFormalVideo ? 'border-emerald-200 bg-emerald-50' : 'border-border bg-surface-2'}`}><p className="text-xs font-semibold text-text-primary">{workbenchHasFormalVideo ? '成片已生成' : '等待渲染成片'}</p><p className="mt-1 text-[10px] leading-4 text-text-muted">{workbenchHasFormalVideo ? '可在中间播放器检查成片；修改设置后可重新渲染。' : replicationNeedsVoiceover ? '点击底部按钮，系统会先生成本语言配音，再渲染成片。' : '确认配乐和字幕后，点击底部“渲染成片”。'}</p></div>
        <div className="space-y-2 rounded-lg border border-border bg-white p-3 text-[10px]">
          <div className="flex justify-between gap-3"><span className="text-text-muted">内容版本</span><span className="truncate font-bold text-text-primary">{assemblyName}</span></div>
          <div className="flex justify-between gap-3"><span className="text-text-muted">语言</span><span className="truncate font-bold text-text-primary">{activeLanguageLabel}</span></div>
          <div className="flex justify-between gap-3"><span className="text-text-muted">配乐</span><span className="truncate font-bold text-text-primary">{selectedBgmTrack?.name || '不配乐'}</span></div>
          <div className="flex justify-between gap-3"><span className="text-text-muted">封面</span><span className="truncate font-bold text-text-primary">{coverClip?.name || '沿用首帧'}</span></div>
        </div>
        {threeStepWorkflow && mode !== 'clone' && workbenchHasFormalVideo && <label className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[11px] leading-5 text-emerald-950"><input type="checkbox" className="mt-1" checked={currentRenderReviewed} onChange={event => void updateRenderAcceptance(event.target.checked)} /><span>我已检查中间播放器中的画面、口播、字幕、配乐和结尾，同意导出当前版本。验收结果会保存到“我的创作”的历史素材。</span></label>}
        {threeStepWorkflow && mode !== 'clone' && currentRenderReviewed && <div className={`rounded-lg border p-3 text-[11px] ${currentProjectQualityRecord ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`} aria-label="成片重新质检">
          <p className="font-semibold text-text-primary">{currentProjectQualityRecord ? '当前版本质检已签发' : '当前版本等待重新质检'}</p>
          <p className="mt-1 leading-5 text-text-muted">脚本、分镜、素材、字幕、配音或成片变化后，旧记录会自动失效。导出、团队审核和发布前必须为当前输入重新签发。</p>
          {currentProjectQualityRecord && <p className="mt-1 font-mono text-[9px] text-emerald-800">记录 {currentProjectQualityRecord.id} · 指纹 {currentProjectQualityRecord.inputFingerprint.slice(0, 12)}</p>}
          <button type="button" disabled={projectQualityBusy} onClick={() => void requalityCurrentProject()} className="mt-2 rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-45">{projectQualityBusy ? '正在质检…' : currentProjectQualityRecord ? '再次核验当前版本' : '重新质检并签发'}</button>
          {projectQualityNotice && <p role="status" className="mt-2 leading-5 text-text-secondary">{projectQualityNotice}</p>}
        </div>}
        {freeThreeStep && workbenchHasFormalVideo && <div className="rounded-lg border border-border bg-white p-3 text-[11px]" aria-label="人工协作交付">
          <p className="font-semibold text-text-primary">后续协作（主动发起）</p>
          <p className="mt-1 leading-5 text-text-muted">保存和导出不会自动创建数字员工任务。验收当前成片后，可单独发起以下团队协作。</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" disabled={!currentRenderReviewed || !currentProjectQualityRecord || Boolean(manualHandoffBusy)} onClick={() => void submitManualHandoff('team_review')} className="rounded-lg border border-emerald-300 px-3 py-2 font-bold text-emerald-800 disabled:opacity-45">{manualHandoffBusy === 'team_review' ? '正在提交…' : '提交团队审核'}</button>
            <button type="button" disabled={!currentRenderReviewed || !currentProjectQualityRecord || Boolean(manualHandoffBusy)} onClick={() => void submitManualHandoff('publishing_plan')} className="rounded-lg border border-emerald-300 px-3 py-2 font-bold text-emerald-800 disabled:opacity-45">{manualHandoffBusy === 'publishing_plan' ? '正在加入…' : '加入发布计划'}</button>
          </div>
          {manualHandoffs.some(item => item.renderPath === currentReviewedOutputPath) && <ul className="mt-2 space-y-1 text-[10px] text-emerald-800">{manualHandoffs.filter(item => item.renderPath === currentReviewedOutputPath).map(item => <li key={item.id}>{item.action === 'team_review' ? '团队审核' : '发布计划'} · {item.status === 'pending_review' ? '等待审核' : '已建立待办'} · {new Date(item.createdAt).toLocaleString('zh-CN')}</li>)}</ul>}
          {manualHandoffNotice && <p role="status" className="mt-2 rounded bg-surface-2 px-2 py-1.5 leading-5 text-text-secondary">{manualHandoffNotice}</p>}
        </div>}
      </section>
    ) : null
  );
}
