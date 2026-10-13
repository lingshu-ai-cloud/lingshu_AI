import { useEffect, useRef, useState } from 'react';
import { presenterApi } from '../../lib/presenterApi';
import { productionApi } from '../../lib/productionApi';
import type { ArkPresenterPreparation, PresenterCapabilities, PresenterCreation, PresenterLook, PresenterVoice } from '../../lib/presenterAssets';
import type { ProductionDefaults } from '../../lib/shotProduction';

const statusText = (job: PresenterCreation) => job.status === 'pending_consent'
  ? job.consentRequestedAt ? '授权入口已生成 · 待 HeyGen 确认' : '待发起本人授权'
  : ({ submitting: '正在提交', processing: '处理中', completed: '可用', failed: '创建未受理', uncertain: '提交结果待核实' } as const)[job.status];
const field = 'w-full rounded-lg border border-border bg-white p-2 text-sm';
const button = 'rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40';
type PresenterLookGroup = { id: string; name: string; representative: PresenterLook; looks: PresenterLook[] };
export const groupPresenterLooks = (looks: PresenterLook[]): PresenterLookGroup[] => {
  const groups = new Map<string, PresenterLook[]>();
  for (const look of looks) {
    const id = look.groupId || `look:${look.id}`;
    groups.set(id, [...(groups.get(id) || []), look]);
  }
  return [...groups].map(([id, groupLooks]) => {
    const representative = groupLooks.find(look => look.imageUrl) || groupLooks[0];
    const commonName = groupLooks.length > 1
      ? groupLooks.map(look => look.name.trim().split(/\s+/)[0]).find(Boolean) || representative.name
      : representative.name;
    return { id, name: commonName, representative, looks: groupLooks };
  });
};
export type PresenterSaveContext = { creationId?: string; arkPreparation?: ArkPresenterPreparation };
export default function PresenterManager({ onClose, onSaved, onSynced, reusePresenterId, initialConfiguration = false }: { onClose: () => void; onSaved: (value: ProductionDefaults, context?: PresenterSaveContext) => void | Promise<void>; onSynced?: (value: ProductionDefaults) => void | Promise<void>; /** @deprecated 素材类型现在由上传文件自动识别。 */ initialMode?: 'quick' | 'expert'; /** @deprecated 创建流程已统一。 */ fixedMode?: boolean; reusePresenterId?: string; initialConfiguration?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'create' | 'import'>(initialConfiguration ? 'import' : 'create');
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [cap, setCap] = useState<PresenterCapabilities>();
  const [jobs, setJobs] = useState<PresenterCreation[]>([]);
  const [looks, setLooks] = useState<PresenterLook[]>([]); const [lookToken, setLookToken] = useState('');
  const [voices, setVoices] = useState<PresenterVoice[]>([]); const [voiceToken, setVoiceToken] = useState('');
  const [voiceScope, setVoiceScope] = useState<'public' | 'private'>('public');
  const [voiceEntry, setVoiceEntry] = useState<'existing' | 'own'>('existing');
  const [voiceName, setVoiceName] = useState('');
  const [voiceLanguage, setVoiceLanguage] = useState('zh-CN');
  const [voiceFile, setVoiceFile] = useState<File>();
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'paused' | 'ready'>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingUrl, setRecordingUrl] = useState('');
  const mediaRecorder = useRef<MediaRecorder | undefined>(undefined);
  const recordingStream = useRef<MediaStream | undefined>(undefined);
  const recordingChunks = useRef<Blob[]>([]);
  const recordingTimer = useRef<number | undefined>(undefined);
  const recordingUrlRef = useRef('');
  const submitRecordingOnStop = useRef(false);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [voiceCloneJob, setVoiceCloneJob] = useState<{ id: string; status: string; voiceId: string }>();
  const voiceAttempt = useRef<{ signature: string; requestId: string } | undefined>(undefined);
  const voicePollInFlight = useRef(false);
  const resumeSaveAfterVoice = useRef(false);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File>();
  const [photoFile, setPhotoFile] = useState<File>();
  const [videoFile, setVideoFile] = useState<File>();
  const heyGenSource = initialConfiguration ? videoFile || photoFile : file;
  const heyGenVideoSource = Boolean(heyGenSource && (heyGenSource.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(heyGenSource.name)));
  const selectedCreationEnabled = (heyGenVideoSource ? cap?.digitalTwinCreationEnabled : cap?.photoCreationEnabled) ?? cap?.creationEnabled;
  const selectedCreationReason = heyGenVideoSource ? cap?.digitalTwinCreationReason : cap?.photoCreationReason;
  const selectedReservationCny = (heyGenVideoSource ? cap?.digitalTwinReservationCny : cap?.photoReservationCny) ?? cap?.reservationCny;
  const [voiceId, setVoiceId] = useState('');
  const [authorized, setAuthorized] = useState(false); const [adultConfirmed, setAdultConfirmed] = useState(false); const [confirmed, setConfirmed] = useState(false);
  const [reuseGroup, setReuseGroup] = useState(true);
  const [samePersonConfirmed, setSamePersonConfirmed] = useState(false);
  const [selected, setSelected] = useState<{ look: PresenterLook; creationId?: string }>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [submitStage, setSubmitStage] = useState<'idle' | 'voice' | 'voice_processing' | 'upload' | 'create' | 'authorization'>('idle');
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadStage, setUploadStage] = useState('');
  useEffect(() => {
    if (!busy || submitStage !== 'upload' || !attempt.current) return;
    let live = true; let checking = false;
    const requestId = attempt.current.uploadRequestId;
    const timer = window.setInterval(async () => {
      if (checking) return; checking = true;
      try { const state = await presenterApi.uploadStatus(requestId); if (live) setUploadStage(state.stage); }
      catch { /* Keep the upload request and its eventual error authoritative. */ }
      finally { checking = false; }
    }, 5000);
    return () => { live = false; window.clearInterval(timer); };
  }, [busy, submitStage]);
  const actionFeedback = useRef<HTMLDivElement>(null);
  const authorizationSection = useRef<HTMLElement>(null);
  const [search, setSearch] = useState('');
  const [expandedGroupId, setExpandedGroupId] = useState('');
  const [catalogScope, setCatalogScope] = useState<'public' | 'private'>('public');
  const [favoritesSynced, setFavoritesSynced] = useState(false);
  const favoriteSyncStarted = useRef(false);
  const attempt = useRef<{ requestId: string; uploadRequestId: string; uploadId?: string; arkPhotoMaterialId?: string; arkVideoMaterialId?: string; signature?: string } | undefined>(undefined);
  const inFlight = useRef(false);
  const updateJob = (job: PresenterCreation) => setJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
  const run = async (operation: () => Promise<void>, onError?: (message: string) => void) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (e) {
      const message = e instanceof Error ? e.message : '人物服务请求失败';
      if (onError) onError(message); else setError(message);
    }
    finally { inFlight.current = false; setBusy(false); }
  };
  useEffect(() => {
    dialog.current?.showModal();
    let live = true;
    void Promise.allSettled([presenterApi.capabilities(), presenterApi.creations(), presenterApi.voices()]).then(results => {
      if (!live) return;
      const [c, j, v] = results;
      if (c.status === 'fulfilled') setCap(c.value);
      if (j.status === 'fulfilled') setJobs(j.value);
      if (v.status === 'fulfilled') { setVoices(v.value.items); setVoiceToken(v.value.nextToken); }
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length) setError(failures.map(r => r.status === 'rejected' ? String(r.reason.message || r.reason) : '').join('；'));
    });
    return () => { live = false; };
  }, []);
  useEffect(() => { recordingUrlRef.current = recordingUrl; }, [recordingUrl]);
  useEffect(() => () => {
    if (recordingTimer.current) window.clearInterval(recordingTimer.current);
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    recordingStream.current?.getTracks().forEach(track => track.stop());
  }, []);
  useEffect(() => { if (initialConfiguration && !looks.length && !inFlight.current && !new URLSearchParams(window.location.search).has('presenterConsentReturn')) void loadCatalog(); }, [initialConfiguration]);
  useEffect(() => {
    const pending = jobs.filter(j => ['processing', 'pending_consent', 'uncertain'].includes(j.status));
    if (!pending.length) return;
    let live = true;
    const timer = window.setTimeout(async () => {
      if (inFlight.current) { if (live) setJobs(current => [...current]); return; }
      const results = await Promise.allSettled(pending.map(job => presenterApi.refresh(job.id)));
      if (!live) return;
      const updated = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
      setJobs(current => current.map(job => updated.find(item => item.id === job.id) || job));
      if (results.some(r => r.status === 'rejected')) setError('人物状态刷新暂时失败，可点击“刷新状态”重试');
      else if (updated.length) { setError(''); setActionError(''); }
    }, 15000);
    return () => { live = false; window.clearTimeout(timer); };
  }, [jobs]);
  useEffect(() => {
    if (!voiceCloneJob || !['submitting', 'processing'].includes(voiceCloneJob.status)) return;
    const timer = window.setTimeout(() => { if (!inFlight.current) void refreshVoiceClone(); }, 5000);
    return () => window.clearTimeout(timer);
  }, [voiceCloneJob]);
  const loadCatalog = () => run(async () => {
    const result = await presenterApi.catalog(lookToken, catalogScope);
    setLooks(current => [...new Map([...current, ...result.items].map(look => [look.id, look])).values()]); setLookToken(result.nextToken);
  });
  const syncFavorites = () => run(async () => {
    const result = await presenterApi.syncFavorites();
    await onSynced?.(result.defaults);
    setFavoritesSynced(true);
    setNotice(`HeyGen 收藏 ${result.favoriteCount} 个，本次自动导入 ${result.importedCount} 个${result.skippedWithoutVoice ? `；${result.skippedWithoutVoice} 个缺少原配音色，需手动补选` : ''}${result.capacityReached ? '；企业人物已达上限' : ''}。`);
  });
  useEffect(() => {
    if (initialConfiguration || favoriteSyncStarted.current) return;
    favoriteSyncStarted.current = true;
    void syncFavorites();
  }, []);
  const choose = (look: PresenterLook, job?: PresenterCreation) => {
    setVoiceCloneJob(undefined); voiceAttempt.current = undefined;
    try {
      const saved = JSON.parse(sessionStorage.getItem(`presenter-voice-job:${look.id}`) || 'null');
      if (saved && typeof saved.id === 'string' && ['processing', 'submitting', 'completed', 'failed', 'uncertain'].includes(saved.status)) setVoiceCloneJob(saved);
    } catch { /* Ignore unavailable or stale browser storage. */ }
    setSelected({ look, creationId: job?.id }); setVoiceId(job?.voiceId || look.voiceId || ''); setAuthorized(false); if (initialConfiguration) setWizardStep(3);
  };
  const beginOfficialConsent = (job: PresenterCreation) => run(async () => {
    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.set('presenterConsentReturn', job.id);
    const updated = await presenterApi.consent(job.id, crypto.randomUUID(), undefined, returnUrl.href);
    updateJob(updated);
    if (updated.status === 'completed' && updated.look) { choose(updated.look, updated); return; }
    if (!updated.consentUrl) throw new Error('HeyGen 未返回可用的本人授权页面');
    window.location.assign(updated.consentUrl);
  });
  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get('presenterConsentReturn');
    if (!jobId) return;
    const clean = new URL(window.location.href); clean.searchParams.delete('presenterConsentReturn');
    void run(async () => {
      const updated = await presenterApi.refresh(jobId);
      window.history.replaceState({}, '', clean.href);
      updateJob(updated);
      if (updated.status !== 'completed' || !updated.look) {
        setWizardStep(2); setNotice('已返回灵枢，HeyGen 正在确认本人授权；页面会自动刷新状态。'); return;
      }
      if (initialConfiguration && updated.voiceId) {
        const defaults = await presenterApi.import({ lookId: updated.look.id, creationId: updated.id, voiceId: updated.voiceId, reviewed: true, authorized: true, makeDefault: true });
        await onSaved(defaults, { creationId: updated.id, arkPreparation: updated.arkPreparation });
        return;
      }
      choose(updated.look, updated);
      setNotice(updated.type === 'photo' ? '照片人物已创建。请选择声音后保存为默认人物。' : 'HeyGen 本人授权已通过，人物已绑定回灵枢。请选择声音后保存为默认人物。');
    });
  }, []);
  const submitOwnVoiceRaw = async (recordedFile?: File): Promise<string> => {
    if (voiceCloneJob?.status === 'failed') throw new Error('上次声音录入失败，请点击重新提交录音');
    if (voiceCloneJob) return voiceCloneJob.status === 'completed' ? (voiceCloneJob.voiceId || voiceId) : '';
    const sourceFile = recordedFile || voiceFile;
    if (!sourceFile) throw new Error('请先完成录音或上传本人录音');
    if (!voiceName.trim()) throw new Error('请填写声音名称');
    if (!voiceConsent) throw new Error('请确认本人声音克隆及商业口播使用授权');
    const signature = `${voiceName.trim()}:${voiceLanguage}:${sourceFile.name}:${sourceFile.size}:${sourceFile.lastModified}`;
    if (voiceAttempt.current && voiceAttempt.current.signature !== signature) throw new Error('上次声音提交结果尚未核实，请先核对原任务');
    voiceAttempt.current ||= { signature, requestId: crypto.randomUUID() };
    let result;
    try { result = await presenterApi.cloneVoice(sourceFile, voiceName.trim(), voiceLanguage, voiceAttempt.current.requestId); }
    catch (error) { if (error instanceof Error && /未受理|未提交声音克隆|有效录音/.test(error.message)) voiceAttempt.current = undefined; throw error; }
    voiceAttempt.current = undefined;
    setVoiceCloneJob(result);
    if (['failed', 'uncertain'].includes(result.status)) throw new Error('声音任务已留档但尚未确认可用。请切换到“选择已有声音”，从本企业音色列表核对后继续，勿重复提交录音。');
    if (result.status !== 'completed') return '';
    const completed = await presenterApi.cloneStatus(result.id);
    if (!completed.voice) return result.voiceId || '';
    setVoices(current => [...new Map([...current, completed.voice!].map(item => [item.id, item])).values()]);
    setVoiceId(completed.voice.id); setVoiceScope('private');
    return completed.voice.id;
  };
  const create = () => run(async () => {
    setActionError('');
    if (!heyGenSource) throw new Error('请先选择人物素材');
    if (initialConfiguration && (!photoFile || !videoFile)) throw new Error('请同时上传清晰正面照片和本人视频，两路人物服务会复用这套资料');
    const videoSource = heyGenVideoSource;
    const sourceType = videoSource ? 'digital_twin' : 'photo';
    const reuseId = cap?.privateCatalog && reuseGroup ? reusePresenterId : undefined;
    const signature = `${sourceType}:${name.trim()}:${heyGenSource.name}:${heyGenSource.size}:${heyGenSource.lastModified}:${photoFile?.name || ''}:${photoFile?.size || 0}:${videoFile?.name || ''}:${videoFile?.size || 0}:${reuseId || ''}`;
    if (attempt.current?.signature && attempt.current.signature !== signature) throw new Error('上次提交结果尚未核实，请先刷新任务列表');
    attempt.current ||= { requestId: crypto.randomUUID(), uploadRequestId: crypto.randomUUID(), signature };
    if (initialConfiguration && photoFile && videoFile) {
      setSubmitStage('upload');
      try {
        attempt.current.arkPhotoMaterialId ||= (await productionApi.uploadArkMaterial(photoFile, 'image')).id;
        attempt.current.arkVideoMaterialId ||= (await productionApi.uploadArkMaterial(videoFile, 'video')).id;
      } catch (e) { attempt.current = undefined; throw e; }
    }
    if (!attempt.current.uploadId) {
      setSubmitStage('upload'); setUploadPercent(0); setUploadStage('');
      try { attempt.current.uploadId = (await presenterApi.upload(heyGenSource, attempt.current.uploadRequestId, undefined, undefined, videoSource, setUploadPercent)).id; }
      catch (e) { if (!(e instanceof Error && /超时|连接中断|未返回有效结果/.test(e.message))) attempt.current = undefined; throw e; }
    }
    setSubmitStage('create');
    const arkPreparation = attempt.current.arkPhotoMaterialId && attempt.current.arkVideoMaterialId
      ? { photoMaterialId: attempt.current.arkPhotoMaterialId, videoMaterialId: attempt.current.arkVideoMaterialId, processingAuthorized: true as const }
      : undefined;
    const job = await presenterApi.create({ name: name.trim(), type: videoSource ? 'digital_twin' : 'photo', uploadId: attempt.current.uploadId, requestId: attempt.current.requestId, authorized, adultConfirmed, confirmed, arkPreparation, ...(reuseId ? { reusePresenterId: reuseId, samePersonConfirmed } : {}) });
    updateJob(job); attempt.current = undefined;
    if (job.status === 'uncertain' || job.status === 'failed') {
      setActionError(job.error || '人物任务结果尚未确认，请在下方刷新原任务，勿重复提交。');
      if (initialConfiguration) setWizardStep(2);
      window.requestAnimationFrame(() => authorizationSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    setFile(undefined); setPhotoFile(undefined); setVideoFile(undefined); setConfirmed(false); setAuthorized(false); setAdultConfirmed(false); setSamePersonConfirmed(false);
    if (job.status === 'completed' && job.look) choose(job.look, job);
    else if (initialConfiguration) { setWizardStep(2); setSubmitStage('authorization'); }
    setNotice(videoSource ? '人物资料已提交。HeyGen 授权完成后，同一套照片和视频会自动继续方舟认证，无需再次上传。' : '照片人物已提交；灵枢已保留本人授权记录。');
    window.requestAnimationFrame(() => authorizationSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, message => {
    setSubmitStage('idle');
    setActionError(message);
    window.requestAnimationFrame(() => { actionFeedback.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); actionFeedback.current?.focus(); });
  });
  const editFailedCreation = (job: PresenterCreation) => {
    setName(job.name);
    setWizardStep(1);
    setTab('create');
    setActionError(job.error || '请重新选择符合 HeyGen 官方要求的人物素材后提交。');
    setSubmitStage('idle');
    attempt.current = undefined;
    window.requestAnimationFrame(() => actionFeedback.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };
  const voice = voices.find(item => item.id === voiceId);
  const refreshVoiceClone = async () => {
    if (!voiceCloneJob || voicePollInFlight.current) return;
    voicePollInFlight.current = true;
    try {
      const result = await presenterApi.cloneStatus(voiceCloneJob.id);
      setVoiceCloneJob(current => current ? { ...current, status: result.status, voiceId: result.voice?.id || current.voiceId } : current);
      if (result.status === 'failed') {
        resumeSaveAfterVoice.current = false;
        setSubmitStage('idle');
        setActionError(result.error || '本人声音录入失败，请更换清晰录音后重试');
      }
      else if (result.status === 'completed' && result.voice) {
        setVoices(current => [...new Map([...current, result.voice!].map(item => [item.id, item])).values()]);
        setVoiceId(result.voice.id); setVoiceScope('private');
        if (resumeSaveAfterVoice.current) {
          resumeSaveAfterVoice.current = false;
          setNotice('本人声音已同步，正在自动保存默认人物。');
          window.setTimeout(() => void saveSelected(result.voice!.id), 0);
        } else {
          setSubmitStage('idle');
          setNotice('本人声音已录入并自动选中，可以保存默认人物。');
        }
      }
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '本人声音状态刷新失败，请稍后重试');
    } finally {
      voicePollInFlight.current = false;
    }
  };
  const finishRecording = () => {
    if (recordingTimer.current) window.clearInterval(recordingTimer.current);
    recordingTimer.current = undefined;
    const recorder = mediaRecorder.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  };
  const startRecordingTimer = () => {
    if (recordingTimer.current) window.clearInterval(recordingTimer.current);
    recordingTimer.current = window.setInterval(() => setRecordingSeconds(current => {
      const next = current + 1;
      if (next >= 60) window.setTimeout(finishRecording, 0);
      return Math.min(next, 60);
    }), 1000);
  };
  const startRecording = async () => {
    setError(''); setNotice('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('当前浏览器不支持网页录音，请改用 Chrome、Edge 或上传录音文件。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      if (recordingUrl) { URL.revokeObjectURL(recordingUrl); setRecordingUrl(''); }
      setVoiceFile(undefined); setRecordingSeconds(0); recordingChunks.current = [];
      recordingStream.current = stream; mediaRecorder.current = recorder;
      recorder.ondataavailable = event => { if (event.data.size) recordingChunks.current.push(event.data); };
      recorder.onstop = () => {
        const type = recorder.mimeType || recordingChunks.current[0]?.type || 'audio/webm';
        const blob = new Blob(recordingChunks.current, { type });
        recordingStream.current?.getTracks().forEach(track => track.stop());
        recordingStream.current = undefined;
        if (!blob.size) { submitRecordingOnStop.current = false; setRecordingState('idle'); setError('没有录到声音，请检查麦克风权限后重试。'); return; }
        if (blob.size > 10 * 1024 * 1024) { submitRecordingOnStop.current = false; setRecordingState('idle'); setError('录音超过 10MB，请缩短后重试。'); return; }
        const extension = type.includes('ogg') ? 'ogg' : 'webm';
        const recordedFile = new File([blob], `lingshu-voice-${Date.now()}.${extension}`, { type, lastModified: Date.now() });
        setVoiceFile(recordedFile);
        setRecordingUrl(URL.createObjectURL(blob)); setRecordingState('ready');
        if (submitRecordingOnStop.current) { submitRecordingOnStop.current = false; void saveSelected(undefined, recordedFile); }
      };
      recorder.start(500); setRecordingState('recording'); startRecordingTimer();
    } catch (caught) {
      recordingStream.current?.getTracks().forEach(track => track.stop());
      setRecordingState('idle');
      setError(caught instanceof DOMException && caught.name === 'NotAllowedError' ? '需要允许麦克风权限才能开始录音。' : '麦克风启动失败，请检查设备后重试。');
    }
  };
  const pauseOrResumeRecording = () => {
    const recorder = mediaRecorder.current;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      recorder.pause();
      if (recordingTimer.current) window.clearInterval(recordingTimer.current);
      recordingTimer.current = undefined;
      setRecordingState('paused');
    }
    else if (recorder.state === 'paused') { recorder.resume(); setRecordingState('recording'); startRecordingTimer(); }
  };
  const resetRecording = () => {
    submitRecordingOnStop.current = false;
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    setRecordingUrl(''); setVoiceFile(undefined); setRecordingSeconds(0); setRecordingState('idle');
  };
  useEffect(() => {
    if (!selected) return;
    try {
      const key = `presenter-voice-job:${selected.look.id}`;
      if (voiceCloneJob) sessionStorage.setItem(key, JSON.stringify(voiceCloneJob));
      else sessionStorage.removeItem(key);
    } catch { /* Server task remains the source of truth. */ }
  }, [voiceCloneJob, selected]);
  const saveSelected = (resolvedVoiceId?: string, recordedFile?: File) => run(async () => {
    if (!selected) throw new Error('请先选择已完成人像授权的人物');
    setActionError('');
    let selectedVoiceId = resolvedVoiceId || voiceId;
    if (voiceEntry === 'own' && !selectedVoiceId) {
      setSubmitStage('voice');
      selectedVoiceId = await submitOwnVoiceRaw(recordedFile);
      if (!selectedVoiceId) {
        resumeSaveAfterVoice.current = true;
        setSubmitStage('voice_processing');
        setNotice('本人声音正在同步到 HeyGen。完成后将自动保存为默认人物，无需再次点击。');
        return;
      }
    }
    if (!selectedVoiceId) throw new Error('请选择或录入人物声音');
    const value = await presenterApi.import({ lookId: selected.look.id, creationId: selected.creationId, voiceId: selectedVoiceId, reviewed: true, authorized, makeDefault: initialConfiguration });
    const creation = selected.creationId ? jobs.find(job => job.id === selected.creationId) : undefined;
    await onSaved(value, { creationId: selected.creationId, arkPreparation: creation?.arkPreparation });
    setSubmitStage('idle');
    setNotice(initialConfiguration ? '已保存为默认口播人物。' : '人物已添加到企业资产。');
    setSelected(undefined);
  }, message => {
    setSubmitStage('idle');
    setActionError(message);
    window.requestAnimationFrame(() => { actionFeedback.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); actionFeedback.current?.focus(); });
  });
  const normalizedSearch = search.trim().toLowerCase();
  const catalogGroups = groupPresenterLooks(looks).filter(group => !normalizedSearch
    || group.name.toLowerCase().includes(normalizedSearch)
    || group.looks.some(look => look.name.toLowerCase().includes(normalizedSearch)));
  const recordingScript = '大家好，我是您的专属口播伙伴。欢迎使用灵枢 AI，灵枢可以帮助企业理解产品、策划内容，并高效生成真实自然的口播视频。现在，邀请您创建属于自己的口播角色，让每一次表达都更有温度，也让更多客户认识并信任您的品牌。';
  const ownVoiceRecorder = <div className="space-y-3 rounded-xl border border-border p-3">
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">声音名称<input aria-label="声音名称" className={field} value={voiceName} maxLength={100} onChange={event => setVoiceName(event.target.value)} placeholder="例如：我的中文声音" /></label><label className="text-sm">录音语言<select aria-label="录音语言" className={field} value={voiceLanguage} onChange={event => setVoiceLanguage(event.target.value)}><option value="zh-CN">中文</option><option value="en-US">English</option><option value="es-ES">Español</option><option value="fr-FR">Français</option><option value="de-DE">Deutsch</option></select></label></div>
    <section aria-label="网页录音" className="space-y-3 rounded-xl bg-surface-2 p-4"><div><p className="text-sm font-bold">直接录音（推荐）</p><p className="mt-1 text-xs text-text-muted">在安静环境中照读下方文案，建议录制 15–60 秒；完成后也可直接提交较短的有效录音。</p></div><blockquote className="rounded-lg border border-border bg-white p-3 text-sm leading-7 text-text-secondary">{recordingScript}</blockquote><div className="flex flex-wrap items-center gap-2">{recordingState === 'idle' && <button type="button" className={`${button} bg-gradient-to-r from-blue-600 to-violet-600 text-white`} onClick={() => void startRecording()}>开始录音</button>}{(recordingState === 'recording' || recordingState === 'paused') && <><button type="button" className={button} onClick={pauseOrResumeRecording}>{recordingState === 'paused' ? '继续录音' : '暂停录音'}</button><button type="button" className={`${button} border-red-200 text-red-700`} onClick={finishRecording}>完成录音</button><span role="status" className="text-sm font-semibold text-red-600">● {recordingState === 'paused' ? '已暂停，可完成并提交' : '录音中'} {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}</span></>}{recordingState === 'ready' && <><span className="text-sm font-semibold text-emerald-700">录音已完成 · {recordingSeconds} 秒</span><button type="button" className={button} onClick={resetRecording}>重新录音</button></>}</div>{recordingUrl && <audio aria-label="本人录音试听" controls src={recordingUrl} className="h-10 w-full" />}</section>
    <label className="block text-sm">或上传本人录音<input aria-label="本人录音" type="file" accept=".wav,.mp3,.m4a,.ogg,.webm,audio/wav,audio/mpeg,audio/mp4,audio/ogg,audio/webm" className={field} onChange={event => { resetRecording(); setVoiceFile(event.target.files?.[0]); }} /><span className="mt-1 block text-xs text-text-muted">支持 WAV、MP3、M4A、OGG、WebM，最大 10MB。</span></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={voiceConsent} onChange={event => setVoiceConsent(event.target.checked)} />我确认这是本人声音，并授权用于声音克隆及企业商业口播</label>{voiceCloneJob ? <div className={`rounded-lg p-3 text-sm ${voiceCloneJob.status === 'completed' ? 'bg-emerald-50 text-emerald-800' : voiceCloneJob.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-900'}`}><div className="flex flex-wrap items-center gap-2"><strong>声音处理状态：{voiceCloneJob.status === 'completed' ? '已完成并选中' : voiceCloneJob.status === 'failed' ? '失败' : '处理中'}</strong>{voiceCloneJob.status !== 'completed' && <button type="button" className={button} disabled={busy} onClick={() => void refreshVoiceClone()}>刷新声音状态</button>}</div>{voiceCloneJob.status === 'failed' && <button type="button" className={button} disabled={busy} onClick={() => { setVoiceCloneJob(undefined); voiceAttempt.current = undefined; setActionError(''); setSubmitStage('idle'); }}>重新提交录音</button>}{voiceCloneJob.status === 'completed' && <p className="mt-1">声音“{voiceName.trim()}”已可用。</p>}</div> : <p className="rounded-lg bg-sky-50 p-3 text-xs text-sky-900">人像授权通过后，可在保存人物时一并录入本人声音。</p>}
  </div>;
  const voicePicker = <div className="space-y-3"><div className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-1" aria-label="人物声音录入方式"><button type="button" className={`rounded-lg px-3 py-2 text-sm ${voiceEntry === 'existing' ? 'bg-white font-bold shadow-sm' : ''}`} onClick={() => setVoiceEntry('existing')}>选择已有声音</button><button type="button" className={`rounded-lg px-3 py-2 text-sm ${voiceEntry === 'own' ? 'bg-white font-bold shadow-sm' : ''}`} onClick={() => { setVoiceEntry('own'); setVoiceId(''); }}>录入本人声音</button></div>{voiceEntry === 'existing' ? <>{cap?.privateCatalog && <label className="block text-sm">声音来源<select aria-label="声音来源" className={field} value={voiceScope} onChange={e => { const scope = e.target.value as 'public' | 'private'; setVoiceScope(scope); void presenterApi.voices('', '', scope).then(page => { setVoices(page.items); setVoiceToken(page.nextToken); }).catch(error => setError(String(error))); }}><option value="public">公共音色</option><option value="private">本企业已录入音色</option></select></label>}<label className="block text-sm">人物声音<select aria-label="人物声音" className={field} value={voiceId} onChange={e => setVoiceId(e.target.value)}>
    <option value="">请选择声音</option>{voiceId && !voices.some(v => v.id === voiceId) && <option value={voiceId}>人物原配声音</option>}
    {voices.map(v => <option key={v.id} value={v.id}>{v.name} · {v.language}</option>)}
  </select></label>{voice && !voice.previewUrl && <p className="text-xs text-text-muted">此声音暂未提供试听样本</p>}{voice?.previewUrl && <audio aria-label="声音试听" controls src={voice.previewUrl} className="h-10 w-full" />}
    {voiceToken && <button className={button} type="button" disabled={busy} onClick={() => void run(async () => { const result = await presenterApi.voices(voiceToken, '', voiceScope); setVoices(current => [...new Map([...current, ...result.items].map(v => [v.id, v])).values()]); setVoiceToken(result.nextToken); })}>加载更多声音</button>}</> : ownVoiceRecorder}</div>;
  const ownVoiceReady = Boolean(voiceCloneJob || (voiceName.trim() && voiceConsent && (voiceFile || recordingState === 'recording' || recordingState === 'paused')));
  const enrollmentVoiceReady = voiceEntry === 'existing' ? Boolean(voiceId) : ownVoiceReady;
  return <dialog ref={dialog} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} aria-labelledby="presenter-manager-title" className="m-auto max-h-[90vh] w-[min(900px,94vw)] overflow-y-auto rounded-2xl border border-border bg-white p-0 text-text-primary shadow-xl backdrop:bg-black/35">
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-white p-5"><div><h2 id="presenter-manager-title" className="font-bold">{initialConfiguration ? '接入数字人物与声音' : '企业人物资产'}</h2></div><button type="button" disabled={busy} onClick={onClose} className={button} aria-label="关闭人物管理">关闭</button></header>
    <div className="space-y-5 p-5">
      {cap?.reason && <p className="rounded-lg bg-amber-50 p-3 text-sm">{cap.reason}</p>}
      {cap && !selectedCreationEnabled && selectedCreationReason && selectedCreationReason !== cap.reason && tab === 'create' && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">当前创建方式暂不可用：{selectedCreationReason}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm">{notice}</p>}
      {initialConfiguration && <ol className="grid grid-cols-3 gap-2" aria-label="人物配置步骤">{['一次录入人物资料','官方本人授权','配置声音并保存'].map((label, index) => <li key={label} className={`rounded-lg border px-2 py-2 text-center text-xs ${wizardStep === index + 1 ? 'border-accent bg-accent/5 font-bold text-text-primary' : wizardStep > index + 1 ? 'border-border text-text-secondary' : 'border-border text-text-muted'}`}>{index + 1}. {label}</li>)}</ol>}
      {(!initialConfiguration || wizardStep === 1) && <div className="grid grid-cols-2 gap-2"><button className={`${button} ${tab === 'import' ? 'border-accent bg-accent/5 font-bold text-text-primary' : ''}`} disabled={busy} onClick={() => { setTab('import'); if (!looks.length) void loadCatalog(); if (!initialConfiguration && !favoritesSynced) void syncFavorites(); }}>选择已授权人物</button><button className={`${button} ${tab === 'create' ? 'border-accent bg-accent/5 font-bold text-text-primary' : ''}`} disabled={busy} onClick={() => { setTab('create'); setSelected(undefined); setAuthorized(false); }}>录入新人物</button></div>}
      {tab === 'create' && (!initialConfiguration || wizardStep === 1) && <fieldset disabled={busy || !selectedCreationEnabled} className="space-y-4 disabled:opacity-60">
        <label className="block text-sm">人物名称<input aria-label="人物名称" className={field} value={name} maxLength={100} onChange={e => setName(e.target.value)} placeholder="例如：品牌主理人、销售顾问" /></label>
        {initialConfiguration ? <section className="space-y-3 rounded-lg border border-border p-4" aria-label="统一人物资料"><div><p className="text-sm font-semibold">人物照片与本人视频</p><p className="mt-1 text-xs text-text-muted">只需上传一次：视频用于 HeyGen 人物创建，照片和同一段视频会自动复用到方舟本人认证。</p></div><label className="block text-sm">清晰正面照片<input aria-label="统一人物正面照片" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={event => setPhotoFile(event.target.files?.[0])} className={field} /><span className="mt-1 block text-xs text-text-muted">JPG 或 PNG，正脸清晰、无遮挡。</span></label><label className="block text-sm">本人视频<input aria-label="统一人物本人视频" type="file" accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm" onChange={event => setVideoFile(event.target.files?.[0])} className={field} /><span className="mt-1 block text-xs text-text-muted">30 秒至 5 分钟、至少 720p/24fps，并包含本人清晰说话音频。</span></label></section> : <label className="block text-sm">人物素材<input key={file ? 'selected' : 'empty'} aria-label="人物素材" type="file" accept=".jpg,.jpeg,.png,.mp4,.mov,.webm,image/jpeg,image/png,video/mp4,video/quicktime,video/webm" onChange={e => setFile(e.target.files?.[0])} className={field} /><span className="mt-1 block text-xs text-text-muted">{file ? `已选择：${file.name}。${file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name) ? '视频将创建 Digital Twin，并进入 HeyGen 官方本人授权。' : '照片将创建照片人物，由灵枢保存本人授权记录。'}` : '照片支持 JPG/PNG；Digital Twin 视频须为 30 秒至 5 分钟、至少 720p/24fps并包含清晰人声。'}</span></label>}
        <p className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">提交后先完成 HeyGen 官方本人授权；返回灵枢并保存声音后，系统会用同一套资料继续方舟认证。</p>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={authorized} onChange={e => setAuthorized(e.target.checked)} />我已取得此人物的肖像及素材使用授权，同意将素材提交给 HeyGen 与方舟处理</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={adultConfirmed} onChange={e => setAdultConfirmed(e.target.checked)} />我已核验画面主体为成年人</label>
        {cap?.privateCatalog && reusePresenterId && <div className="space-y-2 rounded-lg border border-emerald-200 p-3 text-sm"><label className="flex gap-2"><input type="checkbox" checked={reuseGroup} onChange={e => { setReuseGroup(e.target.checked); setSamePersonConfirmed(false); }} />沿用当前人物的 HeyGen 人物组授权</label>{reuseGroup && <label className="flex gap-2"><input type="checkbox" checked={samePersonConfirmed} onChange={e => setSamePersonConfirmed(e.target.checked)} />确认新增素材与当前已授权人物为同一人</label>}<p className="text-xs text-text-muted">若是另一位人物，取消沿用后创建独立人物组，由本人完成所需验证。</p></div>}
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />确认创建人物{Number(selectedReservationCny) > 0 ? `并接受供应商计费（本次安全预留上限 ¥${selectedReservationCny}，以实际账单为准）` : ''}</label>
        <div className="flex gap-2"><button type="button" disabled={busy || !name.trim() || !selectedCreationEnabled || (initialConfiguration ? !photoFile || !videoFile : !file) || !authorized || !adultConfirmed || !confirmed || Boolean(cap?.privateCatalog && reusePresenterId && reuseGroup && !samePersonConfirmed)} onClick={() => void create()} className={`${button} bg-gradient-to-r from-blue-600 to-violet-600 text-white`}>{busy ? (submitStage === 'upload' ? '正在安全入库并复用人物资料…' : '正在创建人物任务…') : '提交资料并继续本人授权'}</button></div>
        <div ref={actionFeedback} tabIndex={-1} className="outline-none">
          {busy && <p role="status" className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">{submitStage === 'upload' ? (uploadPercent < 100 ? `第 1 步：上传至本地服务 ${uploadPercent}%` : (uploadStage === 'confirming_upload' ? '正在确认 HeyGen 素材登记，完成后创建人物。' : uploadStage === 'uploading_to_provider' ? '正在上传至 HeyGen；尚未提交人物创建，请等待结果。' : '素材已传到本地服务，正在检查并处理视频。')) : '第 2 步：正在创建人物；完成后将进入官方本人授权。'}</p>}
          {actionError && <div role="alert" className="space-y-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><strong className="block">本次提交未完成</strong><p>{actionError}</p><p className="text-xs">已填写内容会保留。请按提示处理后，在这里继续。</p></div>}
        </div>
        {(!name.trim() || (initialConfiguration ? !photoFile || !videoFile : !file) || !authorized || !adultConfirmed || !confirmed) && <p role="status" className="rounded-lg bg-surface-2 p-3 text-xs text-text-secondary">还需完成：{[!name.trim() && '填写人物名称', initialConfiguration && !photoFile && '上传正面照片', initialConfiguration && !videoFile && '上传本人视频', !initialConfiguration && !file && '上传人物素材', !authorized && '确认肖像及素材授权', !adultConfirmed && '确认人物已成年', !confirmed && '确认创建人物'].filter(Boolean).join('、')}。</p>}
        {attempt.current && <p className="text-xs">如提交未返回结果，保持名称和文件不变后重试，将继续核对同一请求。</p>}
      </fieldset>}
      {tab === 'import' && (!initialConfiguration || wizardStep === 1) && <div className="space-y-3">
        <button type="button" disabled={busy} onClick={() => void syncFavorites()} className={button}>{favoritesSynced ? '同步收藏' : '导入 HeyGen 收藏'}</button>
        {cap?.privateCatalog && <label className="block text-sm">人物来源<select className={field} value={catalogScope} disabled={busy} onChange={e => { const scope = e.target.value as 'public' | 'private'; setCatalogScope(scope); setSelected(undefined); void run(async () => { const result = await presenterApi.catalog('', scope); setLooks(result.items); setLookToken(result.nextToken); }); }}><option value="public">公共人物库</option><option value="private">企业账号已有的人物</option></select></label>}
        <input aria-label="筛选人物" placeholder="按人物或场景名称筛选" value={search} onChange={e => setSearch(e.target.value)} className={field} />
        <div className="max-h-96 space-y-3 overflow-y-auto" aria-label="已加载人物组">{catalogGroups.map(group => {
          const expanded = expandedGroupId === group.id;
          return <section key={group.id} className={`rounded-xl border ${expanded ? 'border-emerald-300 bg-emerald-50/40' : 'border-border'}`}>
            <button type="button" disabled={busy} aria-expanded={expanded} onClick={() => setExpandedGroupId(current => current === group.id ? '' : group.id)} className="grid w-full grid-cols-[96px_1fr_auto] items-center gap-3 p-3 text-left">
              {group.representative.imageUrl ? <img src={group.representative.imageUrl} alt={group.name} loading="lazy" className="h-20 w-24 rounded-lg object-cover" /> : <span className="h-20 w-24 rounded-lg bg-surface-2" />}
              <span><strong className="block text-sm">{group.name}</strong><span className="mt-1 block text-xs text-text-muted">{group.looks.length} 个可用形象</span></span>
              <span className="text-xs font-medium text-emerald-700">{expanded ? '收起' : '查看形象'}</span>
            </button>
            {expanded && <div className="grid grid-cols-2 gap-2 border-t border-emerald-100 p-3 sm:grid-cols-4" aria-label={`${group.name} 的场景造型`}>
              {group.looks.map(look => <button type="button" disabled={busy || look.status !== 'completed'} key={look.id} onClick={() => choose(look)} className={`overflow-hidden rounded-lg border bg-white p-2 text-left text-xs ${selected?.look.id === look.id ? 'border-emerald-600 ring-1 ring-emerald-500' : 'border-border'}`}>
                {look.imageUrl && <img src={look.imageUrl} alt={look.name} loading="lazy" className="mb-2 h-24 w-full rounded object-contain" />}<span>{look.name}</span>
              </button>)}
            </div>}
          </section>;
        })}</div>
        <button className={button} type="button" disabled={busy} onClick={() => void loadCatalog()}>{lookToken ? '加载更多人物' : '刷新人物列表'}</button>
      </div>}
      {(!initialConfiguration || tab === 'create') && <section ref={authorizationSection} className="scroll-mt-24 space-y-3 border-t border-border pt-4"><div className="flex items-center justify-between"><div><h3 className="font-bold">人物授权状态</h3><p className="mt-1 text-xs text-text-muted">照片人物保留本页的本人授权声明；视频数字分身还需由本人在 HeyGen 官方页面完成验证。验证通过后才能保存为企业默认人物。</p></div><button disabled={busy} className={button} onClick={() => void run(async () => { setJobs(await presenterApi.creations()); setActionError(''); })}>刷新状态</button></div>
        {!jobs.length && <p className="text-sm text-text-muted">暂无创建任务。提交后进度会保存在这里，关闭页面也不会丢失。</p>}
        {jobs.map(job => <div key={job.id} className="space-y-2 rounded-lg border border-border p-3"><div className="flex flex-wrap items-center gap-3"><span className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded bg-surface-2 font-bold text-text-secondary">{job.name.slice(0, 1)}{job.look?.imageUrl && <img alt={job.name} src={job.look.imageUrl} className="absolute inset-0 h-full w-full object-cover" onError={event => { event.currentTarget.style.display = 'none'; }} />}</span><strong className="text-sm">{job.name}</strong><span className="text-xs">{statusText(job)}</span>
          <button disabled={busy} className={button} onClick={() => void run(async () => updateJob(await presenterApi.refresh(job.id)))}>刷新状态</button>
          {job.status === 'completed' && job.look && <button disabled={busy} className={button} onClick={() => { setTab('import'); choose(job.look!, job); }}>{job.type === 'photo' ? '照片人物已创建，继续配置声音' : '授权已通过，继续保存'}</button>}
          {job.status === 'pending_consent' && !job.consentUrl && <button disabled={busy} className={`${button} bg-gradient-to-r from-blue-600 to-violet-600 text-white`} onClick={() => void beginOfficialConsent(job)}>前往 HeyGen 完成本人授权</button>}
          {job.status === 'failed' && job.failureCategory !== 'capacity' && <button disabled={busy} className={button} onClick={() => editFailedCreation(job)}>返回修改素材</button>}
        </div>{job.status === 'failed'
          ? <p className="rounded-lg bg-red-50 p-2 text-xs text-red-800">{job.failureCategory === 'capacity' ? 'HeyGen 账号人物名额已满。请处理名额或选择同一人的已有授权人物，然后继续录入。' : '人物创建未被 HeyGen 受理，不需要继续授权。请按下方原因修改素材后重新提交。'}</p>
          : job.status === 'uncertain'
            ? <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">提交结果尚未核实。请刷新原任务，系统不会重复创建。</p>
            : <p className={`rounded-lg p-2 text-xs ${job.status === 'completed' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>{job.type === 'photo' ? '照片人物状态：' : '官方授权状态：'}{job.status === 'completed' ? (job.type === 'photo' ? '创建完成；本人授权声明已留档，无 HeyGen 视频本人验证' : '已通过') : job.consentStatus || '未通过'}{job.status !== 'completed' && '。完成授权并等待官方确认后，才可继续保存。'}</p>}{job.error && <p className={`text-xs ${job.status === 'failed' ? 'text-red-700' : 'text-amber-700'}`}>{job.error}</p>}
          {job.type === 'digital_twin' && job.groupId && <p className="break-all text-xs text-text-muted">绑定的 HeyGen 人物组：{job.groupId}</p>}
          {job.status === 'processing' && <p role="status" className="rounded-lg bg-sky-50 p-3 text-xs text-sky-950">人物处理中，完成后即可选择。</p>}
          {job.consentUrl && <div className="rounded-lg bg-amber-50 p-3 text-sm"><a className="font-bold text-emerald-700 underline" href={job.consentUrl} target="_blank" rel="noopener noreferrer">前往 HeyGen 完成本人授权</a><span className="ml-2 text-xs text-amber-900">请由人物本人在 HeyGen 页面完成验证；完成后返回此处点击“刷新状态”。</span></div>}
        </div>)}
      </section>}
      {selected && tab === 'import' && (!initialConfiguration || wizardStep === 3) && <fieldset disabled={busy} className="space-y-3 rounded-xl border border-border bg-white p-4"><h3 className="font-bold">配置声音并保存 · {selected.look.name}</h3>
        {selected.look.videoUrl ? <video aria-label="人物预览" controls src={selected.look.videoUrl} poster={selected.look.imageUrl} className="max-h-64 w-full rounded" /> : selected.look.imageUrl ? <img src={selected.look.imageUrl} alt={selected.look.name} className="max-h-64 w-full object-contain" /> : <p className="text-sm">供应商暂未提供预览，请稍后刷新。</p>}
        {selected.creationId && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{jobs.find(job => job.id === selected.creationId)?.type === 'photo' ? '照片人物已创建，本人使用授权声明已留档。现在配置声音。' : '人物官方授权已通过。现在配置声音，不会影响或重复提交人像任务。'}</p>}{voicePicker}<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={authorized} onChange={event => setAuthorized(event.target.checked)} />我已预览人物与声音，并确认将其用于企业真人口播</label>{initialConfiguration && <p className="text-xs text-text-muted">保存后，所有后续真人口播都会默认使用此人物；首帧背景将从当前对标分镜素材中合成。</p>}<div ref={actionFeedback} tabIndex={-1} className="space-y-2 outline-none">{(busy || submitStage === 'voice_processing') && <p role="status" className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">{submitStage === 'voice_processing' ? '本人声音正在 HeyGen 处理中，完成后会自动保存。' : submitStage === 'voice' ? '正在录入本人声音…' : '正在保存默认人物…'}</p>}{actionError && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700"><strong className="block">声音配置未完成</strong><p>{actionError}</p></div>}</div><div className="flex gap-2"><button className={button} onClick={() => { setSelected(undefined); if (initialConfiguration) setWizardStep(1); }}>上一步</button><button type="button" disabled={!authorized || !enrollmentVoiceReady || !(selected.look.imageUrl || selected.look.videoUrl) || submitStage === 'voice_processing'} className={`${button} bg-gradient-to-r from-blue-600 to-violet-600 text-white`} onClick={() => { if (recordingState === 'recording' || recordingState === 'paused') { submitRecordingOnStop.current = true; finishRecording(); } else void saveSelected(); }}>{submitStage === 'voice_processing' ? '声音处理中，将自动保存…' : initialConfiguration ? '保存为默认口播人物' : '添加到企业'}</button></div>
      </fieldset>}
    </div>
  </dialog>;
}
