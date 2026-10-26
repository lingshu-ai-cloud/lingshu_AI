import CreationDialoguePlanPanel from './CreationDialoguePlanPanel';
import { StoryboardFirstFrame } from '../studio/StoryboardFirstFrame';
export { StoryboardFirstFrame } from '../studio/StoryboardFirstFrame';
import StudioPreviewStage from '../studio/StudioPreviewStage';
import ReplicationWorkbenchHeader from './ReplicationWorkbenchHeader';
import { Alert, Button, Modal } from 'antd';
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Film,
  FolderOpen,
  GripVertical,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { SocialContentCreationPath } from '../../lib/socialContentModel';
import type { Material, StudioScriptResult } from '../../lib/studioApi';
import type { SocialContentStageProfile } from '../../lib/socialContentStage';
import type { FreeCreationLine } from './socialCreationDraft';
export { assignReplicationDefaultProduct, parseFreeCreationScript, resolveReplicationProductMappings, serializeFreeCreationLines } from './socialCreationDraft';
export type { FreeCreationLine } from './socialCreationDraft';
import { WorkbenchVideoPreview } from './WorkbenchVideoPreview';
export { WorkbenchVideoPreview } from './WorkbenchVideoPreview';
import { shotStart } from './socialCreationWorkbenchTime';
import { useSocialCreationWorkbenchController } from './useSocialCreationWorkbenchController';

export interface SocialCreationWorkbenchSeed {
  assistantEntry?: import('../../../shared/contracts/assistantCreationPortal').AssistantCreationPortal;
  creationDialoguePlan?: import('../../../shared/contracts/contentCreationDialogue').CreationReply;
  continueTaskId?: string;
  continueProjectId?: string;
  presenterAssetId?: string;
  /** Editable project identity. Keep this separate from the reference video's title. */
  draftTitle?: string;
  referenceTitle?: string;
  referenceThumbnail?: string;
  referenceMediaUrl?: string;
  referenceContentType?: 'video' | 'image';
  aspectRatio?: string;
  referenceShots?: Array<{ time: string; dialogue?: string; subtitle?: string; visual?: string; firstFrameRef?: string; firstFrameSeconds?: number; startSeconds?: number; endSeconds?: number }>;
  referenceLinks?: string[];
  productId?: string;
  productName?: string;
  selectedProductIds?: string[];
  selectedProductNames?: string[];
  productMappings?: Array<{ sourceTerm: string; productId: string; productName: string }>;
  confirmedSpeech?: Array<{ source: string; draft: string; time: string }>;
}

export interface SocialCreationWorkbenchSubmit {
  platforms?: string[];
  replicationStep?: 1 | 2 | 3;
  confirmedSpeech?: Array<{ source: string; draft: string; time: string }>;
  initialScript?: string;
  initialGeneration?: StudioScriptResult;
  draftProjectId?: string;
  requestId: number;
  creationPath: SocialContentCreationPath;
  title: string;
  productId: string;
  productName: string;
  productMappings: Array<{ sourceTerm: string; productId: string; productName: string }>;
  brandMapping?: { sourceTerm: string; brandName: string };
  presenterAssetId: string;
  files: File[];
  uploadedMaterials: Material[];
  referenceLinks: string[];
  callToAction: string;
  specialRequirements: string;
  stageProfileId: SocialContentStageProfile['id'];
  stageLabel: string;
  strategyPresetId: SocialContentStageProfile['presetId'];
}

export default function SocialCreationWorkbench({
  mode,
  seed,
  stageProfile,
  onOpenChooser,
  onShowCreations,
  onGenerate,
}: {
  mode: SocialContentCreationPath;
  seed?: SocialCreationWorkbenchSeed;
  stageProfile?: SocialContentStageProfile;
  onOpenChooser: () => void;
  onShowCreations: () => void;
  onGenerate: (request: SocialCreationWorkbenchSubmit) => void | Promise<void>;
}) {
  const {
    draftRecoveryError,
    isReplication, products, productId, setProductId, selectedProductIds, setSelectedProductIds, setProductAssignments,
    setProductSelectionChanged, productSelectorOpen, setProductSelectorOpen, setManualProductTerms, newProductTerm, setNewProductTerm, enterpriseBrandName,
    enterpriseCtas, enterpriseProfileState, productsLoading, productsUnavailable, submitting, generatingSpeech, files,
    setFiles, freeScriptText, setFreeScriptText, setFreeGeneration, freeHookMaterial, setFreeHookMaterial, aiHookCandidate,
    aiHookFrame, aiHookPhase, aiHookError, aiHookEstimatedCost, freeLines, setFreeLines, hookMode,
    setHookMode, hookChooserOpen, setHookChooserOpen, libraryHooks, libraryLoading, draftTitle, draftTitleStatus,
    draggedFreeLineIndex, contentGoal, setContentGoal, targetAudience, setTargetAudience, platform, setPlatform,
    contentLanguage, setContentLanguage, sellingPoints, setSellingPoints, desiredDuration, setDesiredDuration, tone,
    setTone, callToAction, setCallToAction, prohibitedClaims, setProhibitedClaims, briefNotes, setBriefNotes,
    activeLine, setActiveLine, expandedSpeechLines, setExpandedSpeechLines, requestedSeek, setRequestedSeek, seekRequestId,
    setSeekRequestId, cardsRef, cardListRef, resolvedReferenceUrl, setResolvedReferenceUrl, setGenerationNotice, speechEdits,
    setSpeechEdits, generatedSpeech, uploadRef, selectedFreeProducts, referenceShots, referenceLines, script,
    productSlots, productMentions, primaryProductId, primaryProduct, productMappings, productsReady, productSelectionLoading,
    chooseDefaultProduct, speechGenerated, confirmedSpeech, generateSpeech, highlightSpeech, syncPlaybackCard, previewUrl,
    startGeneration, commitFreeLines, regenerateFreeLine, generateAiHook, adoptAiHook, chooseHookMode, updateDraftTitle,
    commitDraftTitle, freeReady,
  } = useSocialCreationWorkbenchController({ mode, seed, stageProfile, onGenerate });


  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      {draftRecoveryError && <Alert type="error" showIcon title={draftRecoveryError}/>}
      <ReplicationWorkbenchHeader
        activeStep={0}
        compact
        editableTitle
        title={draftTitle}
        titleStatus={draftTitleStatus}
        onTitleChange={updateDraftTitle}
        onTitleCommit={() => { void commitDraftTitle(); }}
        actions={<><Button htmlType="button" onClick={onShowCreations} className="whitespace-nowrap font-semibold">我的创作</Button><Button type="primary" htmlType="button" onClick={onOpenChooser} className="whitespace-nowrap font-semibold">切换制作方式</Button></>}
      />

      {seed?.creationDialoguePlan && <CreationDialoguePlanPanel value={seed.creationDialoguePlan} narrationText={freeScriptText} onNarrationChange={setFreeScriptText}/>}
      <Modal
        open={!isReplication && hookChooserOpen}
        centered
        getContainer={false}
        width={760}
        footer={null}
        title="选择开场方式"
        onCancel={() => setHookChooserOpen(false)}
      >
        <p className="mb-5 text-sm text-text-secondary">选择本次内容如何开始；稍后仍可在预览区更换。</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ['ai', 'AI 生成', '根据产品与受众生成钩子', Sparkles],
            ['upload', '上传素材', '使用本地图片或视频', Upload],
            ['library', '素材库', '从已有素材中选择', FolderOpen],
            ['none', '暂不指定', '进入分镜后再补充', Film],
          ] as const).map(([value, label, description, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => chooseHookMode(value)}
              className="group flex min-h-40 flex-col rounded-lg border border-border bg-white p-4 text-left transition hover:border-accent hover:bg-accent-glow focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 text-text-primary group-hover:bg-white group-hover:text-accent"><Icon size={20} /></span>
              <span className="mt-auto whitespace-nowrap text-sm font-semibold text-text-primary">{label}</span>
              <span className="mt-1 text-xs leading-5 text-text-secondary">{description}</span>
            </button>
          ))}
        </div>
      </Modal>


      <div className="social-creation-workbench-layout grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:overflow-hidden">
        <aside className="min-h-0 border-b border-border bg-white lg:overflow-y-auto lg:border-b-0 lg:border-r">
          {isReplication && <div className="sticky top-0 z-10 border-b border-border bg-white px-4 py-4">
            <p className="text-sm font-semibold text-text-primary">口播替换与确认</p>
            <p className="mt-1 text-[11px] leading-5 text-text-muted">先在右侧完成产品映射并生成口播，再检查高亮产品词、修改并确认。</p>
          </div>}
          <ol ref={cardListRef} className="space-y-2 p-3">
            {!isReplication && !freeLines.length && <li className="rounded-lg border border-dashed border-blue-200 bg-blue-50/40 p-4 text-xs leading-5 text-zinc-700">填写右侧创作简报即可生成分镜。钩子素材为可选项，也可以在第二页再完成首镜。</li>}
            {!isReplication && freeLines.map((freeLine, index) => <li key={freeLine.id} draggable onDragStart={event => { draggedFreeLineIndex.current = index; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', freeLine.id); }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={event => { event.preventDefault(); const from = draggedFreeLineIndex.current; draggedFreeLineIndex.current = null; if (from == null || from === index) return; const next = [...freeLines]; const [moved] = next.splice(from, 1); next.splice(index, 0, moved); commitFreeLines(next); }} onDragEnd={() => { draggedFreeLineIndex.current = null; }} className={`rounded-lg border p-3 ${freeLine.hook ? 'border-blue-400 bg-blue-50/50' : 'border-border bg-white'}`}>
              <div className="flex items-center gap-2"><span title="拖动调整分镜顺序" aria-label={`拖动第 ${index + 1} 个分镜排序`} className="cursor-grab text-text-muted active:cursor-grabbing"><GripVertical size={14} /></span><span className="text-xs font-semibold">{index + 1}</span><input aria-label={`第 ${index + 1} 个分镜时间`} value={freeLine.time} onChange={event => commitFreeLines(freeLines.map((item, i) => i === index ? { ...item, time: event.target.value } : item))} className="min-w-0 flex-1 rounded border border-border px-2 py-1 text-[10px]" /><button type="button" onClick={() => commitFreeLines(freeLines.map((item, i) => ({ ...item, hook: i === index })))} className={`rounded px-2 py-1 text-[10px] font-bold ${freeLine.hook ? 'bg-blue-600 text-white' : 'bg-surface-2 text-text-secondary'}`}>{freeLine.hook ? '首要钩子' : '设为钩子'}</button></div>
              <textarea aria-label={`第 ${index + 1} 个分镜口播`} disabled={freeLine.silent} value={freeLine.speech} onChange={event => commitFreeLines(freeLines.map((item, i) => i === index ? { ...item, speech: event.target.value } : item))} rows={3} placeholder="填写口播" className="mt-2 w-full resize-y rounded-lg border border-border p-2 text-xs leading-5 disabled:bg-slate-100" />
              <label className="mt-2 flex items-center gap-2 text-[10px] font-bold"><input type="checkbox" checked={freeLine.silent} onChange={event => commitFreeLines(freeLines.map((item, i) => i === index ? { ...item, silent: event.target.checked } : item))} />无口播画面</label>
              <textarea aria-label={`第 ${index + 1} 个分镜画面意图`} value={freeLine.visual} onChange={event => commitFreeLines(freeLines.map((item, i) => i === index ? { ...item, visual: event.target.value } : item))} rows={2} placeholder="画面意图" className="mt-2 w-full resize-y rounded-lg border border-border p-2 text-xs leading-5" />
              <select aria-label={`第 ${index + 1} 个分镜类型`} value={freeLine.shotType} onChange={event => commitFreeLines(freeLines.map((item, i) => i === index ? { ...item, shotType: event.target.value as FreeCreationLine['shotType'] } : item))} className="mt-2 w-full rounded-lg border border-border bg-white p-2 text-xs"><option>真人口播</option><option>工厂</option><option>产品</option><option>D to C</option></select>
              <p className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-[10px] leading-4 text-text-muted">事实来源：{selectedFreeProducts.length ? selectedFreeProducts.map(item => item.name).join('、') : '尚未选择企业产品'}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold"><button type="button" onClick={() => void regenerateFreeLine(index)} className="rounded border border-border px-2 py-1"><RefreshCw size={11} className="mr-1 inline" />重生成</button><button type="button" onClick={() => { const midpoint = Math.max(1, Math.floor(freeLine.speech.length / 2)); commitFreeLines([...freeLines.slice(0, index), { ...freeLine, id: `${freeLine.id}-a`, speech: freeLine.speech.slice(0, midpoint), hook: freeLine.hook }, { ...freeLine, id: `${freeLine.id}-b`, speech: freeLine.speech.slice(midpoint), hook: false }, ...freeLines.slice(index + 1)]); }} className="rounded border border-border px-2 py-1">拆分</button><button type="button" disabled={index === 0} onClick={() => { const previous = freeLines[index - 1]; commitFreeLines([...freeLines.slice(0, index - 1), { ...previous, speech: [previous.speech, freeLine.speech].filter(Boolean).join(' '), visual: [previous.visual, freeLine.visual].filter(Boolean).join('；'), hook: previous.hook || freeLine.hook }, ...freeLines.slice(index + 1)]); }} className="rounded border border-border px-2 py-1 disabled:opacity-40">与上条合并</button><button type="button" disabled={index === 0} onClick={() => { const next = [...freeLines]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; commitFreeLines(next); }} className="rounded border border-border px-2 py-1 disabled:opacity-40">上移</button><button type="button" disabled={index === freeLines.length - 1} onClick={() => { const next = [...freeLines]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; commitFreeLines(next); }} className="rounded border border-border px-2 py-1 disabled:opacity-40">下移</button><button type="button" disabled={freeLines.length === 1} onClick={() => commitFreeLines(freeLines.filter((_, i) => i !== index))} className="rounded border border-red-200 px-2 py-1 text-red-700 disabled:opacity-40"><Trash2 size={11} className="inline" />删除</button></div>
            </li>)}
            {!isReplication && freeLines.length > 0 && <li><button type="button" onClick={() => commitFreeLines([...freeLines, { id: `free-line-${Date.now()}`, time: `${freeLines.length * 4}–${(freeLines.length + 1) * 4}s`, speech: '', visual: '', shotType: '产品', silent: true, hook: false }])} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-emerald-300 py-2 text-xs font-bold text-emerald-800"><Plus size={13} />新增分镜</button><button type="button" onClick={() => { setFreeScriptText(''); setFreeLines([]); setFreeGeneration(null); setGenerationNotice(''); }} className="mt-2 text-xs font-bold text-emerald-800 underline">重新生成整版</button></li>}
            {isReplication && !referenceShots.length && <li className="rounded-lg border border-dashed border-border p-4 text-xs leading-5 text-text-muted">原片分镜和口播尚未完成分析。完成后会在这里逐句显示真实口播与素材首帧。</li>}
            {script.map((line, index) => {
              const active = activeLine === index;
              return <li ref={element => { cardsRef.current[index] = element; }} key={`${index}:${line}`}>
                <button type="button" aria-current={active ? 'step' : undefined} onClick={() => { setActiveLine(index); setSeekRequestId(current => current + 1); setRequestedSeek((referenceLines[index]?.startSeconds ?? shotStart(referenceLines[index]?.time || '')) + 0.05); }} className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${active ? 'border-blue-400 bg-blue-50/40 shadow-none' : 'border-border bg-white hover:border-blue-200'}`}>
                  {isReplication && <StoryboardFirstFrame source={resolvedReferenceUrl || seed?.referenceMediaUrl} firstFrameRef={referenceLines[index]?.firstFrameRef} time={referenceLines[index]?.firstFrameSeconds ?? shotStart(referenceLines[index]?.time || '')} label={`口播 ${index + 1}`} />}
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold ${active ? 'border-blue-600 bg-blue-600 text-white' : 'border-border text-text-muted'}`}>{index + 1}</span>
                  <span className="min-w-0 flex-1"><span className="block text-xs font-bold leading-5 text-text-primary">{line || '该分镜暂无可识别口播'}</span><span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-text-muted">{isReplication ? referenceLines[index]?.time : `00:${String(index * 4).padStart(2, '0')}–00:${String((index + 1) * 4).padStart(2, '0')}`}<ChevronRight size={11} /></span>{isReplication && referenceLines[index]?.visuals.length > 0 && <span className="mt-1 line-clamp-2 text-[10px] leading-4 text-text-muted">画面：{referenceLines[index].visuals[0]}</span>}</span>
                </button>
                {isReplication && referenceLines[index]?.visualShotCount > 0 && <>
                  <button type="button" aria-expanded={expandedSpeechLines.has(index)} aria-controls={`speech-visual-shots-${index}`} onClick={() => setExpandedSpeechLines(current => {
                    const next = new Set(current);
                    if (next.has(index)) next.delete(index); else next.add(index);
                    return next;
                  })} className="mt-1 flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-[11px] font-bold text-blue-600">
                    覆盖 {referenceLines[index].visualShotCount} 个分镜
                    <ChevronDown size={14} className={`transition-transform ${expandedSpeechLines.has(index) ? 'rotate-180' : ''}`} />
                  </button>
                  {expandedSpeechLines.has(index) && <ol id={`speech-visual-shots-${index}`} className="mt-1 space-y-1.5 border-l-2 border-emerald-100 pl-3">
                    {referenceLines[index].shots.map((shot, shotIndex) => {
                      const shotTime = Number.isFinite(shot.startSeconds) && Number.isFinite(shot.endSeconds)
                        ? `${shot.startSeconds!.toFixed(2)}–${shot.endSeconds!.toFixed(2)}s` : shot.time;
                      return <li key={`${shotIndex}:${shot.firstFrameRef || shot.visual || ''}`}>
                        <button type="button" onClick={() => { setActiveLine(index); setSeekRequestId(current => current + 1); setRequestedSeek((shot.startSeconds ?? shot.firstFrameSeconds ?? shotStart(shot.time)) + 0.05); }} className="flex w-full items-start gap-2 rounded-lg border border-border bg-white p-2 text-left hover:border-emerald-300">
                          <StoryboardFirstFrame source={resolvedReferenceUrl || seed?.referenceMediaUrl} firstFrameRef={shot.firstFrameRef} time={shot.firstFrameSeconds ?? shot.startSeconds ?? shotStart(shot.time)} label={`分镜 ${shotIndex + 1}`} />
                          <span className="min-w-0 flex-1"><span className="block text-[10px] font-bold text-zinc-700">分镜 {shotIndex + 1} · {shotTime}</span><span className="mt-1 line-clamp-3 text-[10px] leading-4 text-text-secondary">{shot.visual || '画面待分析'}</span></span>
                        </button>
                      </li>;
                    })}
                  </ol>}
                </>}
                {isReplication && line.trim() && speechGenerated && <div className={`mt-2 rounded-lg border p-2 ${productMappings.some(mapping => mapping.sourceTerm && line.toLocaleLowerCase().includes(mapping.sourceTerm.toLocaleLowerCase())) ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-200' : 'border-zinc-200 bg-zinc-50'}`}><p className="text-[10px] font-bold text-zinc-700">替换后口播 · 请检查</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-text-primary">{highlightSpeech(speechEdits[index] ?? generatedSpeech?.[index] ?? '', line)}</p><label className="mt-2 block text-[10px] font-bold text-zinc-700">编辑口播<textarea aria-label={`第 ${index + 1} 句新口播`} value={speechEdits[index] ?? generatedSpeech?.[index] ?? ''} onChange={event => setSpeechEdits(current => ({ ...current, [index]: event.target.value }))} rows={3} className="mt-1 w-full resize-y rounded-md border border-border bg-white p-2 text-xs font-normal leading-5 text-text-primary" /></label></div>}
              </li>;
            })}
          </ol>
        </aside>

        <main className="flex min-h-[560px] min-w-0 flex-col bg-[#f5f8f5] lg:min-h-0">
          {!isReplication && <div className="flex items-center justify-end border-b border-black/5 px-5 py-3"><Button size="small" htmlType="button" onClick={() => setHookChooserOpen(true)} className="whitespace-nowrap">更换开场方式</Button></div>}
          <input ref={uploadRef} type="file" multiple={isReplication} accept="video/*,image/*" className="hidden" onChange={event => { const selected = Array.from(event.currentTarget.files || []).slice(0, isReplication ? 12 : 1); event.currentTarget.value = ''; setFiles(selected); if (!isReplication) { setHookMode('upload'); setFreeScriptText(''); setFreeLines([]); setFreeGeneration(null); setFreeHookMaterial(null); } }} />
          {!isReplication && hookMode === 'library' && <div className="max-h-36 overflow-y-auto border-b border-border p-3">{libraryLoading ? <p className="text-xs text-text-muted">正在读取素材库…</p> : libraryHooks.length ? <div className="grid grid-cols-2 gap-2">{libraryHooks.map(item => <button type="button" key={item.id} onClick={() => { setFreeHookMaterial(item); setFiles([]); }} className={`rounded-lg border p-2 text-left text-[10px] ${freeHookMaterial?.id === item.id ? 'border-blue-500 bg-blue-50' : 'border-border'}`}><span className="line-clamp-2 font-bold">{item.name}</span></button>)}</div> : <p className="text-xs text-text-muted">素材库暂无可用图片或视频，可改用上传或暂不指定。</p>}</div>}
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-5">
            <StudioPreviewStage
              ratio={seed?.aspectRatio || '9:16'}
              className="h-full"
              stageClassName="max-h-full rounded-lg border border-border bg-zinc-100"
              ariaLabel={isReplication ? '爆款视频预览' : '开场素材预览'}
            >
              {previewUrl && files[0]?.type.startsWith('video/') ? <video src={previewUrl} controls playsInline preload="metadata" className="h-full w-full object-contain" />
                : previewUrl ? <img src={previewUrl} alt="用户上传素材预览" className="h-full w-full object-contain" />
                : !isReplication && (aiHookCandidate?.url || freeHookMaterial?.url) && (aiHookCandidate || freeHookMaterial)?.type === 'video' ? <video src={(aiHookCandidate || freeHookMaterial)?.url} poster={(aiHookCandidate || freeHookMaterial)?.poster} controls playsInline className="h-full w-full object-contain" />
                : !isReplication && freeHookMaterial?.url ? <img src={freeHookMaterial.url} alt="素材库钩子预览" className="h-full w-full object-contain" />
                : seed?.referenceContentType === 'video' && seed.referenceMediaUrl ? <WorkbenchVideoPreview source={seed.referenceMediaUrl} poster={seed.referenceThumbnail} title={seed.referenceTitle || '爆款视频预览'} seekSeconds={requestedSeek} seekRequestId={seekRequestId} onPlaybackTime={syncPlaybackCard} onResolved={setResolvedReferenceUrl} />
                : seed?.referenceThumbnail ? <img src={seed.referenceThumbnail} alt={isReplication ? '爆款视频预览' : '已选素材预览'} className="h-full w-full object-contain" />
                : <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-8 text-center text-[#294c40]">
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-[#607b71] shadow-none"><Film size={27} /></span>
                    <div><p className="text-base font-semibold">{isReplication ? '等待爆款视频' : hookMode === 'ai' ? aiHookPhase === 'frame' ? '正在生成钩子首帧…' : aiHookPhase === 'video' ? '正在生成 4 秒钩子视频…' : '生成 AI 开场画面' : '尚未指定钩子素材'}</p>{(isReplication || hookMode === 'ai') && <p className="mt-2 text-xs leading-5 text-[#789087]">{isReplication ? '从灵感中心选择爆款后，会在这里显示原视频。' : '将按已选产品、内容目标和目标受众生成，预览满意后再采纳。'}</p>}</div>
                  </div>}
            </StudioPreviewStage>
          </div>
          {!isReplication && hookMode === 'ai' && <div className="border-t border-black/5 px-5 py-3 text-[11px]">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-text-muted">预计费用：Seedream 首帧约 ¥0.30 + Seedance 4 秒 480p 约 ¥0.96；以服务端预算核算为准。</span>
              <div className="flex gap-2">{aiHookCandidate && freeHookMaterial?.id !== aiHookCandidate.id && <button type="button" onClick={adoptAiHook} className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white">采纳此钩子</button>}<button type="button" disabled={['saving','frame','video'].includes(aiHookPhase)} onClick={() => void generateAiHook()} className="rounded-lg border border-blue-200 px-3 py-1.5 font-semibold text-blue-700 disabled:opacity-50">{aiHookPhase === 'failed' ? '重试生成' : aiHookCandidate ? '重新生成' : '确认费用并生成'}</button></div></div>
            {aiHookFrame && !aiHookCandidate && <p className="mt-1 text-text-muted">首帧已生成并入库，正在继续生成视频。</p>}{aiHookEstimatedCost > 0 && <p className="mt-1 text-text-muted">本次已核算预计费用约 ¥{aiHookEstimatedCost.toFixed(2)}</p>}{aiHookError && <p role="alert" className="mt-1 text-red-600">{aiHookError}</p>}{freeHookMaterial && freeHookMaterial.id === aiHookCandidate?.id && <p className="mt-1 font-bold text-emerald-700">已采纳并保存到素材库；刷新后可从当前草稿恢复。</p>}
          </div>}
          {!isReplication && (files.length > 0 || freeHookMaterial || hookMode === 'ai') && <div className="flex items-center justify-between border-t border-black/5 px-5 py-3 text-[11px] text-text-muted"><span>{files.length ? `已选择开场钩子：${files[0]?.name}` : freeHookMaterial ? `已选择开场钩子：${freeHookMaterial.name}` : '请生成、预览并采纳 AI 钩子'}</span>{hookMode === 'upload' && <button type="button" onClick={()=>uploadRef.current?.click()} className="whitespace-nowrap font-semibold text-emerald-700">更换钩子</button>}</div>}
        </main>

        <aside className="flex min-h-0 flex-col border-t border-border bg-white lg:border-l lg:border-t-0">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-text-primary">{isReplication ? productSlots.length ? '产品与品牌替换' : '品牌替换' : '生成设置'}</p>{isReplication && <p className="mt-1 text-[11px] leading-5 text-text-muted">在左侧逐句检查新口播。</p>}</div></div>

            {isReplication && <div className="mt-4">
              {productSlots.length > 0 && <>
              <p className="text-xs font-semibold text-text-primary">默认企业产品</p>
              <p className="mt-1 text-[10px] leading-4 text-text-muted">原口播产品词出现 {productMentions.length} 次，去重后有 {productSlots.length} 个替换对象。选择默认产品会将所有对象设为同一款；之后可在下方逐项调整。</p>
              <details className="mt-2 text-[10px] text-text-secondary"><summary className="cursor-pointer font-bold">查看识别依据与出现次数</summary><div className="mt-1 space-y-1">{productMentions.map((mention, index) => <p key={`${mention.time}:${index}`}>{index + 1}. {mention.time} · 「{mention.sourceLabel}」：{mention.text}</p>)}<p className="text-text-muted">按口播文本统计；画面中的瓶数、配方数量、重复分镜不计为不同口播产品。产品类别词不能证明具体 SKU 数量。</p></div></details>
              <button type="button" aria-expanded={productSelectorOpen} aria-label="选择企业知识库产品" disabled={productsLoading || submitting} onClick={() => setProductSelectorOpen(value => !value)} className="mt-2 flex h-11 w-full items-center justify-between rounded-lg border border-border bg-white px-3 text-left text-xs font-bold text-text-primary disabled:bg-slate-100">
                <span>{productsLoading ? '正在读取企业产品目录…' : primaryProduct ? `默认产品：${primaryProduct.name}` : '请选择默认企业产品'}</span><ChevronRight size={15} className={productSelectorOpen ? 'rotate-90' : ''} />
              </button>
              {productSelectorOpen && <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border bg-white p-2 shadow-none">
                {products.map(item => <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-zinc-50">
                  <input type="radio" name="replication-primary-product" checked={primaryProductId === item.id} disabled={submitting} onChange={() => chooseDefaultProduct(item.id)} className="accent-emerald-700" />
                  <span className="min-w-0 truncate">{item.name}</span>
                </label>)}
                {!products.length && <div className="px-2 py-3 text-xs text-text-muted">企业知识库暂无产品。<button type="button" onClick={() => { try { sessionStorage.setItem('lingshu:enterprise-focus', 'products'); } catch { /* optional storage */ } window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } })); }} className="ml-1 font-bold text-emerald-700 underline">前往录入产品</button></div>}
              </div>}
              {productsUnavailable && <p className="mt-2 flex items-center gap-1 text-[10px] text-amber-700"><CircleAlert size={11} />企业产品目录暂时无法读取</p>}
              <section className="mt-3" aria-label="产品映射设置">
                <div className="mb-2 flex items-center justify-between text-[10px] text-text-muted"><span className="font-bold">产品映射 · {productSlots.length} 项</span>{primaryProduct && productMappings.some(mapping => mapping.productId !== primaryProductId) ? <button type="button" disabled={submitting} onClick={() => chooseDefaultProduct(primaryProductId)} className="font-bold text-emerald-700 disabled:opacity-50">全部使用默认产品</button> : productSlots.length > 2 && <span>上下滚动查看全部</span>}</div>
                <div role="region" aria-label="产品映射列表" tabIndex={0} style={{ maxHeight: 160, overflowY: 'auto', flexShrink: 0 }} className="space-y-2 overscroll-contain pr-1 [scrollbar-gutter:stable]">
              {productSlots.map((slot, index) => <label key={slot.shotId} className="block min-h-[76px] rounded-lg border border-border bg-surface-2 p-2 text-[10px] font-bold text-text-secondary">
                {index + 1}. 原口播「{slot.sourceLabel}」→ 企业产品
                <select aria-label={`原口播产品 ${slot.sourceLabel} 对应企业产品`} value={productMappings[index]?.productId || ''} onChange={event => {
                  const id = event.target.value;
                  setProductSelectionChanged(true);
                  setProductAssignments(current => ({ ...current, [slot.shotId]: id }));
                  if (!primaryProductId && id) setProductId(id);
                }} className="mt-1 w-full rounded-md border border-border bg-white px-2 py-2 text-xs text-text-primary">
                  <option value="">请选择对应产品</option>{products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>)}
                </div>
              </section>
              {!productsReady && <p role="status" className="mt-2 text-[10px] font-bold text-amber-700">请选择默认企业产品，或为每个原口播产品词指定对应产品。</p>}
              </>}
              {!productSlots.length && referenceLines.length > 0 && <p className="text-[10px] leading-4 text-text-muted">原口播未识别到产品词，无需选择企业产品。若识别有遗漏，可补充原词。</p>}
              {referenceLines.length > 0 && <div className="mt-2 flex gap-1.5"><input aria-label="补充原口播产品词" value={newProductTerm} onChange={event => setNewProductTerm(event.target.value)} placeholder="补充未识别的原产品词" className="min-w-0 flex-1 rounded-md border border-border px-2 py-1.5 text-[10px]" /><button type="button" disabled={!newProductTerm.trim()} onClick={() => { const term = newProductTerm.trim(); if (!script.join(' ').toLocaleLowerCase().includes(term.toLocaleLowerCase())) { setGenerationNotice('补充的产品词必须出现在原片口播中。'); return; } if (!productSlots.some(slot => slot.sourceLabel.toLocaleLowerCase() === term.toLocaleLowerCase())) setManualProductTerms(current => [...current, term]); setNewProductTerm(''); setGenerationNotice(''); }} className="rounded-md border border-border bg-white px-2 text-[10px] font-bold disabled:opacity-40">添加</button></div>}
              <div className="mt-3 rounded-lg border border-border bg-surface-2 p-2.5"><p className="text-[10px] font-bold text-text-secondary">企业品牌 · 自动读取</p><p className="mt-1 text-xs text-text-primary">{enterpriseBrandName || '企业知识库尚未填写品牌名称'}</p><p className="mt-1 text-[10px] text-text-muted">新口播使用企业知识库中的品牌信息，无需填写原片品牌名。</p></div>
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3" data-replication-material-supplement><p className="text-[10px] font-bold text-amber-950">本任务商品素材</p><p className="mt-1 text-[10px] leading-4 text-amber-800">上传已选企业产品的包装图片或实拍视频。文件会进入当前制作项目，下一页仍需逐镜确认；不会自动替换第三方包装。</p><button type="button" disabled={submitting} onClick={() => uploadRef.current?.click()} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-800 px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-50"><Upload size={12} />{files.length ? '重新选择商品素材' : '上传商品图片或视频'}</button>{files.length > 0 && <ul className="mt-2 space-y-1">{files.map(file => <li key={`${file.name}:${file.size}:${file.lastModified}`} className="truncate text-[10px] text-amber-900">已选择：{file.name}</li>)}</ul>}<p className="mt-2 text-[10px] leading-4 text-amber-800">人物镜头将在下一页绑定已授权人物；没有授权或账号身份锁时只阻塞人物分支。</p></div>
            </div>}

            {!isReplication && <div className="mt-4 space-y-3">
              <div><p className="text-xs font-semibold text-text-primary">主推产品 · 多选</p><button type="button" aria-expanded={productSelectorOpen} onClick={() => setProductSelectorOpen(value => !value)} disabled={productsLoading || submitting} className="mt-2 flex h-11 w-full items-center justify-between rounded-lg border border-border bg-white px-3 text-left text-xs font-bold"><span>{productsLoading ? '正在读取企业产品…' : selectedFreeProducts.length ? `已选 ${selectedFreeProducts.length} 款：${selectedFreeProducts.map(item => item.name).join('、')}` : '请选择一个或多个产品'}</span><ChevronDown size={14} /></button>{productSelectorOpen && <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-border p-2">{products.map(item => <label key={item.id} className="flex items-center gap-2 rounded-lg p-2 text-xs hover:bg-zinc-50"><input type="checkbox" checked={selectedProductIds.includes(item.id)} onChange={event => { setSelectedProductIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id)); setProductId(current => event.target.checked && !current ? item.id : current === item.id && !event.target.checked ? '' : current); setFreeScriptText(''); setFreeLines([]); setFreeGeneration(null); }} /><span>{item.name}</span></label>)}</div>}{!productsLoading && !products.length && <span className="mt-2 block text-[10px] font-normal text-amber-700">请先在企业中心录入产品。</span>}</div>
              <label className="block text-[10px] font-bold">内容目标<select value={contentGoal} onChange={event => setContentGoal(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs"><option>种草</option><option>询盘</option><option>品牌认知</option><option>活动推广</option></select></label>
              <label className="block text-[10px] font-bold">目标受众<input value={targetAudience} onChange={event => setTargetAudience(event.target.value)} className="mt-1 w-full rounded-lg border border-border p-2 text-xs" /></label>
              <div className="grid grid-cols-2 gap-2"><label className="text-[10px] font-bold">发布平台<select value={platform} onChange={event => setPlatform(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs"><option>TikTok</option><option>Instagram</option><option>YouTube</option><option>Facebook</option></select></label><label className="text-[10px] font-bold">内容语言<select value={contentLanguage} onChange={event => setContentLanguage(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs"><option value="zh">中文</option><option value="en">English</option></select></label></div>
              <label className="block text-[10px] font-bold">强调卖点<textarea value={sellingPoints} onChange={event => setSellingPoints(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-border p-2 text-xs" /></label>
              <div className="grid grid-cols-2 gap-2"><label className="text-[10px] font-bold">期望时长<input type="number" min={5} max={300} value={desiredDuration} onChange={event => setDesiredDuration(Number(event.target.value) || 20)} className="mt-1 w-full rounded-lg border border-border p-2 text-xs" /></label><label className="text-[10px] font-bold">表达语气<input value={tone} onChange={event => setTone(event.target.value)} className="mt-1 w-full rounded-lg border border-border p-2 text-xs" /></label></div>
              <label className="block text-[10px] font-bold">CTA<input value={callToAction} onChange={event => setCallToAction(event.target.value)} placeholder={enterpriseCtas[0] || '例如：私信获取产品目录'} className="mt-1 w-full rounded-lg border border-border p-2 text-xs" /></label>
              <label className="block text-[10px] font-bold">禁止表达<input value={prohibitedClaims} onChange={event => setProhibitedClaims(event.target.value)} className="mt-1 w-full rounded-lg border border-border p-2 text-xs" /></label>
              <label className="block text-[10px] font-bold">补充说明<textarea value={briefNotes} onChange={event => setBriefNotes(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-border p-2 text-xs" /></label>
            </div>}
            {enterpriseProfileState === 'ready' && enterpriseCtas.length > 0 && <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
              <div className="flex items-center gap-2"><Megaphone size={14} /><p className="text-xs font-semibold text-text-primary">CTA · 已从企业知识库读取</p></div>
              {enterpriseCtas.map(cta => <p key={cta} className="mt-1 text-[10px] leading-5 text-text-secondary">{cta}</p>)}
            </div>}
            {enterpriseProfileState === 'ready' && !enterpriseCtas.length && <div className="mt-4 rounded-lg border border-dashed border-amber-200 bg-amber-50/60 p-3">
              <div className="flex items-center gap-2"><Megaphone size={14} className="text-amber-700" /><p className="text-xs font-semibold text-amber-950">尚未设置 CTA</p></div>
              <p className="mt-1 text-[10px] leading-5 text-amber-800">企业社媒策略尚未保存 CTA，填写后后续内容自动复用。</p>
              <button type="button" onClick={() => { try { sessionStorage.setItem('lingshu:enterprise-focus', 'social-strategy'); } catch { /* optional storage */ } window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } })); }} className="mt-2 text-[10px] font-semibold text-amber-800 underline underline-offset-2">前往企业中心填写</button>
            </div>}
            {enterpriseProfileState !== 'ready' && <p className="mt-4 text-[10px] text-text-muted">{enterpriseProfileState === 'loading' ? '正在读取企业 CTA…' : '企业 CTA 暂时无法读取，请稍后重试。'}</p>}

          </div>

        </aside>
      </div>
      <footer className="min-h-[76px] shrink-0 border-t border-border bg-white px-5 py-3"><div className="flex w-full items-center justify-end gap-6">
            {/* GENERATION_INTEGRATION_GAP: the server calculates estimatedCostCny only
                after a task plan exists; there is no preflight quote endpoint yet. */}
            {isReplication && <div className="flex items-center gap-3 text-[11px]"><span className="text-text-muted">预计消耗</span><span className="font-semibold text-text-primary" title="生成任务建立后由服务端返回真实预估">待生成服务核算</span></div>}
            <button type="button" disabled={submitting || generatingSpeech || productSelectionLoading || (!isReplication && (!selectedProductIds.length || (freeLines.length > 0 && !freeReady))) || (isReplication && (!productsReady || !confirmedSpeech.length || (speechGenerated && confirmedSpeech.some(line => !line.draft.trim()))))} onClick={() => { if (isReplication && !speechGenerated) void generateSpeech(); else void startGeneration(); }} className="flex min-w-[220px] items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-none hover:bg-[#245644] disabled:cursor-not-allowed disabled:bg-slate-300">
              {submitting || generatingSpeech ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}{submitting ? '正在处理…' : generatingSpeech ? '正在生成英文口播' : isReplication ? speechGenerated ? '确认口播，进入分镜匹配' : '生成口播' : freeScriptText ? '确认口播，进入分镜制作' : 'Gemini 生成逐句口播与分镜'}
            </button>
          </div></footer>
    </section>
  );
}
