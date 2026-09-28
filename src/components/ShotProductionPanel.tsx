import { presenterApi } from '../lib/presenterApi';
import type { PresenterVoice } from '../lib/presenterAssets';
import { productionApi } from '../lib/productionApi';
import PresenterManager from './enterprise/PresenterManager';
import { useEffect, useRef, useState } from 'react';
import { parseShotCommand, presenterCapabilities, shotFingerprint, shotBlockers, type ShotProduction, type ProductionDefaults, type AvatarJob, type PresenterAsset } from '../lib/shotProduction';
import { avatarCandidateReady } from '../lib/shotProduction';
import { newDigitalHumanRequirements, planDigitalHumanShot, referenceCues } from '../lib/digitalHumanPlan';
import DigitalHumanRequirementsEditor from './studio/DigitalHumanRequirementsEditor';
import ShotRoutingRecommendation from './studio/ShotRoutingRecommendation';
import { presentShotRouting } from '../lib/shotRoutingPresentation';
import type { DigitalHumanExecutionRecord, DigitalHumanPlanRecord, SentenceReplicationResult } from '../lib/digitalHumanPlan';
import type { ShotKeyframeCue } from '../lib/shotKeyframes';

type Asset = { id: string; name: string; type?: string; url?: string; poster?: string; duration?: number };

function VideoKeyframe({ asset, shotDuration, time, label }: { asset: Asset; shotDuration: number; time: number; label: string }) {
  const seek = (video: HTMLVideoElement) => {
    const mediaDuration = Number.isFinite(video.duration) ? video.duration : Number(asset.duration) || shotDuration;
    const target = shotDuration > 0 ? time / shotDuration * mediaDuration : time;
    video.currentTime = Math.max(0, Math.min(Math.max(0, mediaDuration - 0.05), target));
  };
  return <figure className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-slate-950">
    <video src={asset.url} muted playsInline preload="metadata" onLoadedMetadata={event => seek(event.currentTarget)} onSeeked={event => event.currentTarget.pause()} className="aspect-video w-full object-cover" aria-label={label} />
    <figcaption className="px-2 py-1 text-[9px] text-slate-300">{label} · {time.toFixed(1)}s</figcaption>
  </figure>;
}

function ReferenceCandidateComparison({ sourceUrl, sourceStart, sourceEnd, candidate, cues }: {
  sourceUrl: string; sourceStart: number; sourceEnd: number; candidate: Asset; cues: ReturnType<typeof referenceCues>;
}) {
  const sourceRef = useRef<HTMLVideoElement>(null); const candidateRef = useRef<HTMLVideoElement>(null);
  const seek = (sourceTime: number) => {
    if (sourceRef.current) sourceRef.current.currentTime = Math.max(sourceStart, sourceTime);
    if (candidateRef.current) candidateRef.current.currentTime = Math.max(0, sourceTime - sourceStart);
  };
  return <section className="rounded-lg border border-violet-200 bg-violet-50 p-2" aria-label="原片与候选对照">
    <div className="grid grid-cols-2 gap-2">
      <figure><video ref={sourceRef} aria-label="原片参考片段" src={sourceUrl} controls playsInline preload="metadata" onLoadedMetadata={() => seek(sourceStart)} onTimeUpdate={event => { if (sourceEnd > sourceStart && event.currentTarget.currentTime >= sourceEnd) event.currentTarget.pause(); }} className="aspect-video w-full rounded bg-black object-contain" /><figcaption className="mt-1 text-[10px] font-bold">原片 · {sourceStart.toFixed(1)}–{sourceEnd.toFixed(1)} 秒</figcaption></figure>
      <figure><video ref={candidateRef} aria-label="数字人候选片段" src={candidate.url} controls playsInline preload="metadata" className="aspect-video w-full rounded bg-black object-contain" /><figcaption className="mt-1 text-[10px] font-bold">候选 · {candidate.name}</figcaption></figure>
    </div>
    {cues.length > 0 && <div className="mt-2 space-y-1">{cues.map((cue, index) => <button key={cue.id} type="button" onClick={() => seek(cue.start)} className="block w-full rounded border bg-white px-2 py-1 text-left text-[10px]"><b>定位句 {index + 1} · {cue.start.toFixed(1)}–{cue.end.toFixed(1)}s</b><span className="block">原片：{cue.originalText}</span><span className="block text-text-muted">本片：{cue.targetText || '沿用当前分镜口播'}</span></button>)}</div>}
  </section>;
}
export default function ShotProductionPanel(props: {
  shot: ShotProduction; shotId?: string; scriptNarration?: string; keyframeCues?: ShotKeyframeCue[]; shotDuration?: number; context: string; title: string; defaults: ProductionDefaults; materials: Asset[]; products: { id: string; label: string }[];
  jobs: AvatarJob[]; refreshingJobIds?: string[]; preview?: Asset; reason: string; error: string; busy: boolean; configured: boolean; capabilityReason?: string; costPerSecond: number | null;
  maxAttemptsPerShot?: number;
  viralReplication?: boolean; salesConfiguration?: boolean; applyToSales?: boolean; onApplyToSalesChange?: (value: boolean) => void;
  toolCapabilities?: Array<{ id: string; label: string; execution: boolean; cancellation?: boolean; costReconciliation?: boolean; reason: string; executionProfile?: { maxDurationSeconds?: number; preserves: string[]; qualityInspection: boolean; estimatedCostCnyPerSecond?: number } }>;
  savedPlan?: DigitalHumanPlanRecord;
  executions?: DigitalHumanExecutionRecord[];
  sentenceResult?: SentenceReplicationResult;
  sourcePlan?: { sourceTaskId: string; sourceTaskVersion: string; candidateTools: string[]; executionState: string };
  onChange: (patch: Partial<ShotProduction>) => void; onClose: () => void; onNarration: () => void;
  onCreatePresenter?: (input: { name: string; file: File; subjectAdultConfirmed: boolean; arkProcessingAuthorized?: boolean; heygenProcessingAuthorized?: boolean; arkAssetUri?: string; arkActiveConfirmed?: boolean }) => Promise<PresenterAsset>;
  onDefaults: (value: ProductionDefaults) => Promise<void>; onApplyDefaultsToUnlocked: () => void; onSavePlan: () => void; onPrepareSentenceFrames?: () => void; onPreparePhotoFrames?: () => void; onGenerateSentenceDrafts?:()=>void; onRunSentenceReplication?: () => void; onReviewSentenceCue?: (cueId:string,decisions:Record<string,boolean>,evidence:string)=>void; onRetryFailedSentenceCues?:()=>void; onGenerate: () => void; onAi: () => void; onShoot: () => void;
  onMaterial: () => void; onAdopt: (id: string) => void; onRefresh: (id: string) => void; onRefreshExecution?: (id: string) => void; onCancelExecution?: (id: string) => void; onReconcileExecutionCost?: (id: string) => void; onReviewExecution?: (id: string, decisions: Record<string, boolean>, feedback?: string) => void;
}) {
  const { shot, defaults } = props;
  // Legacy avatar shots predate the visual-intent field, so preserve their
  // established digital-human behaviour while new shots choose explicitly.
  const contentType = shot.contentType || (shot.source === 'avatar' ? 'enterprise_presenter' : 'product');
  const isEnterprisePresenter = contentType === 'enterprise_presenter';
  const isUgc = contentType === 'ugc';
  const isPeopleShot = isEnterprisePresenter || isUgc;
  const selectedPresenter = defaults.presenters.find(item => item.id === shot.presenterId);
  const routingDecision = presentShotRouting(shot, {
    hasPresenter: defaults.presenters.some(item => item.authorized),
    hasMaterial: Boolean(props.preview || props.materials.some(item => item.type !== 'audio')),
    recommendation: props.reason,
  });
  const plan = planDigitalHumanShot({ requirements: shot.digitalHuman, narration: shot.narration,
    hasAuthorizedPresenter: Boolean(selectedPresenter?.authorized), talkingAvailable: props.configured,
    presenterCapabilities: selectedPresenter ? presenterCapabilities(selectedPresenter) : undefined });
  const [defaultsError, setDefaultsError] = useState('');
  const [chargeConfirmed, setChargeConfirmed] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState<Record<string, string>>({});
  const [reviewDecisions, setReviewDecisions] = useState<Record<string, Record<string, boolean>>>({});
  const [cueReviewDecisions, setCueReviewDecisions] = useState<Record<string, Record<string, boolean>>>({});
  const [cueReviewEvidence, setCueReviewEvidence] = useState<Record<string, string>>({});
  useEffect(() => { setChargeConfirmed(false); }, [shotFingerprint(shot, props.context, props.shotId)]);
  const [command, setCommand] = useState(''); const [commandMessage, setCommandMessage] = useState('');
  const [arkGroupId, setArkGroupId] = useState('');
  const [arkAssetUri, setArkAssetUri] = useState('');
  const [photoVoices, setPhotoVoices] = useState<PresenterVoice[]>([]);
  const [photoVoiceError, setPhotoVoiceError] = useState('');
  const [heygenAuthorized, setHeygenAuthorized] = useState(Boolean(selectedPresenter?.authorizationConfirmation?.heygenProcessingAuthorized || selectedPresenter?.rightsEvidence?.permittedProviders.includes('heygen')));
  const [arkNotice, setArkNotice] = useState('');
  const [arkAuthorized, setArkAuthorized] = useState(false);
  const presenterMode = shot.digitalHuman?.presenterMode;
  const viralPhoto = presenterMode === 'photo_talking' && props.viralReplication !== false;
  const selectPresenterMode = (mode: 'video_twin' | 'photo_talking') => props.onChange({ digitalHuman: { ...(shot.digitalHuman || newDigitalHumanRequirements()), presenterMode: mode, workflow: mode === 'photo_talking' && props.viralReplication !== false ? 'viral_replication' : 'material_processing', method: mode === 'photo_talking' && props.viralReplication !== false ? 'reenact' : 'talking', preferredProvider: mode === 'photo_talking' && props.viralReplication !== false ? 'sd' : 'auto', replacementScope: mode === 'photo_talking' && props.viralReplication !== false ? 'person_keep_scene' : undefined, replicationMode: 'sentence_first_frame', targetEffect: mode === 'photo_talking' && props.viralReplication !== false ? 'reference_motion' : 'natural_talking', scene: mode === 'photo_talking' && props.viralReplication !== false ? '沿用爆款口播首帧的场景与构图' : '', action: mode === 'photo_talking' && props.viralReplication !== false ? '人物自然口播，保持原首帧姿态意图' : '', preserve: mode === 'photo_talking' && props.viralReplication !== false ? '保持原首帧背景、光线、产品位置，只替换人物主体' : '', contentConfirmed: false, targetFramesConfirmed:false } });
  const [showHeyGenManager, setShowHeyGenManager] = useState(false);
  const [showPresenterSetup,setShowPresenterSetup]=useState(false);const [presenterSetupBusy,setPresenterSetupBusy]=useState(false);const [presenterSetupError,setPresenterSetupError]=useState('');
  const [presenterSetup,setPresenterSetup]=useState({name:'',file:null as File|null,subjectAdultConfirmed:false,arkAssetUri:'',arkActiveConfirmed:false});
  useEffect(() => { setArkGroupId(selectedPresenter?.arkCertification?.groupId || ''); setArkAssetUri(selectedPresenter?.arkCertification?.assetUri || ''); setArkNotice(''); setArkAuthorized(Boolean(selectedPresenter?.authorizationConfirmation?.arkProcessingAuthorized || selectedPresenter?.rightsEvidence?.permittedProviders.includes('volcengine_ark'))); }, [selectedPresenter?.id]);
  useEffect(() => { if (presenterMode !== 'photo_talking') return; let active = true; presenterApi.voices().then(result => {if(active) setPhotoVoices(result.items);}).catch(error => {if(active) setPhotoVoiceError(error instanceof Error ? error.message : '声音列表加载失败');}); return () => {active = false;}; }, [presenterMode]);
  useEffect(() => { setHeygenAuthorized(Boolean(selectedPresenter?.authorizationConfirmation?.heygenProcessingAuthorized || selectedPresenter?.rightsEvidence?.permittedProviders.includes('heygen'))); }, [selectedPresenter?.id]);
  useEffect(() => { setShowPresenterSetup(false); setShowHeyGenManager(false); setPresenterSetupError(''); }, [presenterMode]);
  const presenterSetupArkValid=!presenterSetup.arkActiveConfirmed||/^asset:\/\/asset-[a-z0-9-]+$/i.test(presenterSetup.arkAssetUri.trim());
  const saveInlinePresenter=async()=>{const file=presenterSetup.file;if(!props.onCreatePresenter||!file)return;setPresenterSetupBusy(true);setPresenterSetupError('');try{const presenter=await props.onCreatePresenter({name:presenterSetup.name,file,subjectAdultConfirmed:presenterSetup.subjectAdultConfirmed,arkProcessingAuthorized:viralPhoto,heygenProcessingAuthorized:presenterMode === 'photo_talking',arkAssetUri:presenterSetup.arkAssetUri.trim()||undefined,arkActiveConfirmed:presenterSetup.arkActiveConfirmed});props.onChange({presenterId:presenter.id,digitalHuman:{...(shot.digitalHuman||newDigitalHumanRequirements()),presenterSelected:true,contentConfirmed:false}});setShowPresenterSetup(false);setPresenterSetup({name:'',file:null,subjectAdultConfirmed:false,arkAssetUri:'',arkActiveConfirmed:false});}catch(error){setPresenterSetupError(error instanceof Error?error.message:'人物保存失败');}finally{setPresenterSetupBusy(false);}};
  const maxAttempts = props.maxAttemptsPerShot || 3;
  const attemptsUsed = props.executions?.filter(execution => execution.submissionOutcome !== 'rejected').length || 0;
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialogRef.current?.focus(); return () => previous?.focus(); }, []);
  const mediaSelect = (label: string, field: 'productMaterialId' | 'backgroundMaterialId') => <label className="block text-xs">{label}<select value={shot[field]} disabled={shot.locked} onChange={e => props.onChange({ [field]: e.target.value })} className="mt-1 w-full rounded-lg border p-2"><option value="">不使用</option>{props.materials.filter(item => item.type !== 'audio').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
  const selectedProduct = props.materials.find(item => item.id === shot.productMaterialId);
  const background = props.materials.find(item => item.id === shot.backgroundMaterialId);
  const renderMedia = (asset?: Asset, cls = '') => !asset?.url ? null : asset.type === 'image' ? <img src={asset.url} alt={asset.name} className={cls} /> : <video src={asset.url} muted controls playsInline className={cls} />;
  if (props.salesConfiguration) return <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 p-4">
    <section ref={dialogRef} tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') props.onClose(); }} role="dialog" aria-modal="true" aria-label="企业数字人配置" style={{ maxHeight: '85vh', maxWidth: 560 }} className="w-full overflow-y-auto rounded-xl bg-white p-5 shadow-2xl">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-bold">企业数字人</h2><button type="button" onClick={props.onClose}>完成</button></div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="数字人模式">{([['video_twin', '视频分身'], ['photo_talking', '照片口播']] as const).map(([mode, label]) => <button type="button" key={mode} aria-pressed={presenterMode === mode} onClick={() => selectPresenterMode(mode)} className={`rounded-lg border py-3 text-sm font-bold ${presenterMode === mode ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : ''}`}>{label}</button>)}</div>
      {presenterMode && <div className="mt-4 space-y-3 border-t pt-4">
      <p className="text-xs text-text-muted">{presenterMode === 'video_twin' ? 'HeyGen · 人物视频 → 本人验证 → 视频分身' : viralPhoto ? 'Seedream · 爆款口播首帧 + 企业人物照片 → 目标首帧 → HeyGen 口播视频' : 'HeyGen · 企业人物照片 + 口播内容 → 口播视频'}</p>
      <label className="block text-xs font-bold">企业人物资产<select aria-label="企业人物资产" className="mt-2 w-full rounded-lg border p-2" value={shot.presenterId || ''} onChange={event => props.onChange({ presenterId: event.target.value, digitalHuman: { ...(shot.digitalHuman || newDigitalHumanRequirements()), presenterSelected: Boolean(event.target.value), contentConfirmed: false } })}>
        <option value="">请选择企业人物</option>{defaults.presenters.map(item => <option key={item.id} value={item.id} disabled={!item.authorized}>{item.name}</option>)}
      </select></label>
      {presenterMode === 'video_twin' && <button type="button" className="mt-2 text-xs font-bold text-accent" onClick={() => setShowHeyGenManager(true)}>{presenterMode === 'video_twin' ? '上传视频并绑定分身' : '上传照片并创建口播形象'}</button>}
      {presenterMode === 'photo_talking' && props.onCreatePresenter && <button type="button" onClick={() => setShowPresenterSetup(value => !value)} className="mt-2 text-xs font-bold text-accent">{showPresenterSetup ? '收起上传' : '上传企业人物照片'}</button>}
      {showPresenterSetup && <div className="mt-3 space-y-2 rounded-lg border p-3">
        <input aria-label="人物名称" value={presenterSetup.name} onChange={event => setPresenterSetup(current => ({ ...current, name: event.target.value }))} placeholder="人物名称" className="w-full rounded border p-2 text-xs" />
        <p className="text-xs text-text-muted">上传清晰单人正脸照片，支持 JPG、PNG，单张不超过 32MB；请勿使用遮挡面部或多人合照。</p>
        <input aria-label="人物图片或视频" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" disabled={presenterSetupBusy} onChange={event => setPresenterSetup(current => ({ ...current, file: event.target.files?.[0] || null }))} className="w-full text-xs" />
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={presenterSetup.subjectAdultConfirmed} onChange={event => setPresenterSetup(current => ({ ...current, subjectAdultConfirmed: event.target.checked }))} />我确认已取得成年出镜本人授权，同意{viralPhoto ? '方舟与 HeyGen' : 'HeyGen'}处理人物照片并生成口播素材</label>
        {presenterSetupError && <p role="alert" className="text-xs text-red-600">{presenterSetupError}</p>}
        <button type="button" disabled={presenterSetupBusy || !presenterSetup.name.trim() || !presenterSetup.file || !presenterSetup.subjectAdultConfirmed} onClick={() => void saveInlinePresenter()} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-40">{presenterSetupBusy ? '正在保存…' : '保存并使用人物'}</button>
      </div>}
      {presenterMode === 'video_twin' && selectedPresenter && !selectedPresenter.avatarId && selectedPresenter.arkCertification?.status !== 'active' && <p role="status" className="mt-2 text-xs text-text-muted">人物已入库；供应商本人验证与资产准备尚未完成。</p>}

      {presenterMode === 'photo_talking' && selectedPresenter && <div className="space-y-2">
        <label className="block text-xs">口播声音<select aria-label="照片口播声音" value={selectedPresenter.voiceId} onChange={async event => { try { const voiceId = event.target.value; await props.onDefaults({...defaults, presenters: defaults.presenters.map(item => item.id === selectedPresenter.id ? {...item, voiceId, toolMappings: {...item.toolMappings, heygen: {avatarId: item.avatarId, voiceId}}} : item)}); } catch(error) {setPhotoVoiceError(error instanceof Error ? error.message : '声音保存失败');} }} className="mt-1 w-full rounded border p-2 text-xs"><option value="">请选择声音</option>{selectedPresenter.voiceId && !photoVoices.some(item => item.id === selectedPresenter.voiceId) && <option value={selectedPresenter.voiceId}>已绑定声音</option>}{photoVoices.map(item => <option key={item.id} value={item.id}>{item.name} · {item.language}</option>)}</select></label>
        {!heygenAuthorized && <button type="button" className="rounded border px-3 py-2 text-xs" onClick={async () => {try {await props.onDefaults({...defaults, presenters: defaults.presenters.map(item => item.id === selectedPresenter.id ? {...item, authorizationConfirmation: {...item.authorizationConfirmation, subjectAdultConfirmed: true, heygenProcessingAuthorized: true}} : item)}); setHeygenAuthorized(true);} catch(error) {setPhotoVoiceError(error instanceof Error ? error.message : '授权保存失败');}}}>已取得成年本人授权，同意 HeyGen 处理照片与口播</button>}
        {photoVoiceError && <p role="alert" className="text-xs text-red-600">{photoVoiceError}</p>}
      </div>}
      {viralPhoto && selectedPresenter && <div className="space-y-2 rounded-lg border p-3">
        <p className="text-xs font-bold">方舟人物认证</p>
        <a href="https://console.volcengine.com/ark/region:ark+cn-beijing/asset" target="_blank" rel="noreferrer" className="text-xs text-accent underline">前往方舟绑定人物与完成本人认证</a>
        <p className="text-xs text-text-muted">返回后关联对应人物图片资产，后续复用。</p>
        <input aria-label="方舟人物资产组" value={arkGroupId} onChange={event => setArkGroupId(event.target.value)} placeholder="group-..." className="w-full rounded border p-2 text-xs" />
        <input aria-label="方舟图片资产" value={arkAssetUri} onChange={event => setArkAssetUri(event.target.value)} placeholder="asset://asset-..." className="w-full rounded border p-2 text-xs" />
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={arkAuthorized} onChange={event => setArkAuthorized(event.target.checked)} />已取得成年本人授权，同意方舟处理人物图片</label>
        <button type="button" disabled={props.busy || !arkAuthorized || !arkGroupId || !arkAssetUri} className="rounded border px-3 py-2 text-xs disabled:opacity-40" onClick={async () => { try { const result = await productionApi.verifyArkAsset({projectName: selectedPresenter.arkCertification?.projectName || 'default', groupId: arkGroupId, assetUri: arkAssetUri}); if (result.assetType !== 'image') throw new Error('请选择人物图片资产'); const materialId = selectedPresenter.referenceMaterialIds?.find(id => props.materials.some(item => item.id === id && item.type === 'image')); if (!materialId) throw new Error('请先上传并绑定企业人物照片'); await props.onDefaults({...defaults, presenters: defaults.presenters.map(item => item.id === selectedPresenter.id ? {...item, authorizationConfirmation: {...item.authorizationConfirmation, subjectAdultConfirmed: true, arkProcessingAuthorized: true}, arkCertification: {projectName: 'default', groupId: arkGroupId, assetUri: arkAssetUri, materialId, ...result}} : item)}); setArkNotice(result.status === 'active' ? '人物图片已认证，可用于首帧生成' : '认证处理中，请稍后同步'); } catch(error) {setArkNotice(error instanceof Error ? error.message : '认证同步失败');} }}>同步认证并绑定</button>
        <details><summary className="cursor-pointer text-xs text-text-muted">无 Assets API 查询权限</summary><button type="button" disabled={props.busy || !arkAuthorized || !/^asset:\/\/asset-[a-z0-9-]+$/i.test(arkAssetUri)} className="mt-2 rounded border px-3 py-2 text-xs disabled:opacity-40" onClick={async () => { try { const materialId = selectedPresenter.referenceMaterialIds?.find(id => props.materials.some(item => item.id === id && item.type === 'image')); if (!materialId) throw new Error('请先绑定对应人物照片'); await props.onDefaults({...defaults, presenters: defaults.presenters.map(item => item.id === selectedPresenter.id ? {...item, authorizationConfirmation: {...item.authorizationConfirmation, subjectAdultConfirmed: true, arkProcessingAuthorized: true}, arkCertification: {projectName: 'default', groupId: arkGroupId, assetUri: arkAssetUri, materialId, assetType: 'image', status: 'active', verificationSource: 'manual_console', syncedAt: new Date().toISOString()}} : item)}); setArkNotice('已记录您在方舟控制台的 Active 确认；未通过 API 自动核验'); } catch(error) {setArkNotice(error instanceof Error ? error.message : '绑定失败');} }}>我已在方舟确认该图片为 Active，绑定人物</button></details>
        {arkNotice && <p role="status" className="text-xs">{arkNotice}</p>}
      </div>}
      {viralPhoto && <div className="flex gap-2"><button type="button" disabled={props.busy || !selectedPresenter} onClick={props.onPreparePhotoFrames} className="rounded border px-3 py-2 text-xs disabled:opacity-40">重建目标首帧</button><button type="button" disabled={props.busy || selectedPresenter?.arkCertification?.status !== 'active' || !selectedPresenter?.voiceId || !heygenAuthorized || !shot.digitalHuman?.contentConfirmed || !shot.digitalHuman?.targetFramesConfirmed || !referenceCues(shot.digitalHuman).filter(cue=>cue.personShot!==false).every(cue => cue.targetFirstFrame?.state === "ready")} onClick={props.onRunSentenceReplication} className="rounded border px-3 py-2 text-xs disabled:opacity-40">生成照片口播素材</button></div>}
      {viralPhoto && referenceCues(shot.digitalHuman).some(cue=>cue.targetFirstFrame?.imageUrl) && <div className="space-y-2"><div className="flex gap-2 overflow-x-auto">{referenceCues(shot.digitalHuman).filter((cue,index,all)=>cue.targetFirstFrame?.imageUrl && all.findIndex(other=>other.targetFirstFrame?.materialId===cue.targetFirstFrame?.materialId)===index).map(cue=><img key={cue.id} src={cue.targetFirstFrame?.imageUrl} alt="目标人物首帧" className="h-40 rounded object-contain" />)}</div><label className="flex gap-2 text-xs"><input type="checkbox" checked={shot.digitalHuman?.targetFramesConfirmed || false} onChange={event=>props.onChange({digitalHuman:{...(shot.digitalHuman || newDigitalHumanRequirements()),targetFramesConfirmed:event.target.checked}})} />确认目标首帧</label></div>}
      {!viralPhoto && <button type="button" disabled={props.busy || !props.configured || !selectedPresenter?.voiceId || !shot.digitalHuman?.contentConfirmed} onClick={props.onGenerate} className="rounded border px-3 py-2 text-xs disabled:opacity-40">{props.busy ? '正在提交…' : '生成口播视频'}</button>}
      <label className="flex gap-2 text-xs"><input type="checkbox" checked={shot.digitalHuman?.contentConfirmed || false} onChange={event => props.onChange({digitalHuman: {...(shot.digitalHuman || newDigitalHumanRequirements()), contentConfirmed: event.target.checked}})} />应用到销售人员口播镜头</label>
      </div>}
      {showHeyGenManager && <PresenterManager fixedMode initialMode={presenterMode === 'video_twin' ? 'expert' : 'quick'} onClose={() => setShowHeyGenManager(false)} onSaved={async next => { await props.onDefaults(next); const presenter = next.presenters.at(-1); if (presenter) props.onChange({ presenterId: presenter.id, digitalHuman: { ...(shot.digitalHuman || newDigitalHumanRequirements()), presenterSelected: true, contentConfirmed: false } }); setShowHeyGenManager(false); }} />}
      {(props.jobs.length > 0 || shot.candidates.length > 0) && <div className="mt-4 space-y-2"><h3 className="text-sm font-bold">生成版本</h3>
        {props.jobs.map(job => <div key={job.id} className="rounded-lg border p-2 text-xs">{job.error?.startsWith('供应商已生成') ? '已生成 · 待入库核验' : ({ submitting: '正在提交', pending: '生成处理中', completed: '候选已就绪', failed: '生成失败', uncertain: '提交结果待核对' }[job.status])} {job.error}
          {job.status === 'pending' && job.error && <p className="mt-1 text-text-muted">已暂停自动重查。处理问题后可手动刷新原任务，不会重新付费生成。</p>}
          <button type="button" disabled={props.refreshingJobIds?.includes(job.id)} onClick={() => props.onRefresh(job.id)} className="ml-2 text-accent disabled:opacity-40">{props.refreshingJobIds?.includes(job.id) ? '正在核验…' : '刷新原任务'}</button></div>)}
        {shot.candidates.map((candidate, index) => { const presenterVersion = Math.max(1, defaults.presenters.find(item => item.id === shot.presenterId)?.assetVersion || 1); const execution = props.executions?.find(item => (item.id === candidate.jobId || item.jobId === candidate.jobId) && item.presenterAssetVersion === presenterVersion); const taskReady = execution ? execution.state === 'completed' && execution.materialId === candidate.materialId && execution.fingerprint === candidate.fingerprint : avatarCandidateReady(candidate, props.jobs); const qualityReady = candidate.source !== 'avatar' || execution?.quality.state === 'accepted'; return <div key={candidate.id} className="space-y-2 rounded-lg border p-2 text-xs">
          <div className="flex justify-between"><span>V{index + 1} · {{ avatar: '数字人镜头', material: '已有素材', ai: '创意画面', shoot: '实拍' }[candidate.source]} {candidate.fingerprint !== shotFingerprint(shot, props.context, props.shotId) ? '· 要求已变化' : ''} {!taskReady ? '· 任务未完成或待核验' : !qualityReady ? '· 待人工验收' : ''}</span><button type="button" disabled={shot.locked || candidate.fingerprint !== shotFingerprint(shot, props.context, props.shotId) || !taskReady || !qualityReady} onClick={() => props.onAdopt(candidate.id)} className="text-accent disabled:opacity-40">{shot.adoptedId === candidate.id ? '当前采用' : '采用 / 恢复'}</button></div>
          {(() => { const asset = props.materials.find(item => item.id === candidate.materialId); const reference = shot.digitalHuman?.reference; return asset?.url && reference?.videoUrl
            ? <ReferenceCandidateComparison sourceUrl={reference.videoUrl} sourceStart={reference.start} sourceEnd={reference.end} candidate={asset} cues={referenceCues(shot.digitalHuman)} />
            : asset?.url ? <video aria-label={`候选 V${index + 1} 预览`} src={asset.url} controls playsInline preload="metadata" className="max-h-64 w-full rounded-lg bg-black" /> : null; })()}
          <p className="text-text-muted">预览确认人物、口播、口型与画面要求后再采用；采用后填入当前分镜。</p>
        </div>; })}
      </div>}
        {props.sentenceResult?.cueQuality?.length ? <section className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-3" aria-label="逐镜质量验收">
          <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-black">逐镜质量验收</h3><span className="text-[10px] text-text-muted">独立检测异常会直接标记失败</span></div>
          {props.sentenceResult.cueQuality.map((cue,index)=>{const pending=cue.checks.filter(check=>check.status==='pending');const decisions=cueReviewDecisions[cue.cueId]||{};const evidence=cueReviewEvidence[cue.cueId]||'';const complete=pending.length>0&&pending.every(check=>decisions[check.key]!==undefined);return <article key={cue.cueId} className="rounded-lg border bg-white p-2 text-[10px]">
            <p className="font-bold">镜头 {index+1} · {{accepted:'已通过',failed:'未通过',manual_review:'待人工验收'}[cue.state]}</p>
            <ul className="mt-1 space-y-1">{cue.checks.map(check=><li key={check.key} className={check.status==='failed'?'text-red-700':check.status==='passed'?'text-emerald-700':'text-amber-700'}><b>{{media:'媒体',identity:'身份',motion:'动作',product_brand_text:'产品/品牌/文字',background:'背景',audio_sync:'音画',reuse_risk:'复用风险'}[check.key]}：</b>{{passed:'通过',failed:'失败',pending:'待验收'}[check.status]} · {check.evidence}</li>)}</ul>
            {pending.length>0&&<div className="mt-2 space-y-1 rounded bg-surface-2 p-2">{pending.map(check=><label key={check.key} className="flex items-center justify-between gap-2"><span>{{identity:'身份',motion:'动作',product_brand_text:'产品/品牌/文字',background:'背景',audio_sync:'音画',reuse_risk:'复用风险',media:'媒体'}[check.key]}</span><select aria-label={`镜头 ${index+1} ${check.key}验收结果`} value={decisions[check.key]===undefined?'':decisions[check.key]?'passed':'failed'} onChange={event=>setCueReviewDecisions(current=>({...current,[cue.cueId]:{...(current[cue.cueId]||{}),[check.key]:event.target.value==='passed'}}))} className="rounded border px-2 py-1"><option value="">请选择</option><option value="passed">通过</option><option value="failed">不通过</option></select></label>)}
              <input aria-label={`镜头 ${index+1}验收证据`} value={evidence} onChange={event=>setCueReviewEvidence(current=>({...current,[cue.cueId]:event.target.value}))} placeholder="填写观察结果或证据" className="w-full rounded border px-2 py-1" />
              <button type="button" disabled={!complete||!evidence.trim()||props.busy} onClick={()=>props.onReviewSentenceCue?.(cue.cueId,decisions,evidence)} className="rounded border bg-white px-2 py-1 text-accent disabled:opacity-40">保存该镜头验收</button>
            </div>}
          </article>;})}
          {Boolean(props.sentenceResult.failedCueIds?.length)&&<div className="rounded-lg border border-red-200 bg-red-50 p-2 text-[10px] text-red-800"><p>失败镜头：{props.sentenceResult.failedCueIds?.join('、')}。返工将复用其他已通过镜头，只重新提交失败镜头并产生对应费用。</p><button type="button" disabled={props.busy||!chargeConfirmed} onClick={props.onRetryFailedSentenceCues} className="mt-2 rounded bg-red-700 px-3 py-1.5 font-bold text-white disabled:opacity-40">只重做失败镜头</button></div>}
        </section>:null}
      {props.executions?.filter(execution=>execution.quality.state==='manual_review').map(execution=><div key={execution.id} className="mt-3 space-y-2 text-xs">{execution.quality.checks.filter(check=>check.mode==='manual' && check.status==='pending').map(check=><label key={check.key} className="flex justify-between gap-2">{check.label}<select aria-label={`${check.label}验收结果`} value={reviewDecisions[execution.id]?.[check.key]===undefined?'':reviewDecisions[execution.id][check.key]?'passed':'failed'} onChange={event=>setReviewDecisions(current=>({...current,[execution.id]:{...current[execution.id],[check.key]:event.target.value==='passed'}}))}><option value="">请选择</option><option value="passed">通过</option><option value="failed">不通过</option></select></label>)}<input aria-label="验收说明" placeholder="验收说明或修改意见" value={reviewFeedback[execution.id] || ''} onChange={event=>setReviewFeedback(current=>({...current,[execution.id]:event.target.value}))} className="w-full rounded border p-2" /><button type="button" disabled={!execution.quality.checks.filter(check=>check.mode==='manual'&&check.status==='pending').every(check=>reviewDecisions[execution.id]?.[check.key]!==undefined) || !reviewFeedback[execution.id]?.trim()} onClick={()=>props.onReviewExecution?.(execution.id,reviewDecisions[execution.id],reviewFeedback[execution.id])}>保存验收</button></div>)}
      {props.error && <p role="alert" className="mt-3 text-xs text-red-600">{props.error}</p>}
    </section>
  </div>;
  return <div className="absolute inset-0 z-40 flex justify-end bg-black/25">
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="镜头编辑" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); props.onClose(); }
      if (event.key === 'Tab') { const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary') || [])].filter(item => item.offsetParent !== null && !item.closest('fieldset:disabled')); const first = controls[0]; const last = controls.at(-1); if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    }} className="h-full w-full max-w-[560px] overflow-y-auto bg-[#f8faf9] p-5 shadow-2xl">
      <div className="flex justify-between border-b pb-4"><div><p className="text-[10px] font-black uppercase tracking-wider text-accent">分镜制作</p><h2 className="mt-1 font-black">{props.title}</h2></div><button type="button" onClick={props.onClose}>关闭</button></div>
      {props.onApplyToSalesChange && <label className="my-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={props.applyToSales} onChange={event => props.onApplyToSalesChange?.(event.target.checked)} />方案应用到全部未锁定数字人销售分镜</label>}
      <form className="my-3 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); const patch = parseShotCommand(command); if (!patch) { setCommandMessage('暂未识别。可说：改成分屏、使用数字人、安排拍摄、使用原声、台词改为…、锁定镜头。'); return; } if (shot.locked && patch.locked !== false) { setCommandMessage('请先解锁镜头'); return; } props.onChange(patch); setCommandMessage(patch.narration ? '台词已填入，请应用到脚本；不会自动生成付费视频。' : '已更新当前镜头设置，未发起付费生成。'); setCommand(''); }}>
        <input aria-label="用一句话编辑当前镜头" value={command} onChange={event => setCommand(event.target.value)} placeholder="例如：改成画中画" className="min-w-0 flex-1 rounded-lg border p-2 text-xs" />
        <button disabled={props.busy || !command.trim()} type="submit" className="rounded-lg border px-3 text-xs disabled:opacity-40">应用指令</button>
        {commandMessage && <p role="status" className="w-full text-xs text-text-muted">{commandMessage}</p>}
      </form>
      <div className="relative mb-3 h-48 overflow-hidden rounded-xl bg-slate-900">
        {shot.layout === 'full' ? <>{renderMedia(background, 'absolute inset-0 h-full w-full object-cover')}{renderMedia(props.preview, 'relative h-full w-full object-contain')}</> : shot.layout === 'split' ? <div className="flex h-full">{renderMedia(props.preview, 'h-full w-1/2 object-cover')}{renderMedia(selectedProduct, 'h-full w-1/2 object-contain')}</div> : <>{renderMedia(selectedProduct, 'h-full w-full object-contain')}{renderMedia(props.preview, 'absolute bottom-2 right-2 h-2/5 w-2/5 object-contain')}</>}
      </div>
      <p className="mb-3 text-[10px] text-text-muted">构图示意：按全屏、分屏或画中画显示当前画面；下方依据口播时间轴逐句抽取开头、中间、结尾关键帧。</p>
      <section className="mb-3 rounded-xl border bg-white p-3" aria-label="逐句关键帧检查">
        <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-black">逐句关键帧检查</h3><span className="text-[9px] text-text-muted">开头 · 中间 · 结尾</span></div>
        {!props.preview?.url && <p className="mt-2 rounded-lg bg-surface-2 p-3 text-[10px] text-text-muted">当前分镜还没有素材或候选视频，生成或选择画面后自动显示逐句关键帧。</p>}
        {props.preview?.url && props.preview.type === 'image' && <div className="mt-2 grid grid-cols-3 gap-2">{(['开头', '中间', '结尾'] as const).map(position => <figure key={position} className="overflow-hidden rounded-lg border bg-surface-2"><img src={props.preview?.url} alt={`${position}静态画面`} className="aspect-video w-full object-cover" /><figcaption className="px-2 py-1 text-[9px] text-text-muted">{position} · 静态图</figcaption></figure>)}</div>}
        {props.preview?.url && props.preview.type !== 'image' && (props.keyframeCues || []).map((cue, cueIndex) => <article key={`${cue.start}:${cue.end}:${cueIndex}`} className="mt-2 rounded-lg bg-slate-900 p-2">
          <p className="mb-2 text-[10px] leading-4 text-white"><span className="font-bold text-emerald-300">句 {cueIndex + 1} · {cue.start.toFixed(1)}–{cue.end.toFixed(1)}s</span>　{cue.text}</p>
          <div className="grid grid-cols-3 gap-2">{cue.frames.map(frame => <VideoKeyframe key={`${frame.position}:${frame.time}`} asset={props.preview!} shotDuration={props.shotDuration || Math.max(0.001, cue.end)} time={frame.time} label={`句 ${cueIndex + 1} ${frame.position}`} />)}</div>
        </article>)}
      </section>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={shot.locked} onChange={e => props.onChange({ locked: e.target.checked })} />锁定镜头（禁止替换和自动推荐）</label>
      <fieldset disabled={shot.locked || props.busy} className="mt-4 space-y-4 disabled:opacity-60">
        <section className="rounded-xl border bg-white p-3" aria-label="镜头类型与制作方式">
          <h3 className="text-sm font-black">1. 这个镜头要呈现什么</h3>
          <label className="mt-2 block text-xs">画面类型<select aria-label="画面类型" value={contentType} onChange={e => {
            const next = e.target.value as NonNullable<ShotProduction['contentType']>;
            const source = next === 'enterprise_presenter' ? 'avatar' : next === 'ugc' ? 'ai' : 'material';
            props.onChange({ contentType: next, source, ...(next !== 'enterprise_presenter' ? { presenterId: '', transparent: false } : {}) });
          }} className="mt-1 w-full rounded-lg border p-2">
            <option value="enterprise_presenter">人物表达 · 企业人物口播</option>
            <option value="ugc">人物表达 · 素人 UGC／行业角色</option>
            <option value="product">产品特写</option>
            <option value="factory_scene">工厂／场景</option>
            <option value="broll">产品 B-roll／手部操作</option>
            <option value="information">图文／字幕／转场</option>
          </select></label>
          <label className="mt-2 block text-xs">制作方式<select aria-label="制作方式" value={shot.source} onChange={e => props.onChange({ source: e.target.value as ShotProduction['source'] })} className="mt-1 w-full rounded-lg border p-2">
            {isEnterprisePresenter && <><option value="avatar">企业人物生成</option><option value="material">使用已有企业人物视频</option><option value="shoot">安排真人拍摄</option></>}
            {isUgc && <><option value="ai">AI 行业角色</option><option value="material">已授权达人／泛素材</option><option value="shoot">安排重新实拍</option></>}
            {!isPeopleShot && <><option value="material">企业素材／可用参考片段</option><option value="ai">AI 补镜</option><option value="shoot">安排真人拍摄</option></>}
          </select></label>
          {isUgc && <div className="mt-3 space-y-2 rounded-lg bg-surface-2 p-2" aria-label="行业角色要求">
            <p className="text-xs font-bold">AI 行业角色</p>
            <p className="text-[10px] text-text-muted">参考视频只用于提取镜头节奏、动作和叙事结构；不会复刻其中素人的脸、声音或身份。</p>
            <label className="block text-xs">角色设定<input aria-label="行业角色设定" value={shot.ugcRole || ''} onChange={e => props.onChange({ ugcRole: e.target.value })} placeholder="例如：工厂采购人员" className="mt-1 w-full rounded border p-2" /></label>
            <label className="block text-xs">场景与动作<input aria-label="行业角色场景与动作" value={shot.ugcScenario || ''} onChange={e => props.onChange({ ugcScenario: e.target.value })} placeholder="例如：工厂走道手持自拍展示设备" className="mt-1 w-full rounded border p-2" /></label>
            <label className="block text-xs">镜头表达<input aria-label="行业角色镜头表达" value={shot.ugcExpression || ''} onChange={e => props.onChange({ ugcExpression: e.target.value })} placeholder="例如：近景手持、自然轻晃" className="mt-1 w-full rounded border p-2" /></label>
          </div>}
          {!isPeopleShot && <p className="mt-2 text-[10px] text-text-muted">本镜头不需要人物出镜。优先使用企业素材、可用参考片段或 AI 补镜，不展示企业人物或数字人设置。</p>}
        </section>
        <ShotRoutingRecommendation decision={routingDecision} onSelect={source => props.onChange({ source })} />
        {isEnterprisePresenter && shot.source === 'avatar' && <DigitalHumanRequirementsEditor value={shot.digitalHuman || { ...newDigitalHumanRequirements(), contentConfirmed: true }} plan={plan} toolCapabilities={props.toolCapabilities} referenceMaterials={props.materials.filter(item => item.type === 'video').map(item => ({ id: item.id, name: item.name, url: item.url }))} onChange={digitalHuman => props.onChange({ digitalHuman })} />}
        {isEnterprisePresenter && shot.source === 'avatar' && shot.digitalHuman?.workflow === 'viral_replication' && shot.digitalHuman.method === 'reenact' && (shot.digitalHuman.replicationMode || 'sentence_first_frame') === 'sentence_first_frame' && <button type="button" disabled={props.busy || !shot.digitalHuman.reference?.materialId} onClick={props.onPrepareSentenceFrames} className="rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-xs font-bold text-violet-800 disabled:opacity-40">{props.busy ? '正在提取…' : '提取逐句首帧'}</button>}
        {isEnterprisePresenter && shot.source === 'avatar' && shot.digitalHuman?.workflow === 'viral_replication' && shot.digitalHuman.method === 'reenact' && (shot.digitalHuman.replicationMode || 'sentence_first_frame') === 'sentence_first_frame' && referenceCues(shot.digitalHuman).some(cue=>cue.personShot===true)&&referenceCues(shot.digitalHuman).every(cue=>cue.personShot===false||Boolean(cue.sourceFirstFrame?.materialId))&&<button type="button" disabled={props.busy||!chargeConfirmed} onClick={props.onGenerateSentenceDrafts} className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-2 text-xs font-bold text-sky-800 disabled:opacity-40">{props.busy?'千问草稿生成中…':'生成千问构图草稿（可选）'}</button>}
        {isEnterprisePresenter && shot.source === 'avatar' && shot.digitalHuman?.workflow === 'viral_replication' && shot.digitalHuman.method === 'reenact' && (shot.digitalHuman.replicationMode || 'sentence_first_frame') === 'sentence_first_frame' && referenceCues(shot.digitalHuman).some(cue => cue.personShot === true) && referenceCues(shot.digitalHuman).every(cue => cue.personShot === false ? Boolean(cue.nonPersonMaterialId) : Boolean(cue.sourceFirstFrame?.materialId)) && <button type="button" disabled={props.busy || !chargeConfirmed} onClick={props.onRunSentenceReplication} className="rounded-lg bg-violet-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">{props.busy ? '逐句生成与拼接中…' : '生成人物镜头并混合非人物素材'}</button>}
        {props.sentenceResult?.cueQuality?.length ? <section className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-3" aria-label="逐镜质量验收">
          <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-black">逐镜质量验收</h3><span className="text-[10px] text-text-muted">独立检测异常会直接标记失败</span></div>
          {props.sentenceResult.cueQuality.map((cue,index)=>{const pending=cue.checks.filter(check=>check.status==='pending');const decisions=cueReviewDecisions[cue.cueId]||{};const evidence=cueReviewEvidence[cue.cueId]||'';const complete=pending.length>0&&pending.every(check=>decisions[check.key]!==undefined);return <article key={cue.cueId} className="rounded-lg border bg-white p-2 text-[10px]">
            <p className="font-bold">镜头 {index+1} · {{accepted:'已通过',failed:'未通过',manual_review:'待人工验收'}[cue.state]}</p>
            <ul className="mt-1 space-y-1">{cue.checks.map(check=><li key={check.key} className={check.status==='failed'?'text-red-700':check.status==='passed'?'text-emerald-700':'text-amber-700'}><b>{{media:'媒体',identity:'身份',motion:'动作',product_brand_text:'产品/品牌/文字',background:'背景',audio_sync:'音画',reuse_risk:'复用风险'}[check.key]}：</b>{{passed:'通过',failed:'失败',pending:'待验收'}[check.status]} · {check.evidence}</li>)}</ul>
            {pending.length>0&&<div className="mt-2 space-y-1 rounded bg-surface-2 p-2">{pending.map(check=><label key={check.key} className="flex items-center justify-between gap-2"><span>{{identity:'身份',motion:'动作',product_brand_text:'产品/品牌/文字',background:'背景',audio_sync:'音画',reuse_risk:'复用风险',media:'媒体'}[check.key]}</span><select aria-label={`镜头 ${index+1} ${check.key}验收结果`} value={decisions[check.key]===undefined?'':decisions[check.key]?'passed':'failed'} onChange={event=>setCueReviewDecisions(current=>({...current,[cue.cueId]:{...(current[cue.cueId]||{}),[check.key]:event.target.value==='passed'}}))} className="rounded border px-2 py-1"><option value="">请选择</option><option value="passed">通过</option><option value="failed">不通过</option></select></label>)}
              <input aria-label={`镜头 ${index+1}验收证据`} value={evidence} onChange={event=>setCueReviewEvidence(current=>({...current,[cue.cueId]:event.target.value}))} placeholder="填写观察结果或证据" className="w-full rounded border px-2 py-1" />
              <button type="button" disabled={!complete||!evidence.trim()||props.busy} onClick={()=>props.onReviewSentenceCue?.(cue.cueId,decisions,evidence)} className="rounded border bg-white px-2 py-1 text-accent disabled:opacity-40">保存该镜头验收</button>
            </div>}
          </article>;})}
          {Boolean(props.sentenceResult.failedCueIds?.length)&&<div className="rounded-lg border border-red-200 bg-red-50 p-2 text-[10px] text-red-800"><p>失败镜头：{props.sentenceResult.failedCueIds?.join('、')}。返工将复用其他已通过镜头，只重新提交失败镜头并产生对应费用。</p><button type="button" disabled={props.busy||!chargeConfirmed} onClick={props.onRetryFailedSentenceCues} className="mt-2 rounded bg-red-700 px-3 py-1.5 font-bold text-white disabled:opacity-40">只重做失败镜头</button></div>}
        </section>:null}
        {isEnterprisePresenter && <h3 className="text-sm font-black">2. 选择企业人物</h3>}
        <label className="block text-xs">声音方式<select value={shot.sound} onChange={e => props.onChange({ sound: e.target.value as ShotProduction['sound'] })} className="mt-1 w-full rounded-lg border p-2"><option value="voiceover">连续旁白</option><option value="source">使用镜头原声 / 人物说话</option><option value="silent">此镜无声</option></select></label>
        {isEnterprisePresenter && shot.source === 'avatar' && <>
          <div className="grid grid-cols-3 gap-2">{defaults.presenters.map(item => <button key={item.id} type="button" onClick={() => props.onChange({ presenterId: item.id, digitalHuman: { ...(shot.digitalHuman || newDigitalHumanRequirements()), presenterSelected: true, contentConfirmed: false } })} className={`rounded-xl border p-3 text-xs font-bold ${shot.presenterId === item.id ? 'border-accent bg-accent/10 text-accent' : 'bg-white'}`}><span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-base">{item.name.slice(0, 1)}</span>{item.name}</button>)}</div>
          {!defaults.presenters.length && <p className="rounded-lg border border-dashed bg-white p-3 text-xs text-text-muted">暂无可用企业人物。可在当前分镜直接补齐人物资料，保存后会自动回填本镜头；企业知识库仅用于后续集中管理。</p>}
          <button type="button" onClick={()=>{setShowPresenterSetup(value=>!value);setPresenterSetupError('');}} className="rounded-lg border border-accent px-3 py-2 text-xs font-bold text-accent">{showPresenterSetup?'收起人物补充':'＋ 在当前分镜添加人物'}</button>
          {showPresenterSetup&&<section aria-label="当前分镜人物补充" className="space-y-2 rounded-xl border border-accent/30 bg-accent/5 p-3">
            <div><p className="text-xs font-black">补齐当前分镜的人物资产</p><p className="text-[10px] text-text-muted">上传和授权一次后进入企业人物库，并自动选回当前分镜，无需离开内容制作。</p></div>
            <input aria-label="当前分镜人物名称" value={presenterSetup.name} onChange={event=>setPresenterSetup(current=>({...current,name:event.target.value}))} placeholder="人物名称" className="w-full rounded border bg-white p-2 text-xs" />
            <label className="block rounded border border-dashed bg-white p-3 text-xs">人物正脸图片<input aria-label="当前分镜人物图片" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={event=>setPresenterSetup(current=>({...current,file:event.target.files?.[0]||null}))} className="mt-1 block w-full text-[10px]" /></label>
            <label className="flex gap-2 text-xs"><input type="checkbox" checked={presenterSetup.subjectAdultConfirmed} onChange={event=>setPresenterSetup(current=>({...current,subjectAdultConfirmed:event.target.checked}))}/>已核验本人为成年人并同意数字人制作及人物替换用途</label>
            <div className="rounded-lg border bg-white p-2"><p className="text-xs font-bold">方舟认证</p><p className="text-[10px] text-text-muted">先保存人物也可以；需要 Seedance 人物镜头时，在方舟完成一次认证，返回本抽屉回填图片 Asset ID。</p><a href="https://console.volcengine.com/ark/region:ark+cn-beijing/asset" target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-bold text-accent underline">前往方舟认证（新窗口）</a><input aria-label="当前分镜方舟图片Asset ID" value={presenterSetup.arkAssetUri} onChange={event=>setPresenterSetup(current=>({...current,arkAssetUri:event.target.value,arkActiveConfirmed:false}))} placeholder="返回后填写 asset://asset-..." className="mt-2 w-full rounded border p-2 text-xs"/><label className="mt-2 flex gap-2 text-xs"><input type="checkbox" checked={presenterSetup.arkActiveConfirmed} onChange={event=>setPresenterSetup(current=>({...current,arkActiveConfirmed:event.target.checked}))}/>方舟控制台已显示该图片资产为 Active</label></div>
            {presenterSetupError&&<p role="alert" className="text-xs text-red-700">{presenterSetupError}</p>}
            <button type="button" disabled={presenterSetupBusy||!presenterSetup.name.trim()||!presenterSetup.file||!presenterSetup.subjectAdultConfirmed||!presenterSetupArkValid} onClick={()=>void saveInlinePresenter()} className="rounded bg-accent px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{presenterSetupBusy?'正在上传并回填…':'保存人物并用于当前分镜'}</button>
          </section>}
          {selectedPresenter && <p className="text-[10px] text-text-muted">人物资产 V{selectedPresenter.assetVersion || 1} · {presenterCapabilities(selectedPresenter).map(item => ({ talking: '支持口播', reference_image: '有参考图', reference_video: '有参考视频', person_replacement: '支持人物替换' }[item])).join(' / ') || '资料待补充'}</p>}
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={shot.transparent} onChange={e => props.onChange({ transparent: e.target.checked })} />生成透明人物层（须人物支持；用于抠像画中画或独立背景）</label>
        </>}
        {isPeopleShot && <><h3 className="text-sm font-black">{isEnterprisePresenter ? '3. 确认台词' : '2. 口播与表达'}</h3>
        <label className="block text-xs"><textarea aria-label="台词" rows={3} value={shot.narration} onChange={e => props.onChange({ narration: e.target.value })} className="w-full rounded-xl border bg-white p-3" /><button type="button" onClick={props.onNarration} className="mt-1 font-bold text-accent">同步到分镜脚本</button></label>
        <p className="text-[10px] text-text-muted">打开分镜时自动读取当前脚本中与本镜头对应的真实口播；此处修改后点击“同步到分镜脚本”可回写脚本。</p></>}
        <h3 className="text-sm font-black">{isPeopleShot ? (isEnterprisePresenter ? '4. 选择画面形式' : '3. 选择画面形式') : '2. 选择画面与素材'}</h3>
        <label className="block text-xs">布局<select value={shot.layout} onChange={e => props.onChange({ layout: e.target.value as ShotProduction['layout'] })} className="mt-1 w-full rounded-lg border p-2"><option value="full">全屏画面 / 人物</option><option value="split">人物与产品分屏</option><option value="pip">产品主画面 + 人物小窗</option></select></label>
        <label className="block text-xs">关联产品<select value={shot.productId} onChange={e => props.onChange({ productId: e.target.value })} className="mt-1 w-full rounded-lg border p-2"><option value="">沿用草稿产品</option>{props.products.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        {mediaSelect('产品画面（独立图层）', 'productMaterialId')}
        {shot.productId && <label className="flex gap-2 text-xs"><input type="checkbox" checked={shot.factsConfirmed} onChange={e => props.onChange({ factsConfirmed: e.target.checked })} />已核对该SKU与台词、参数及证据一致</label>}
        {mediaSelect('背景素材', 'backgroundMaterialId')}
        <label className="block text-xs">背景性质<select value={shot.backgroundMode} onChange={e => props.onChange({ backgroundMode: e.target.value as ShotProduction['backgroundMode'] })} className="mt-1 w-full rounded-lg border p-2"><option value="independent">独立背景：只重新合成</option><option value="baked">已在视频中：换背景需重生成</option></select></label>
        {shot.backgroundMode === 'baked' && <p className="text-xs text-amber-700">不能直接擦除原片背景。改背景将使旧候选过期；首版请使用透明人物层或替换整条素材。</p>}
        {shot.source === 'material' && <button type="button" onClick={props.onMaterial} className="rounded-lg border px-4 py-2 text-xs">打开素材库选画面</button>}
        {shot.source === 'shoot' && <button type="button" onClick={props.onShoot} className="rounded-lg border px-4 py-2 text-xs">创建待拍任务</button>}
        {shot.source === 'ai' && <button type="button" onClick={props.onAi} className="rounded-lg border px-4 py-2 text-xs">生成这一镜（使用现有Seedance计费）</button>}
        {isEnterprisePresenter && shot.source === 'avatar' && <div className="space-y-2 rounded-xl bg-surface-2 p-3">
          {props.sourcePlan && <div className="rounded-lg border border-violet-200 bg-violet-50 p-2 text-xs">
            <p className="font-bold">Content Agent 分镜建议</p>
            <p className="mt-1">来自任务版本 {props.sourcePlan.sourceTaskVersion}；候选技术：{props.sourcePlan.candidateTools.join('、') || '待能力检查'}。</p>
            <p className="mt-1 text-text-muted">该建议尚未执行。请核对企业人物、口播、参考内容和保留要求，再保存制作方案。</p>
          </div>}
          <p className="text-xs">{props.savedPlan
            ? props.savedPlan.executable ? '当前数字人制作方案可执行；仅生成此镜头，已有候选保留。' : props.savedPlan.reasons.join('；') || '当前保存方案不可执行，请重新检查镜头要求。'
            : plan.executable ? '当前数字人制作方案可执行；仅生成此镜头，已有候选保留。' : '当前方案暂不可执行，请按上方提示补齐并确认镜头要求。'}</p>
          <details className="text-xs"><summary>技术详情</summary>
            <ul className="mt-2 space-y-1">{(props.toolCapabilities?.length ? props.toolCapabilities : [{ id: 'heygen', label: 'HeyGen 人物口播', execution: props.configured, reason: props.configured ? '接口已启用' : '未配置或未启用' }]).map(tool => <li key={tool.id}>
              <span className={tool.execution ? 'text-emerald-700' : 'text-text-muted'}>{tool.execution ? '可执行' : '仅规划'} · {tool.label}</span><span className="block pl-3 text-[10px] text-text-muted">{tool.reason}</span>
              {tool.executionProfile && <span className="block pl-3 text-[10px] text-text-muted">最长 {tool.executionProfile.maxDurationSeconds ?? '未声明'} 秒 · 保留 {tool.executionProfile.preserves.join('、') || '未声明'} · {tool.executionProfile.qualityInspection ? '含自动视觉代理检查' : '需人工视觉验收'}{tool.executionProfile.estimatedCostCnyPerSecond != null ? ` · 约 ¥${tool.executionProfile.estimatedCostCnyPerSecond.toFixed(2)}/秒` : ''}<span className="block">人物身份与产品仍按逐项质检结论准入</span></span>}
            </li>)}</ul>
          </details>
          <button type="button" disabled={props.busy} onClick={props.onSavePlan} className="rounded-lg border bg-white px-4 py-2 text-xs disabled:opacity-40">{props.busy ? '保存中…' : '保存制作方案'}</button>
          {props.savedPlan && <p className="text-[10px] text-text-muted">方案已保存{props.savedPlan.origin === 'content_agent' ? ` · Content Agent ${props.savedPlan.sourceTaskVersion || '来源版本待确认'}` : ''} · 人物资产 V{props.savedPlan.presenterAssetVersion} · {{ needs_input: '待补资料', needs_confirmation: '待确认内容', preview_only: '仅方案预览', ready: '可制作' }[props.savedPlan.state]}{props.savedPlan.estimatedCostCny != null ? ` · 预计 ¥${props.savedPlan.estimatedCostCny.toFixed(2)}` : ''}</p>}
          {props.savedPlan?.routeSteps?.length ? <ol aria-label="制作路线" className="space-y-1 rounded-lg border bg-white p-2 text-[10px]">{props.savedPlan.routeSteps.map((step, index) => <li key={step.id}><b>{index + 1}. {step.label}</b><span className="ml-1 text-text-muted">· {{ completed: '已完成', ready: '可执行', blocked: '等待上一步', running: '进行中', attention: '待核对', failed: '失败' }[step.status]}{step.tool ? ` · ${step.tool}` : ''}</span></li>)}</ol> : null}
          {props.savedPlan?.routeDecision && <details className="rounded-lg border bg-white p-2 text-[10px]"><summary className="font-bold">选路依据</summary>
            <p className="mt-1 text-text-muted">目标 {props.savedPlan.routeDecision.targetDurationSeconds ?? '待确认'} 秒 · 预算上限 {props.savedPlan.routeDecision.budgetLimitCny == null ? '未配置' : `¥${props.savedPlan.routeDecision.budgetLimitCny.toFixed(2)}`} · 必须保留：{props.savedPlan.routeDecision.requiredPreservation.join('、') || '人物身份'}</p>
            <ul className="mt-1 space-y-1">{props.savedPlan.routeDecision.evaluations.map(item => <li key={item.tool}><b>{item.compatible ? '符合' : '淘汰'} · {item.tool}</b><span className="block text-text-muted">{item.reasons.join('；') || `${item.qualityInspection ? '含自动视觉代理检查' : '需人工视觉验收'}${item.estimatedCostCny == null ? ' · 费用待确认' : ` · 预计 ¥${item.estimatedCostCny.toFixed(2)}`}`}</span></li>)}</ul>
          </details>}
          {props.executions?.map(execution => <div key={execution.id} className="rounded-lg border bg-white p-2 text-[10px] text-text-muted">
            <p>执行记录 · {execution.tool} · {{ submitting: '正在提交', pending: '处理中', completed: '已生成', failed: '失败', uncertain: '提交结果待核对', cancelled: '已取消' }[execution.state]}</p>
            {execution.submissionOutcome === 'rejected' && <p>供应商未创建任务 · 本次不计入生成上限</p>}
            {execution.inputSnapshot && <p>输入快照 · {execution.inputSnapshot.language || '语言待确认'} · {execution.inputSnapshot.targetDurationSeconds == null ? '目标时长待确认' : `目标 ${execution.inputSnapshot.targetDurationSeconds.toFixed(2)} 秒`} · 人物 V{execution.inputSnapshot.presenterAssetVersion}</p>}
            {execution.inputSnapshot?.presenterInput && <p>实际人物输入 · {execution.inputSnapshot.presenterInput.type === 'video' ? '视频' : execution.inputSnapshot.presenterInput.type === 'image' ? '图片' : '历史类型待确认'} · 素材 {execution.inputSnapshot.presenterInput.materialId} · 对象 {execution.inputSnapshot.presenterInput.objectKey}{execution.inputSnapshot.presenterInput.objectEtag ? ` · 版本 ${execution.inputSnapshot.presenterInput.objectEtag}` : ''}</p>}
            {execution.inputSnapshot?.referenceInput && <p>精确原片输入 · 素材 {execution.inputSnapshot.referenceInput.materialId} · {execution.inputSnapshot.referenceInput.start.toFixed(2)}–{(execution.inputSnapshot.referenceInput.start + execution.inputSnapshot.referenceInput.duration).toFixed(2)} 秒 · 对象 {execution.inputSnapshot.referenceInput.clipObjectKey}{execution.inputSnapshot.referenceInput.sourceObjectEtag ? ` · 原片版本 ${execution.inputSnapshot.referenceInput.sourceObjectEtag}` : ''}{execution.inputSnapshot.referenceInput.clipObjectEtag ? ` · 片段版本 ${execution.inputSnapshot.referenceInput.clipObjectEtag}` : ''}</p>}
            {execution.inputSnapshot?.derivativeAuthorization
              ? <p>原片派生与商业授权 · {execution.inputSnapshot.derivativeAuthorization.evidence} · 服务端确认 {execution.inputSnapshot.derivativeAuthorization.confirmedAt}</p>
              : execution.inputSnapshot?.modelInputAuthorization && <p>原片模型输入授权 · {execution.inputSnapshot.modelInputAuthorization.evidence} · 服务端确认 {execution.inputSnapshot.modelInputAuthorization.confirmedAt}</p>}
            {execution.inputSnapshot?.audioSegment && <p>驱动音频 · 片段 {execution.inputSnapshot.audioSegment.segmentId.slice(0, 10)} · {execution.inputSnapshot.audioSegment.start.toFixed(2)}–{(execution.inputSnapshot.audioSegment.start + execution.inputSnapshot.audioSegment.duration).toFixed(2)} 秒 · SHA-256 {execution.inputSnapshot.audioSegment.checksumSha256.slice(0, 12)}</p>}
            {execution.candidateOutput && <p>候选输出证据 · {execution.candidateOutput.objectKey ? `对象 ${execution.candidateOutput.objectKey}` : `租户文件 ${execution.candidateOutput.localFile}`} · SHA-256 {execution.candidateOutput.contentSha256.slice(0, 16)}{execution.candidateOutput.objectEtag ? ` · 版本 ${execution.candidateOutput.objectEtag}` : ''}</p>}
            {execution.inputSnapshot?.revisionFeedback && <p className="mt-1 rounded bg-violet-50 p-1.5 text-violet-800">本次重做依据：{execution.inputSnapshot.revisionFeedback}</p>}
            <p>预计费用：{execution.estimatedCostCny == null ? '待供应商确认' : `¥${execution.estimatedCostCny.toFixed(2)}`} · 实际费用：{execution.costStatus === 'reconciled' && execution.actualCostCny != null ? `¥${execution.actualCostCny.toFixed(2)}` : execution.costStatus === 'awaiting_invoice' ? '待账单对账' : '尚未产生可核对账单'}</p>
            {execution.costStatus === 'awaiting_invoice' && props.toolCapabilities?.find(tool => tool.id === execution.tool)?.costReconciliation && <button type="button" disabled={props.refreshingJobIds?.includes(execution.id)} onClick={() => props.onReconcileExecutionCost?.(execution.id)} className="mt-1 text-accent disabled:opacity-40">{props.refreshingJobIds?.includes(execution.id) ? '正在核对账单…' : '核对供应商账单'}</button>}
            {execution.error && <p className="mt-1 text-red-600">{execution.error}</p>}
            {execution.routeSteps?.length ? <ol aria-label="执行依赖" className="mt-1 space-y-0.5">{execution.routeSteps.map(step => <li key={step.id}>{{ completed: '已完成', ready: '可执行', blocked: '等待', running: '进行中', attention: '待核对', failed: '失败' }[step.status]} · {step.label}</li>)}</ol> : null}
            {execution.adoption && <p className="mt-1 rounded bg-emerald-50 p-1.5 text-emerald-800">已填入分镜 · 候选 {execution.adoption.candidateId} · 装配版本 {execution.adoption.assemblyVersion}</p>}
            {execution.tool !== 'heygen' && execution.state === 'pending' && <div className="mt-1 flex gap-3"><button type="button" disabled={props.refreshingJobIds?.includes(execution.id)} onClick={() => props.onRefreshExecution?.(execution.id)} className="text-accent disabled:opacity-40">{props.refreshingJobIds?.includes(execution.id) ? '正在核验…' : '刷新原任务'}</button>{props.toolCapabilities?.find(tool => tool.id === execution.tool)?.cancellation && <button type="button" disabled={props.refreshingJobIds?.includes(execution.id)} onClick={() => props.onCancelExecution?.(execution.id)} className="text-red-600 disabled:opacity-40">取消原任务</button>}</div>}
            <ul className="mt-1 space-y-0.5">{execution.quality.checks.map(check => <li key={check.key}>{{ pending: '待检查', passed: '已通过', failed: '未通过' }[check.status]} · {check.label}{check.mode === 'automatic' ? '（系统）' : '（人工）'}</li>)}</ul>
            {execution.quality.reviewNote && <p className="mt-1 rounded bg-amber-50 p-1.5 text-amber-800">修改意见：{execution.quality.reviewNote}</p>}
            {execution.quality.state === 'manual_review' && (() => {
              const pending = execution.quality.checks.filter(check => check.mode === 'manual' && check.status === 'pending');
              const decisions = reviewDecisions[execution.id] || {};
              const complete = pending.length > 0 && pending.every(check => decisions[check.key] !== undefined);
              const hasFailure = pending.some(check => decisions[check.key] === false);
              return <div className="mt-2 space-y-2 rounded border p-2" aria-label="逐项人工验收">
                {pending.map(check => <label key={check.key} className="flex items-center justify-between gap-2"><span>{check.label}</span><select aria-label={`${check.label}验收结果`} value={decisions[check.key] === undefined ? '' : decisions[check.key] ? 'passed' : 'failed'} onChange={event => setReviewDecisions(current => ({ ...current, [execution.id]: { ...(current[execution.id] || {}), [check.key]: event.target.value === 'passed' } }))} className="rounded border px-2 py-1"><option value="">请选择</option><option value="passed">通过</option><option value="failed">不通过</option></select></label>)}
                <input aria-label="候选修改意见" value={reviewFeedback[execution.id] || ''} onChange={event => setReviewFeedback(current => ({ ...current, [execution.id]: event.target.value }))} placeholder={hasFailure ? '请填写具体修改意见' : '可填写验收说明'} className="w-full rounded border px-2 py-1" />
                <button type="button" disabled={!complete || (hasFailure && !reviewFeedback[execution.id]?.trim())} onClick={() => props.onReviewExecution?.(execution.id, decisions, reviewFeedback[execution.id])} className="rounded border px-2 py-1 text-accent disabled:opacity-40">保存逐项人工验收</button>
              </div>;
            })()}
          </div>)}
          {!props.configured && props.capabilityReason && <p className="text-xs" role="status">{props.capabilityReason}</p>}
          <p className="text-xs">提交结果未知时只核对原任务，不自动再次生成。预算预占是调用准入控制，不等于供应商最终账单。</p>
          <p className="text-xs">当前要求与人物版本已使用 {attemptsUsed}/{maxAttempts} 次生成名额；已创建或提交结果待核对的供应商任务计入，明确未创建任务的拒绝不计入。</p>
          <p className="text-xs">{props.costPerSecond ? `配置估价约 ¥${(Math.max(1, shot.narration.length / 4) * props.costPerSecond).toFixed(2)}；按实际时长计费，重试可能产生额外成本。` : '未配置单价，费用以供应商账单为准。'}</p>
          <p className="text-[10px] text-text-muted">新数字人文件入库前检查实际画幅、分辨率、音轨和透明区域。技术通过不代表口型、人物边缘与观感已人工验收。</p>
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={chargeConfirmed} onChange={e => setChargeConfirmed(e.target.checked)} />确认本次镜头生成及供应商计费</label>
          <button type="button" disabled={attemptsUsed >= maxAttempts || !(props.savedPlan?.executable || plan.executable) || !chargeConfirmed || !shot.presenterId || !shot.narration.trim()} onClick={() => { setChargeConfirmed(false); props.onGenerate(); }} className="rounded-lg bg-accent px-4 py-2 text-xs text-white disabled:opacity-40">{attemptsUsed >= maxAttempts ? '已达本镜头生成上限' : props.busy ? '提交中…' : '生成新候选'}</button>
        </div>}
      </fieldset>
      {[props.error, ...shotBlockers(shot, props.context, props.shotId)].filter(Boolean).map((message, index) => <p role="alert" key={`${index}:${message}`} className="mt-2 text-xs text-red-600">{message}</p>)}
      {(props.jobs.length > 0 || shot.candidates.length > 0) && <div className="mt-4 space-y-2"><h3 className="text-sm font-bold">生成版本</h3>
        {props.jobs.map(job => <div key={job.id} className="rounded-lg border p-2 text-xs">{job.error?.startsWith('供应商已生成') ? '已生成 · 待入库核验' : ({ submitting: '正在提交', pending: '生成处理中', completed: '候选已就绪', failed: '生成失败', uncertain: '提交结果待核对' }[job.status])} {job.error}
          {job.status === 'pending' && job.error && <p className="mt-1 text-text-muted">已暂停自动重查。处理问题后可手动刷新原任务，不会重新付费生成。</p>}
          <button type="button" disabled={props.refreshingJobIds?.includes(job.id)} onClick={() => props.onRefresh(job.id)} className="ml-2 text-accent disabled:opacity-40">{props.refreshingJobIds?.includes(job.id) ? '正在核验…' : '刷新原任务'}</button></div>)}
        {shot.candidates.map((candidate, index) => { const presenterVersion = Math.max(1, defaults.presenters.find(item => item.id === shot.presenterId)?.assetVersion || 1); const execution = props.executions?.find(item => (item.id === candidate.jobId || item.jobId === candidate.jobId) && item.presenterAssetVersion === presenterVersion); const taskReady = execution ? execution.state === 'completed' && execution.materialId === candidate.materialId && execution.fingerprint === candidate.fingerprint : avatarCandidateReady(candidate, props.jobs); const qualityReady = candidate.source !== 'avatar' || execution?.quality.state === 'accepted'; return <div key={candidate.id} className="space-y-2 rounded-lg border p-2 text-xs">
          <div className="flex justify-between"><span>V{index + 1} · {{ avatar: '数字人镜头', material: '已有素材', ai: '创意画面', shoot: '实拍' }[candidate.source]} {candidate.fingerprint !== shotFingerprint(shot, props.context, props.shotId) ? '· 要求已变化' : ''} {!taskReady ? '· 任务未完成或待核验' : !qualityReady ? '· 待人工验收' : ''}</span><button type="button" disabled={shot.locked || candidate.fingerprint !== shotFingerprint(shot, props.context, props.shotId) || !taskReady || !qualityReady} onClick={() => props.onAdopt(candidate.id)} className="text-accent disabled:opacity-40">{shot.adoptedId === candidate.id ? '当前采用' : '采用 / 恢复'}</button></div>
          {(() => { const asset = props.materials.find(item => item.id === candidate.materialId); const reference = shot.digitalHuman?.reference; return asset?.url && reference?.videoUrl
            ? <ReferenceCandidateComparison sourceUrl={reference.videoUrl} sourceStart={reference.start} sourceEnd={reference.end} candidate={asset} cues={referenceCues(shot.digitalHuman)} />
            : asset?.url ? <video aria-label={`候选 V${index + 1} 预览`} src={asset.url} controls playsInline preload="metadata" className="max-h-64 w-full rounded-lg bg-black" /> : null; })()}
          <p className="text-text-muted">预览确认人物、口播、口型与画面要求后再采用；采用后填入当前分镜。</p>
        </div>; })}
      </div>}
      <details className="mt-5 rounded-xl border bg-white p-3"><summary className="cursor-pointer text-xs font-bold">全片数字人默认设置</summary>
        <select aria-label="企业默认出镜偏好" value={defaults.preference} onChange={async e => { try { await props.onDefaults({ ...defaults, preference: e.target.value as ProductionDefaults['preference'] }); } catch (error) { setDefaultsError(String(error)); } }} className="my-2 w-full rounded-lg border p-2 text-xs"><option value="auto">AI推荐</option><option value="avatar">优先数字人</option><option value="real">优先真人实拍</option><option value="none">不出镜</option></select>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">默认声音<select aria-label="新分镜默认声音" value={defaults.defaultSound} onChange={async e => { try { await props.onDefaults({ ...defaults, defaultSound: e.target.value as ProductionDefaults['defaultSound'] }); } catch (error) { setDefaultsError(String(error)); } }} className="mt-1 w-full rounded-lg border p-2"><option value="voiceover">连续旁白</option><option value="source">人物说话</option><option value="silent">无声</option></select></label>
          <label className="text-xs">默认布局<select aria-label="新分镜默认布局" value={defaults.defaultLayout} onChange={async e => { try { await props.onDefaults({ ...defaults, defaultLayout: e.target.value as ProductionDefaults['defaultLayout'] }); } catch (error) { setDefaultsError(String(error)); } }} className="mt-1 w-full rounded-lg border p-2"><option value="full">全屏人物</option><option value="split">人物与产品分屏</option><option value="pip">人物小窗</option></select></label>
        </div>
        <button type="button" onClick={props.onApplyDefaultsToUnlocked} className="rounded-lg border px-3 py-2 text-xs">应用到当前视频全部未锁定数字人分镜</button>
        {defaults.presenters.map(item => <div key={item.id} className="my-2 flex justify-between text-xs"><span>{item.name}</span><button type="button" onClick={async () => { try { await props.onDefaults({ ...defaults, defaultPresenterId: item.id }); } catch (error) { setDefaultsError(String(error)); } }}>{defaults.defaultPresenterId === item.id ? '默认人物' : '设为默认'}</button></div>)}
        <p className="my-2 text-xs text-text-muted">人物授权、供应商映射、参考图片／视频和资产版本统一在企业设置维护；分镜只引用已保存的人物资产。</p>
        {defaultsError && <p role="alert" className="mt-2 text-xs text-red-600">{defaultsError}</p>}
      </details>
    </section>
  </div>;
}
