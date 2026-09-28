import ReplicationWorkbenchHeader from './ReplicationWorkbenchHeader';
import { useEffect, useRef, useState } from 'react';
import { groupSpeechShots, timeRange, type PictureShot, type SpeechGroup } from './speechShotGroups';
import { WorkbenchVideoPreview, StoryboardFirstFrame } from './SocialCreationWorkbench';

type SpeechLine = SpeechGroup;
type Draft = { signature: string; edits: Record<string, string>; deletedIds?: string[]; deletedShotIds?: string[] };
type ProductOption = { id: string; label: string; info?: string };
type ProductSlot = { shotId: string; sourceLabel: string; time: string };
export default function ReplicationSpeechConfirmation({ projectTitle, draftFrames = [], lines, productOptions, selectedProductIds, productSlots, productAssignments, productTerms, brand, videoUrl, poster, shots, voices, selectedVoice, speed, onSpeedChange, onVoiceChange, onVoiceUpload, voiceCapabilityMessage, savedDraft, onDraftChange, busy, status, notice, confirmationError, onProductSelectionChange, onProductMappingChange, onProductTermChange, onPreview, onConfirm }: {
  draftFrames?: Array<{id: string; source?: string; type?: string; time: number}>; projectTitle?: string; lines: SpeechLine[]; productOptions: ProductOption[]; selectedProductIds: string[]; productSlots: ProductSlot[]; productAssignments: Record<string, string>; productTerms: Record<string, string>; brand: string; videoUrl?: string; poster?: string; shots: PictureShot[]; savedDraft?: Draft; onDraftChange: (draft: Draft) => void;
  voices: Array<{id: string; name: string}>; selectedVoice: string; speed: number; onSpeedChange: (speed: number) => void; onVoiceChange: (id: string) => void; onVoiceUpload: (files: FileList | null) => void; voiceCapabilityMessage: string;
  busy: boolean; status: string; notice: string; confirmationError?: string; onProductSelectionChange: (productId: string) => void; onProductMappingChange: (shotId: string, productId: string) => void; onProductTermChange: (shotId: string, sourceTerm: string) => void; onPreview: (lines: SpeechLine[]) => Promise<string>; onConfirm: (lines: SpeechLine[]) => Promise<void>;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [deletedShotIds, setDeletedShotIds] = useState<string[]>([]);
  const [activeShotId, setActiveShotId] = useState('');
  const [tab, setTab] = useState<'source' | 'draft'>('source');
  const cardList = useRef<HTMLOListElement>(null);
  const cardRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const [activeId, setActiveId] = useState('');
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; kind?: 'shot' } | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const confirmationInFlight = useRef(false);
  const [resolvedUrl, setResolvedUrl] = useState('');
  const firstProductSelect = useRef<HTMLSelectElement>(null);
  const [seek, setSeek] = useState(0);
  const [seekRequest, setSeekRequest] = useState(0);
  const signature = JSON.stringify(lines);
  useEffect(() => { setAudioUrl(''); }, [selectedVoice, speed]);
  useEffect(() => { setEdits(savedDraft?.signature === signature ? savedDraft.edits : {}); setDeletedIds(savedDraft?.signature === signature ? savedDraft.deletedIds || [] : []); setDeletedShotIds(savedDraft?.signature === signature ? savedDraft.deletedShotIds || [] : []); setAudioUrl(''); }, [signature, savedDraft?.signature]);
  const drafts = lines.filter(line => !deletedIds.includes(line.id)).map(line => ({ ...line, draft: edits[line.id] ?? line.draft, excludedShotIds: deletedShotIds }));
  const groups = groupSpeechShots(drafts, shots, deletedShotIds);
  const shotCount = new Set(groups.flatMap(group => group.shots.map(shot => shot.id))).size;
  useEffect(() => {
    const panel = cardList.current;
    const card = cardRefs.current[`${activeId}:${activeShotId}`] || cardRefs.current[activeId];
    if (!panel || !card) return;
    const box = card.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
    if (box.top < bounds.top || box.bottom > bounds.bottom) panel.scrollTo({ top: panel.scrollTop + box.top - bounds.top - 8, behavior: 'smooth' });
  }, [activeId, activeShotId, tab]);
  const mappedProductIds = productSlots.map(slot => productAssignments[slot.shotId] || '').filter(Boolean);
  const productReady = productSlots.length
    ? mappedProductIds.length === productSlots.length && new Set(mappedProductIds).size === productSlots.length
      && mappedProductIds.every(id => productOptions.some(option => option.id === id))
      && productSlots.every(slot => (productTerms[slot.shotId] ?? slot.sourceLabel).trim())
    : selectedProductIds.length > 0 && selectedProductIds.every(id => productOptions.some(option => option.id === id));
  const disabled = busy || previewBusy || confirmBusy || !drafts.length || drafts.some(line => !line.draft.trim()) || !productReady;
  const persist = (nextEdits: Record<string,string>, nextDeleted: string[]) => { setEdits(nextEdits); setDeletedIds(nextDeleted); onDraftChange({ signature, edits: nextEdits, deletedIds: nextDeleted, deletedShotIds }); setAudioUrl(''); };
  const audition = async () => { setPreviewBusy(true); setPreviewError(''); try { setAudioUrl(await onPreview(drafts)); setTab('draft'); } catch (error) { setPreviewError(error instanceof Error ? error.message : '试听生成失败'); } finally { setPreviewBusy(false); } };
  const confirm = async () => {
    if (disabled || confirmationInFlight.current) return;
    confirmationInFlight.current = true;
    setConfirmBusy(true);
    setConfirmError('');
    try { await onConfirm(drafts); }
    catch (error) { setConfirmError(error instanceof Error ? error.message : '口播确认失败，请重试。'); }
    finally { confirmationInFlight.current = false; setConfirmBusy(false); }
  };
  return <div className="flex h-full min-h-0 flex-col bg-[#f2f7f4]" onClick={() => setMenu(null)}>
    <ReplicationWorkbenchHeader activeStep={0} maxNavigableStep={0} title={projectTitle} navigationDisabled={busy || previewBusy || confirmBusy} />
    <div className="social-creation-workbench-layout grid min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
      <aside className="flex min-h-0 flex-col border-r border-border bg-white"><div className="border-b border-border p-4"><h2 className="font-bold">{!drafts.length && busy ? '口播与镜头组 · 准备中' : `口播 · ${drafts.length} 组 / ${shotCount} 个镜头`}</h2><p className="mt-1 text-xs text-text-muted">{tab === 'source' ? '完整口播下挂独立镜头，点击首帧定位。' : '编辑整组口播；下方镜头可独立删除、后续匹配素材。'}</p></div><ol ref={cardList} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">{!groups.length && <li role="status" className="rounded-lg border border-dashed border-border p-4 text-xs leading-5 text-text-muted">{busy ? status || notice || '正在准备口播与镜头组…' : '暂无可用口播，请检查原片分析结果。'}</li>}{groups.map((line,index) => <li key={line.id} ref={element => { cardRefs.current[line.id] = element; }} aria-current={activeId === line.id ? 'step' : undefined} onClick={() => { setActiveId(line.id); const start = Number(line.time.match(/[\d.]+/)?.[0]); if (Number.isFinite(start)) { setSeek(start); setSeekRequest(value => value + 1); } }} onContextMenu={event => { event.preventDefault(); if (!busy && !previewBusy) setMenu({ id: line.id, x: Math.min(event.clientX, window.innerWidth - 180), y: Math.min(event.clientY, window.innerHeight - 70) }); }} className={`rounded-lg border p-3 ${activeId === line.id ? 'border-emerald-500 bg-emerald-50' : 'border-border'}`}><div className="mb-2 flex items-start gap-3"><div><p className="text-xs font-bold text-emerald-800">口播组 {index + 1} · {line.time}</p><p className="mt-1 text-[10px] text-text-muted">{line.shots.length} 个独立镜头 · {line.sourcePrecision === 'phrase' ? '音频已对齐' : '口播时间待精确对齐'}</p></div></div><textarea aria-label={`第 ${index + 1} 句新口播`} disabled={busy || previewBusy} readOnly={tab === 'source'} value={tab === 'source' ? line.source : line.draft} onChange={event => persist({ ...edits, [line.id]: event.target.value }, deletedIds)} className="min-h-20 w-full resize-y rounded border border-emerald-100 bg-transparent p-2 text-sm leading-6"/><details className="mt-1 text-xs text-text-muted"><summary className="cursor-pointer">原口播</summary><p className="mt-1 leading-5">{line.source}</p></details><ol aria-label={`口播组 ${index + 1} 的素材卡片`} className="mt-3 space-y-2">{line.shots.map((shot, shotIndex) => <li key={shot.id} ref={element => { cardRefs.current[`${line.id}:${shot.id}`] = element; }} aria-current={activeShotId === shot.id ? 'true' : undefined} onClick={event => { event.stopPropagation(); setActiveId(line.id); setActiveShotId(shot.id); setSeek(shot.start); setSeekRequest(value => value + 1); }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!busy && !previewBusy) setMenu({ id: shot.id, kind: 'shot', x: Math.min(event.clientX, window.innerWidth - 180), y: Math.min(event.clientY, window.innerHeight - 70) }); }} className={`flex cursor-pointer gap-2 rounded border p-2 ${activeShotId === shot.id ? 'border-emerald-500 bg-emerald-100' : 'border-border bg-white'}`}>
{tab === 'source' ? <StoryboardFirstFrame source={resolvedUrl || videoUrl} firstFrameRef={shot.firstFrameRef} time={shot.firstFrameSeconds ?? shot.start} label={`镜头 ${shotIndex + 1}`}/> : draftFrames.find(frame => frame.id === shot.id)?.source ? <StoryboardFirstFrame imageUrl={draftFrames.find(frame => frame.id === shot.id)?.type === 'image' ? draftFrames.find(frame => frame.id === shot.id)?.source : undefined} source={draftFrames.find(frame => frame.id === shot.id)?.type === 'video' ? draftFrames.find(frame => frame.id === shot.id)?.source : undefined} time={draftFrames.find(frame => frame.id === shot.id)?.time || 0} label={`草稿镜头 ${shotIndex + 1}`}/> : <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded bg-emerald-50 text-[10px] text-text-muted">待匹配素材</div>}

<div className="min-w-0"><p className="text-[11px] font-bold">镜头 {shotIndex + 1} · {shot.time}</p><p className="mt-1 line-clamp-3 text-[10px] text-text-muted">{tab === 'source' ? shot.visual || '独立画面素材' : draftFrames.find(frame => frame.id === shot.id)?.source ? '已匹配企业素材' : '尚未匹配企业素材'}</p>{tab === 'source' && shot.spokenFragment && <p className="mt-1 text-xs">{shot.spokenFragment}</p>}<p className="mt-1 text-[10px] text-emerald-700">共享本组连续口播 · 独立匹配素材</p></div></li>)}</ol></li>)}</ol></aside>
      <main className="flex min-h-0 min-w-0 flex-col p-4"><div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-bold">画面预览</h2><div role="tablist" aria-label="视频预览" className="flex rounded-lg border border-border bg-white p-1">{(['source','draft'] as const).map(value => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`rounded px-3 py-2 text-xs font-bold ${tab === value ? 'bg-emerald-50 text-emerald-800' : 'text-text-muted'}`}>{value === 'source' ? '爆款视频预览' : '新建草稿预览'}</button>)}</div></div><div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-border bg-[#e7ece9]">{tab === 'draft' ? <div role="status" className="text-center text-text-muted"><p className="text-sm font-bold">暂无画面预览</p><p className="mt-2 text-xs">确认口播并匹配分镜素材后，显示新建草稿画面。</p></div> : videoUrl ? <WorkbenchVideoPreview source={videoUrl} poster={poster} title={tab === 'source' ? '爆款视频预览' : '新建草稿画面预览'} seekSeconds={seek} seekRequestId={seekRequest} onResolved={setResolvedUrl} onPlaybackTime={t => { const shot = shots.find(item => { const range = timeRange(item.time); return range && t >= range.start && t < range.end; }); setActiveShotId(shot?.shotId || (shot ? `shot-${shots.indexOf(shot) + 1}` : '')); const line = [...drafts].reverse().find(item => { const nums = item.time.match(/[\d.]+/g)?.map(Number) || []; return t >= nums[0]; }); setActiveId(line?.id || drafts[0]?.id || ''); }}/> : <p className="text-sm text-text-muted">原片视频暂不可用</p>}
          
          </div></main>
      <aside className="min-h-0 overflow-y-auto border-l border-border bg-white p-4">
        <h2 className="mb-4 font-bold">创作信息</h2>
        <section aria-label="产品选择与映射" className="rounded-lg border border-border bg-emerald-50/40 p-3 text-sm">
          <h3 className="font-bold text-text-primary">主推产品与替换映射</h3>
          <p className="mt-1 text-[10px] leading-4 text-text-muted">直接在当前复刻任务中选择，系统会保存到同一草稿，不再跳转到其他页面。</p>
          {productSlots.length ? <div className="mt-3 space-y-3">{productSlots.map((slot, index) => {
            const selectedId = productAssignments[slot.shotId] || '';
            return <div key={slot.shotId} className="rounded-lg border border-emerald-100 bg-white p-2.5">
              <p className="text-[11px] font-bold text-text-primary">产品位 {index + 1}{slot.time ? ` · ${slot.time}` : ''}</p>
              <label className="mt-2 block text-[10px] text-text-muted">原口播产品词
                <input aria-label={`原片产品 ${index + 1} 的口播词`} value={productTerms[slot.shotId] ?? slot.sourceLabel} disabled={busy || previewBusy} onChange={event => onProductTermChange(slot.shotId, event.target.value)} className="mt-1 h-8 w-full rounded-md border border-border bg-white px-2 text-xs text-text-primary" />
              </label>
              <label className="mt-2 block text-[10px] text-text-muted">替换为企业产品
                <select ref={index === 0 ? firstProductSelect : undefined} aria-label={`原片产品 ${index + 1} 对应企业产品`} value={selectedId} disabled={busy || previewBusy} onChange={event => onProductMappingChange(slot.shotId, event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-white px-2 text-xs font-bold text-text-primary">
                  <option value="">请选择企业产品</option>
                  {productOptions.map(option => <option key={option.id} value={option.id} disabled={productSlots.some(other => other.shotId !== slot.shotId && productAssignments[other.shotId] === option.id)}>{option.label}</option>)}
                </select>
              </label>
              {selectedId && productOptions.find(option => option.id === selectedId)?.info && <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-text-muted">{productOptions.find(option => option.id === selectedId)?.info}</p>}
            </div>;
          })}</div> : <label className="mt-3 block text-[10px] text-text-muted">主推产品
            <select ref={firstProductSelect} aria-label="主推产品" value={selectedProductIds[0] || ''} disabled={busy || previewBusy} onChange={event => onProductSelectionChange(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-white px-2 text-xs font-bold text-text-primary">
              <option value="">请选择企业产品</option>{productOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>}
          {!productOptions.length && <p role="status" className="mt-2 text-[10px] font-bold text-amber-700">企业知识库暂无可选产品，请先在企业中心补充产品资料。</p>}
          {!productReady && productOptions.length > 0 && <p role="status" className="mt-2 text-[10px] font-bold text-amber-700">请选择企业产品并完成全部产品位映射。</p>}
          <div className="mt-3 border-t border-emerald-100 pt-3"><p className="text-[10px] text-text-muted">企业品牌</p><p className="mt-1 font-bold">{brand || '企业知识库未填写品牌'}</p></div>
        </section>
        <section className="mt-4 rounded-lg border border-border p-3"><h3 className="text-sm font-bold">配音与个人声音</h3><label className="mt-3 block text-xs text-text-muted">配音音色<select aria-label="配音音色" disabled={busy || previewBusy} value={selectedVoice} onChange={event => onVoiceChange(event.target.value)} className="mt-2 w-full rounded border border-border bg-white p-2 text-sm">{voices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="mt-3 block text-xs text-text-muted">配音语速 · {speed.toFixed(2)} 倍<input aria-label="配音语速" type="range" min="0.85" max="1.30" step="0.05" value={speed} disabled={busy || previewBusy} onChange={event => onSpeedChange(Number(event.target.value))} className="mt-2 w-full accent-emerald-700"/><span className="flex justify-between text-[10px]"><span>0.85 舒缓</span><span>1.15 较快</span><span>1.30 快节奏（默认）</span></span></label><label className="mt-3 block cursor-pointer rounded border border-border p-2 text-center text-xs font-bold">上传个人声音样本<input aria-label="上传个人声音样本" type="file" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4" disabled={busy || previewBusy} className="mt-2 block w-full text-xs" onChange={event => { onVoiceUpload(event.target.files); event.target.value = ''; }}/></label><p className="mt-2 text-[11px] leading-5 text-text-muted">上传本人或已获授权的人声录音，至少 10 秒，支持 MP3、WAV、M4A。单人清晰说话，无背景音乐。</p><p className="mt-2 text-[11px] leading-5 text-text-muted">{voiceCapabilityMessage}</p></section>
        <div className="mt-4 space-y-3">{audioUrl && <audio src={audioUrl} controls aria-label="新口播试听" className="w-full"/>}<button disabled={disabled} onClick={() => void audition()} className="w-full rounded-lg border border-border py-3 text-sm font-bold disabled:opacity-50">{previewBusy ? '正在生成试听…' : '试听新口播'}</button>{(notice || previewError) && <p role="status" className="text-xs leading-5 text-text-secondary">{previewError || notice}</p>}</div>
      </aside>
    </div>
    {menu && <div role="menu" className="fixed z-50 rounded-lg border border-border bg-white p-1 shadow-xl" style={{ left: menu.x, top: menu.y }}><button role="menuitem" onClick={() => { if (menu.kind === 'shot') { const next = [...deletedShotIds, menu.id]; setDeletedShotIds(next); onDraftChange({ signature, edits, deletedIds, deletedShotIds: next }); } else persist(edits, [...deletedIds, menu.id]); setMenu(null); }} className="px-4 py-2 text-sm text-red-600">{menu.kind === 'shot' ? '删除该镜头' : '删除整组口播'}</button></div>}
    {(confirmationError || confirmError) && <div role="alert" aria-live="assertive" className="flex shrink-0 items-center justify-between gap-3 border-t border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-950"><span>{confirmError || confirmationError}</span><button type="button" disabled={busy || confirmBusy} onClick={() => { firstProductSelect.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); firstProductSelect.current?.focus(); }} className="shrink-0 font-bold underline">在右侧选择产品</button></div>}
    <footer className="flex min-h-[76px] shrink-0 items-center justify-end border-t border-border bg-white px-5 py-3"><button disabled={disabled} onClick={() => void confirm()} className="rounded-lg bg-[#173d31] px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{busy || confirmBusy ? status || '正在准备分镜…' : '确认口播，进入分镜匹配'}</button></footer>
  </div>;
}
