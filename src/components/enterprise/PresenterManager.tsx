import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, UserRoundPlus, UsersRound } from 'lucide-react';
import { presenterApi } from '../../lib/presenterApi';
import { productionApi } from '../../lib/productionApi';
import { clearPresenterOnboardingDraft, loadPresenterOnboardingDraft, savePresenterOnboardingDraft } from '../../lib/presenterOnboardingDraft';
import type { ArkPresenterPreparation, PresenterCapabilities, PresenterCreation, PresenterLook, PresenterVoice, PresenterVoiceCandidate } from '../../lib/presenterAssets';
import type { PresenterAsset, ProductionDefaults } from '../../lib/shotProduction';
import { extractPresenterPhoto } from '../../lib/presenterVideoFrame';

const statusText = (job: PresenterCreation) => job.status === 'pending_consent'
  ? job.consentRequestedAt ? '授权已发起 · HeyGen 确认中' : '待发起本人授权'
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
type VoiceCloneJob = { id: string; status: string; voiceId: string; candidates?: PresenterVoiceCandidate[]; arkVoice?: { speakerId?: string; status: string; error?: string } };
const storedVoiceCloneJob = (lookId: string): VoiceCloneJob | undefined => {
  if (!lookId || typeof window === 'undefined') return undefined;
  try {
    const saved = JSON.parse(sessionStorage.getItem(`presenter-voice-job:${lookId}`) || 'null');
    return saved && typeof saved.id === 'string' && ['processing', 'submitting', 'completed', 'failed', 'uncertain'].includes(saved.status)
      ? saved as VoiceCloneJob
      : undefined;
  } catch { return undefined; }
};
export default function PresenterManager({ onClose, onSaved, onSynced, onPersonPrepared, reusePresenterId, initialConfiguration = false, initialStage = 'person', voiceOnlyPresenter }: { onClose: () => void; onSaved: (value: ProductionDefaults, context?: PresenterSaveContext) => void | Promise<void>; onSynced?: (value: ProductionDefaults) => void | Promise<void>; onPersonPrepared?: () => void; /** @deprecated 素材类型现在由上传文件自动识别。 */ initialMode?: 'quick' | 'expert'; /** @deprecated 创建流程已统一。 */ fixedMode?: boolean; reusePresenterId?: string; initialConfiguration?: boolean; initialStage?: 'person' | 'certification'; voiceOnlyPresenter?: PresenterAsset }) {
  const voiceOnlyAvatarId = voiceOnlyPresenter?.toolMappings?.heygen?.avatarId || voiceOnlyPresenter?.avatarId || '';
  const voiceOnlyLook: PresenterLook | undefined = voiceOnlyPresenter && voiceOnlyAvatarId ? {
    id: voiceOnlyAvatarId,
    name: voiceOnlyPresenter.name,
    voiceId: voiceOnlyPresenter.toolMappings?.heygen?.voiceId || voiceOnlyPresenter.voiceId,
    imageUrl: voiceOnlyPresenter.imageUrl,
    videoUrl: voiceOnlyPresenter.videoUrl,
    orientation: voiceOnlyPresenter.nativeOrientation || 'unknown',
    status: 'completed',
  } : undefined;
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'choose' | 'create' | 'import'>(voiceOnlyLook ? 'import' : initialConfiguration && initialStage !== 'certification' ? 'choose' : 'create');
  const [ownSourceMode, setOwnSourceMode] = useState<'new' | 'local'>('new');
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(voiceOnlyLook ? 3 : 1);
  const [cap, setCap] = useState<PresenterCapabilities>();
  const [jobs, setJobs] = useState<PresenterCreation[]>([]);
  const [looks, setLooks] = useState<PresenterLook[]>([]); const [lookToken, setLookToken] = useState('');
  const [voices, setVoices] = useState<PresenterVoice[]>([]); const [voiceToken, setVoiceToken] = useState('');
  const [voiceScope, setVoiceScope] = useState<'public' | 'private'>('public');
  const [voiceEntry, setVoiceEntry] = useState<'existing' | 'own'>(voiceOnlyLook ? 'own' : 'existing');
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
  const [voiceCloneJob, setVoiceCloneJob] = useState<VoiceCloneJob | undefined>(() => storedVoiceCloneJob(voiceOnlyLook?.id || ''));
  const voiceAttempt = useRef<{ signature: string; requestId: string } | undefined>(undefined);
  const voicePollInFlight = useRef(false);
  const resumeSaveAfterVoice = useRef(false);
  const filePickerActive = useRef(false);
  const filePickerReleaseTimer = useRef<number | undefined>(undefined);
  const filePickerFocusRelease = useRef<(() => void) | undefined>(undefined);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File>();
  const [photoFile, setPhotoFile] = useState<File>();
  const [videoFile, setVideoFile] = useState<File>();
  const [videoRecordingState, setVideoRecordingState] = useState<'idle' | 'requesting' | 'recording' | 'processing' | 'ready'>('idle');
  const [videoRecordingSeconds, setVideoRecordingSeconds] = useState(0);
  const [videoRecordingUrl, setVideoRecordingUrl] = useState('');
  const [onboardingDraftLoaded, setOnboardingDraftLoaded] = useState(!initialConfiguration);
  const onboardingDraftRestoreStarted = useRef(false);
  const restoringOnboardingDraft = useRef(false);
  const videoPreview = useRef<HTMLVideoElement>(null);
  const videoRecorder = useRef<MediaRecorder | undefined>(undefined);
  const videoRecordingStream = useRef<MediaStream | undefined>(undefined);
  const videoRecordingChunks = useRef<Blob[]>([]);
  const videoRecordingTimer = useRef<number | undefined>(undefined);
  const videoRecordingUrlRef = useRef('');
  const [photoSource, setPhotoSource] = useState<'frame' | 'upload'>('frame');
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [frameState, setFrameState] = useState<'idle' | 'extracting' | 'ready' | 'failed'>('idle');
  const [voiceCandidate, setVoiceCandidate] = useState<File>();
  const [candidateState, setCandidateState] = useState<'idle' | 'extracting' | 'ready' | 'short' | 'failed'>('idle');
  const [candidateHint, setCandidateHint] = useState('');
  const [candidateUrl, setCandidateUrl] = useState('');
  const frameRequest = useRef(0);
  const voiceRequest = useRef(0);
  useEffect(() => {
    if (!voiceCandidate) { setCandidateUrl(''); return; }
    const url = URL.createObjectURL(voiceCandidate); setCandidateUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [voiceCandidate]);
  useEffect(() => {
    if (!photoFile) { setPhotoPreviewUrl(''); return; }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);
  const selectVideo = async (selectedFile?: File) => {
    setActionError('');
    const request = ++frameRequest.current;
    const audioRequest = ++voiceRequest.current;
    setVideoFile(selectedFile);
    setPhotoFile(undefined);
    setPhotoSource('frame');
    setFrameState(selectedFile ? 'extracting' : 'idle');
    setVoiceCandidate(undefined); setCandidateState(selectedFile ? 'extracting' : 'idle'); setCandidateHint('');
    if (!selectedFile) return;
    void presenterApi.voiceCandidateFromVideo(selectedFile).then(result => {
      if (audioRequest !== voiceRequest.current) return;
      setVoiceCandidate(result.file);
      const short = result.nonSilentSeconds < 30;
      setCandidateState(short ? 'short' : 'ready');
      setCandidateHint(`音轨 ${Math.round(result.durationSeconds)} 秒，估算非静音 ${Math.round(result.nonSilentSeconds)} 秒。${short ? '建议补录或上传至少 30 秒清晰单人口播。' : '请试听并确认是本人清晰口播；背景音乐或噪声也可能被算作非静音。'}`);
      setVoiceEntry('own');
      setVoiceName(current => current || `${name.trim() || '本人'}的声音`);
    }).catch(cause => {
      if (audioRequest !== voiceRequest.current) return;
      setCandidateState('failed'); setCandidateHint(cause instanceof Error ? cause.message : '无法提取口播，请补录或上传录音');
    });
    try {
      const frame = await extractPresenterPhoto(selectedFile);
      if (request !== frameRequest.current) return;
      setPhotoFile(frame);
      setFrameState('ready');
    } catch {
      if (request !== frameRequest.current) return;
      setFrameState('failed');
    }
  };
  const selectPhoto = (selectedFile?: File) => {
    if (selectedFile) {
      ++frameRequest.current;
      setPhotoFile(selectedFile);
      setPhotoSource('upload');
      setFrameState('ready');
    }
  };
  const heyGenSource = initialConfiguration ? videoFile || photoFile : file;
  // Unified onboarding always creates a Digital Twin from the required video.
  // Before a file is selected, treating the empty source as a photo makes the
  // whole fieldset inherit photo-creation availability and can deadlock the
  // form when only Digital Twin creation is enabled.
  const heyGenVideoSource = initialConfiguration || Boolean(heyGenSource && (heyGenSource.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(heyGenSource.name)));
  const selectedCreationEnabled = (heyGenVideoSource ? cap?.digitalTwinCreationEnabled : cap?.photoCreationEnabled) ?? cap?.creationEnabled;
  const selectedCreationReason = heyGenVideoSource ? cap?.digitalTwinCreationReason : cap?.photoCreationReason;
  const selectedReservationCny = (heyGenVideoSource ? cap?.digitalTwinReservationCny : cap?.photoReservationCny) ?? cap?.reservationCny;
  const [voiceId, setVoiceId] = useState('');
  const [authorized, setAuthorized] = useState(false); const [adultConfirmed, setAdultConfirmed] = useState(false); const [confirmed, setConfirmed] = useState(false);
  const [localStorageConfirmed, setLocalStorageConfirmed] = useState(false);
  const [reuseGroup, setReuseGroup] = useState(true);
  const [samePersonConfirmed, setSamePersonConfirmed] = useState(false);
  const [selected, setSelected] = useState<{ look: PresenterLook; creationId?: string } | undefined>(() => voiceOnlyLook ? { look: voiceOnlyLook } : undefined);
  useEffect(() => {
    if (!initialConfiguration) return;
    const inheritedName = name.trim() || voiceOnlyPresenter?.name.trim() || selected?.look.name.trim() || '';
    if (inheritedName) setVoiceName(inheritedName);
    setVoiceLanguage('zh-CN');
  }, [initialConfiguration, name, selected?.look.name, voiceOnlyPresenter?.name]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [discardingCreationId, setDiscardingCreationId] = useState('');
  const [submitStage, setSubmitStage] = useState<'idle' | 'voice' | 'voice_processing' | 'upload' | 'create' | 'authorization'>('idle');
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadStage, setUploadStage] = useState('');
  useEffect(() => {
    if (!initialConfiguration || voiceOnlyPresenter || onboardingDraftRestoreStarted.current) return;
    onboardingDraftRestoreStarted.current = true;
    let live = true;
    void loadPresenterOnboardingDraft().then(async draft => {
      if (!live || !draft) return;
      restoringOnboardingDraft.current = true;
      setTab('create');
      setOwnSourceMode('new');
      setName(draft.name || '');
      if (draft.videoFile) {
        setVideoRecordingState('processing');
        if (videoRecordingUrlRef.current) URL.revokeObjectURL(videoRecordingUrlRef.current);
        setVideoRecordingUrl(URL.createObjectURL(draft.videoFile));
        await selectVideo(draft.videoFile);
        if (draft.photoSource === 'upload' && draft.photoFile) selectPhoto(draft.photoFile);
        if (live) setVideoRecordingState('ready');
      }
    }).catch(() => {
      // A blocked or full browser cache must not prevent onboarding.
    }).finally(() => {
      restoringOnboardingDraft.current = false;
      if (live) setOnboardingDraftLoaded(true);
    });
    return () => { live = false; };
  }, [initialConfiguration, voiceOnlyPresenter]);
  useEffect(() => {
    if (!initialConfiguration || voiceOnlyPresenter || !onboardingDraftLoaded || restoringOnboardingDraft.current) return;
    const timer = window.setTimeout(() => {
      void savePresenterOnboardingDraft({
        name,
        videoFile,
        photoFile: photoSource === 'upload' ? photoFile : undefined,
        photoSource,
      }).catch(() => { /* Continue without persistence if browser storage is unavailable. */ });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [initialConfiguration, name, onboardingDraftLoaded, photoFile, photoSource, videoFile, voiceOnlyPresenter]);
  const clearVoiceCloneJob = () => {
    const lookId = selected?.look.id || voiceOnlyLook?.id || '';
    setVoiceCloneJob(undefined);
    voiceAttempt.current = undefined;
    resumeSaveAfterVoice.current = false;
    setSubmitStage('idle');
    setActionError('');
    if (!lookId || typeof window === 'undefined') return;
    try { window.sessionStorage.removeItem(`presenter-voice-job:${lookId}`); } catch { /* Server task remains authoritative. */ }
  };
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
      if (j.status === 'fulfilled') {
        setJobs(j.value);
        if (initialConfiguration && initialStage === 'certification' && !voiceOnlyPresenter && !new URLSearchParams(window.location.search).has('presenterConsentReturn')) {
          const resumable = j.value.find(item => ['submitting', 'processing', 'pending_consent', 'uncertain'].includes(item.status));
          if (resumable) { setTab('create'); setWizardStep(2); }
        }
      }
      if (v.status === 'fulfilled') { setVoices(v.value.items); setVoiceToken(v.value.nextToken); }
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length) setError(failures.map(r => r.status === 'rejected' ? String(r.reason.message || r.reason) : '').join('；'));
    });
    return () => { live = false; };
  }, []);
  useEffect(() => { recordingUrlRef.current = recordingUrl; }, [recordingUrl]);
  useEffect(() => { videoRecordingUrlRef.current = videoRecordingUrl; }, [videoRecordingUrl]);
  useEffect(() => {
    if (videoPreview.current && videoRecordingStream.current && videoRecordingState === 'recording') {
      videoPreview.current.srcObject = videoRecordingStream.current;
      void videoPreview.current.play().catch(() => {});
    }
  }, [videoRecordingState]);
  useEffect(() => () => {
    if (recordingTimer.current) window.clearInterval(recordingTimer.current);
    if (filePickerReleaseTimer.current) window.clearTimeout(filePickerReleaseTimer.current);
    if (filePickerFocusRelease.current) window.removeEventListener('focus', filePickerFocusRelease.current);
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    if (videoRecordingTimer.current) window.clearInterval(videoRecordingTimer.current);
    if (videoRecordingUrlRef.current) URL.revokeObjectURL(videoRecordingUrlRef.current);
    recordingStream.current?.getTracks().forEach(track => track.stop());
    videoRecordingStream.current?.getTracks().forEach(track => track.stop());
  }, []);
  useEffect(() => { if (initialConfiguration && !voiceOnlyPresenter && tab === 'import' && !looks.length && !inFlight.current && !new URLSearchParams(window.location.search).has('presenterConsentReturn')) void loadCatalog(); }, [initialConfiguration, tab, voiceOnlyPresenter]);
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
      else if (updated.length) {
        setError(''); setActionError('');
        const completed = initialConfiguration ? updated.find(item => item.status === 'completed' && item.look) : undefined;
        if (completed?.look) { setTab('import'); choose(completed.look, completed); }
      }
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
    const linkedVoiceId = job?.voiceId || look.voiceId || '';
    setVoiceCloneJob(storedVoiceCloneJob(look.id)); voiceAttempt.current = undefined;
    setSelected({ look, creationId: job?.id }); setVoiceId(linkedVoiceId); setAuthorized(Boolean(job));
    setVoiceEntry(job && !linkedVoiceId ? 'own' : 'existing'); setVoiceConsent(Boolean(job));
    if (initialConfiguration) setWizardStep(3);
  };
  const requestOfficialConsent = async (job: PresenterCreation, externalTab?: Window | null) => {
    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.set('presenterConsentReturn', job.id);
    const updated = await presenterApi.consent(job.id, crypto.randomUUID(), undefined, returnUrl.href);
    updateJob(updated);
    if (updated.status === 'completed' && updated.look) { choose(updated.look, updated); return; }
    if (!updated.consentUrl) throw new Error('HeyGen 未返回可用的本人授权页面');
    if (externalTab && !externalTab.closed) externalTab.location.assign(updated.consentUrl);
    else window.location.assign(updated.consentUrl);
  };
  const beginOfficialConsent = (job: PresenterCreation) => {
    // This manager is rendered inside a native <dialog>. A portal-based
    // confirmation modal sits behind the browser top layer and appears to do
    // nothing, so the explicit action button is the confirmation itself.
    const externalTab = window.open('about:blank', '_blank');
    if (externalTab) externalTab.opener = null;
    void run(async () => {
      try { await requestOfficialConsent(job, externalTab); }
      catch (error) { externalTab?.close(); throw error; }
    });
  };
  const discardCreation = (job: PresenterCreation) => run(async () => {
    await presenterApi.discardCreation(job.id);
    setJobs(current => current.filter(item => item.id !== job.id));
    setDiscardingCreationId('');
    setNotice(`已删除“${job.name}”的本地创建记录；HeyGen 供应商账户中的原始人物未被删除。`);
  });
  useEffect(() => {
    if (voiceOnlyPresenter) return;
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
      choose(updated.look, updated);
      setNotice(updated.type === 'photo'
        ? '照片人物已创建。请选择已有声音或录入本人声音，再保存为默认人物。'
        : updated.voiceId
          ? 'HeyGen 本人授权已通过，人物原配声音已预选。你也可以切换到“录入本人声音”，确认后再保存。'
          : 'HeyGen 本人授权已通过，人物已绑定回灵枢。请选择已有声音或录入本人声音，再保存为默认人物。');
    });
  }, []);
  const submitOwnVoiceRaw = async (recordedFile?: File): Promise<string> => {
    if (voiceCloneJob?.status === 'failed') throw new Error('上次声音录入失败，请点击重新提交录音');
    if (voiceCloneJob?.status === 'uncertain') throw new Error('上次声音任务结果尚未确认，请先点击“核对原声音任务”，系统不会重复提交录音');
    if (voiceCloneJob) return voiceCloneJob.status === 'completed' ? (voiceCloneJob.voiceId || voiceId) : '';
    const sourceFile = recordedFile || voiceFile || voiceCandidate;
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
    if (initialConfiguration && initialStage === 'person') {
      if (!name.trim() || !photoFile || !videoFile) throw new Error('请填写人物名称，并准备本人照片和视频');
      if (!localStorageConfirmed || !adultConfirmed) throw new Error('请确认肖像素材可由灵枢安全保存，且画面主体为成年人');
      const signature = `local-profile:${name.trim()}:${photoFile.name}:${photoFile.size}:${photoFile.lastModified}:${videoFile.name}:${videoFile.size}:${videoFile.lastModified}`;
      if (attempt.current?.signature && attempt.current.signature !== signature) throw new Error('上次保存结果尚未核实，请保持原文件后重试');
      attempt.current ||= { requestId: crypto.randomUUID(), uploadRequestId: crypto.randomUUID(), signature };
      setSubmitStage('upload');
      try {
        const [photoMaterial, videoMaterial] = await Promise.all([
          attempt.current.arkPhotoMaterialId
            ? Promise.resolve({ id: attempt.current.arkPhotoMaterialId })
            : productionApi.uploadArkMaterial(photoFile, 'image'),
          attempt.current.arkVideoMaterialId
            ? Promise.resolve({ id: attempt.current.arkVideoMaterialId })
            : productionApi.uploadArkMaterial(videoFile, 'video'),
        ]);
        attempt.current.arkPhotoMaterialId = photoMaterial.id;
        attempt.current.arkVideoMaterialId = videoMaterial.id;
        const saved = await presenterApi.saveProfile({
          requestId: attempt.current.requestId,
          name: name.trim(),
          photoMaterialId: photoMaterial.id,
          videoMaterialId: videoMaterial.id,
          storageAuthorized: true,
          adultConfirmed: true,
        });
        attempt.current = undefined;
        await onSynced?.(saved.defaults);
        setSubmitStage('idle');
        setNotice('人物照片和视频已安全入库，尚未调用 HeyGen。');
        onPersonPrepared?.();
        return;
      } catch (cause) {
        if (!(cause instanceof Error && /超时|连接中断|未返回有效结果/.test(cause.message))) attempt.current = undefined;
        throw cause;
      }
    }
    if (!heyGenSource) throw new Error('请先选择人物素材');
    if (initialConfiguration && (!photoFile || !videoFile)) throw new Error('请同时上传清晰正面照片和本人视频，两路人物服务会复用这套资料');
    if (!authorized || !adultConfirmed || !confirmed) throw new Error('请确认肖像授权、主体已成年与创建费用');
    const videoSource = heyGenVideoSource;
    const sourceType = videoSource ? 'digital_twin' : 'photo';
    const reuseId = cap?.privateCatalog && reuseGroup ? reusePresenterId : undefined;
    const signature = `${sourceType}:${name.trim()}:${heyGenSource.name}:${heyGenSource.size}:${heyGenSource.lastModified}:${photoFile?.name || ''}:${photoFile?.size || 0}:${videoFile?.name || ''}:${videoFile?.size || 0}:${reuseId || ''}`;
    if (attempt.current?.signature && attempt.current.signature !== signature) throw new Error('上次提交结果尚未核实，请先刷新任务列表');
    attempt.current ||= { requestId: crypto.randomUUID(), uploadRequestId: crypto.randomUUID(), signature };
    if (videoSource) {
      setSubmitStage('upload');
      try {
        const retainedPhoto = initialConfiguration && photoFile ? photoFile : await extractPresenterPhoto(heyGenSource);
        attempt.current.arkPhotoMaterialId ||= (await productionApi.uploadArkMaterial(retainedPhoto, 'image')).id;
        attempt.current.arkVideoMaterialId ||= (await productionApi.uploadArkMaterial(heyGenSource, 'video')).id;
      } catch (e) { attempt.current = undefined; throw e; }
    }
    if (!attempt.current.uploadId) {
      setSubmitStage('upload'); setUploadPercent(0); setUploadStage('');
      try { attempt.current.uploadId = (await presenterApi.upload(heyGenSource, attempt.current.uploadRequestId, undefined, undefined, videoSource, setUploadPercent)).id; }
      catch (e) { if (!(e instanceof Error && /超时|连接中断|未返回有效结果/.test(e.message))) attempt.current = undefined; throw e; }
    }
    setSubmitStage('create');
    const arkPreparation = attempt.current.arkPhotoMaterialId && attempt.current.arkVideoMaterialId
      ? { photoMaterialId: attempt.current.arkPhotoMaterialId, videoMaterialId: attempt.current.arkVideoMaterialId, processingAuthorized: false }
      : undefined;
    const job = await presenterApi.create({ name: name.trim(), type: videoSource ? 'digital_twin' : 'photo', uploadId: attempt.current.uploadId, requestId: attempt.current.requestId, authorized, adultConfirmed, confirmed, arkPreparation, ...(reuseId ? { reusePresenterId: reuseId, samePersonConfirmed } : {}) });
    updateJob(job); attempt.current = undefined;
    if (job.status === 'uncertain' || job.status === 'failed') {
      setActionError(job.error || '人物任务结果尚未确认，请在下方刷新原任务，勿重复提交。');
      if (initialConfiguration) setWizardStep(1);
      else window.requestAnimationFrame(() => authorizationSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    if (initialConfiguration) void clearPresenterOnboardingDraft().catch(() => {});
    if (!initialConfiguration) { setFile(undefined); setPhotoFile(undefined); setVideoFile(undefined); setFrameState('idle'); }
    setConfirmed(false); setAuthorized(false); setAdultConfirmed(false); setSamePersonConfirmed(false);
    if (job.status === 'completed' && job.look) choose(job.look, job);
    else if (initialConfiguration) {
      setSubmitStage('idle');
      if (initialStage === 'person' && onPersonPrepared) { onPersonPrepared(); return; }
      setWizardStep(2); setNotice('人物资料已保存。请确认后再前往 HeyGen 完成本人授权；声音素材可在授权后绑定。'); return;
    }
    setNotice(videoSource ? '人物资料已提交。HeyGen 授权完成后即可用于普通口播；照片和视频已保留，需要高级人物替换时再单独进行方舟认证。' : '照片人物已提交；灵枢已保留本人授权记录。');
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
      setActionError('');
      setVoiceCloneJob(current => current ? { ...current, status: result.status, voiceId: result.voice?.id || current.voiceId, candidates: result.candidates, arkVoice: result.arkVoice || current.arkVoice } : current);
      if (result.status === 'failed') {
        resumeSaveAfterVoice.current = false;
        setSubmitStage('idle');
        setActionError(result.error || '本人声音录入失败，请更换清晰录音后重试');
      }
      else if (result.status === 'completed' && result.voice) {
        const returnedVoices = result.candidates?.length ? result.candidates : [result.voice];
        setVoices(current => [...new Map([...current, ...returnedVoices].map(item => [item.id, item])).values()]);
        setVoiceId(result.voice.id); setVoiceScope('private');
        if ((result.candidates?.length || 0) > 1) {
          resumeSaveAfterVoice.current = false;
          setSubmitStage('idle');
          setNotice(`供应商返回了 ${result.candidates!.length} 版本人音色，请试听并选择一版后保存。`);
        } else if (resumeSaveAfterVoice.current) {
          resumeSaveAfterVoice.current = false;
          setNotice('本人声音已同步到人物生产链，正在自动保存默认人物。');
          window.setTimeout(() => void saveSelected(result.voice!.id), 0);
        } else {
          setSubmitStage('idle');
          setNotice('本人声音已录入并自动选中，可以保存默认人物。');
        }
      }
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '本人声音状态刷新失败，请稍后重试');
      setVoiceCloneJob(current => current ? { ...current } : current);
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
      clearVoiceCloneJob();
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
    clearVoiceCloneJob();
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
        setNotice('本人声音正在同步到 HeyGen，并保留为方舟/Seedance 音色参考。完成后将自动保存为默认人物，无需再次点击。');
        return;
      }
    }
    if (!selectedVoiceId) throw new Error('请选择或录入人物声音');
    if (voiceOnlyPresenter) {
      const result = await presenterApi.bindVoice(voiceOnlyPresenter.id, selectedVoiceId);
      await onSaved(result.defaults);
    } else {
      const value = await presenterApi.import({ lookId: selected.look.id, creationId: selected.creationId, voiceId: selectedVoiceId, reviewed: true, authorized, adultConfirmed, makeDefault: initialConfiguration });
      const creation = selected.creationId ? jobs.find(job => job.id === selected.creationId) : undefined;
      await onSaved(value, { creationId: selected.creationId, arkPreparation: creation?.arkPreparation });
    }
    setSubmitStage('idle');
    clearVoiceCloneJob();
    setNotice(voiceOnlyPresenter ? '本人声音已绑定到当前数字人。' : initialConfiguration ? '已保存为默认口播人物。' : '人物已添加到企业资产。');
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
  const stopVideoRecording = () => {
    if (videoRecordingTimer.current) window.clearInterval(videoRecordingTimer.current);
    videoRecordingTimer.current = undefined;
    if (videoRecorder.current?.state && videoRecorder.current.state !== 'inactive') videoRecorder.current.stop();
  };
  const resetVideoRecording = () => {
    if (videoRecordingTimer.current) window.clearInterval(videoRecordingTimer.current);
    videoRecordingTimer.current = undefined;
    videoRecordingStream.current?.getTracks().forEach(track => track.stop());
    videoRecordingStream.current = undefined;
    if (videoRecordingUrl) URL.revokeObjectURL(videoRecordingUrl);
    setVideoRecordingUrl('');
    setVideoRecordingSeconds(0);
    setVideoRecordingState('idle');
    void selectVideo(undefined);
  };
  const startVideoRecording = async () => {
    setError(''); setActionError(''); setVideoRecordingState('requesting');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVideoRecordingState('idle');
      setError('当前浏览器不支持网页视频录制，请使用 Chrome、Edge，或上传本人视频。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      if (videoRecordingUrl) URL.revokeObjectURL(videoRecordingUrl);
      setVideoRecordingUrl(''); setVideoRecordingSeconds(0); setVideoFile(undefined); setPhotoFile(undefined);
      videoRecordingChunks.current = []; videoRecordingStream.current = stream; videoRecorder.current = recorder;
      recorder.ondataavailable = event => { if (event.data.size) videoRecordingChunks.current.push(event.data); };
      recorder.onstop = () => {
        const recordedType = recorder.mimeType || videoRecordingChunks.current[0]?.type || 'video/webm';
        const type = recordedType.split(';')[0] || 'video/webm';
        const blob = new Blob(videoRecordingChunks.current, { type });
        stream.getTracks().forEach(track => track.stop()); videoRecordingStream.current = undefined;
        if (!blob.size) { setVideoRecordingState('idle'); setError('没有录到视频，请检查摄像头和麦克风权限后重试。'); return; }
        const recordedFile = new File([blob], `lingshu-presenter-${Date.now()}.webm`, { type, lastModified: Date.now() });
        const url = URL.createObjectURL(blob); setVideoRecordingUrl(url); setVideoRecordingState('processing');
        void selectVideo(recordedFile).then(() => setVideoRecordingState('ready')).catch(cause => {
          setVideoRecordingState('ready'); setError(cause instanceof Error ? cause.message : '视频处理失败，请重新录制或上传。');
        });
      };
      recorder.start(1000); setVideoRecordingState('recording');
      videoRecordingTimer.current = window.setInterval(() => setVideoRecordingSeconds(current => {
        const next = current + 1;
        if (next >= 300) window.setTimeout(stopVideoRecording, 0);
        return Math.min(next, 300);
      }), 1000);
    } catch (cause) {
      setVideoRecordingState('idle');
      setError(cause instanceof Error && cause.name === 'NotAllowedError' ? '未获得摄像头或麦克风权限，请允许访问后重试。' : '无法启动视频录制，请检查设备后重试。');
    }
  };
  const settleFilePickerGuard = () => {
    if (filePickerReleaseTimer.current) window.clearTimeout(filePickerReleaseTimer.current);
    filePickerReleaseTimer.current = window.setTimeout(() => { filePickerActive.current = false; }, 750);
  };
  const armFilePickerGuard = () => {
    filePickerActive.current = true;
    if (filePickerFocusRelease.current) window.removeEventListener('focus', filePickerFocusRelease.current);
    const release = () => settleFilePickerGuard();
    filePickerFocusRelease.current = release;
    window.addEventListener('focus', release, { once: true });
  };
  const ownVoiceRecorder = <div className="space-y-3 rounded-xl border border-border p-3">
    {!initialConfiguration && <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">声音名称<input aria-label="声音名称" className={field} value={voiceName} maxLength={100} onChange={event => setVoiceName(event.target.value)} placeholder="例如：我的中文声音" /></label><label className="text-sm">录音语言<select aria-label="录音语言" className={field} value={voiceLanguage} onChange={event => setVoiceLanguage(event.target.value)}><option value="zh-CN">中文</option><option value="en-US">English</option><option value="es-ES">Español</option><option value="fr-FR">Français</option><option value="de-DE">Deutsch</option></select></label></div>}
    <section aria-label="网页录音" className="space-y-3 rounded-xl bg-surface-2 p-4"><div><p className="text-sm font-bold">直接录音（推荐）</p><p className="mt-1 text-xs text-text-muted">在安静环境中照读下方文案，建议录制 15–60 秒；完成后也可直接提交较短的有效录音。</p></div><blockquote className="rounded-lg border border-border bg-white p-3 text-sm leading-7 text-text-secondary">{recordingScript}</blockquote><div className="flex flex-wrap items-center gap-2">{recordingState === 'idle' && <button type="button" className={`${button} bg-gradient-to-r from-blue-600 to-violet-600 text-white`} onClick={() => void startRecording()}>开始录音</button>}{(recordingState === 'recording' || recordingState === 'paused') && <><button type="button" className={button} onClick={pauseOrResumeRecording}>{recordingState === 'paused' ? '继续录音' : '暂停录音'}</button><button type="button" className={`${button} border-red-200 text-red-700`} onClick={finishRecording}>完成录音</button><span role="status" className="text-sm font-semibold text-red-600">● {recordingState === 'paused' ? '已暂停，可完成并提交' : '录音中'} {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}</span></>}{recordingState === 'ready' && <><span className="text-sm font-semibold text-emerald-700">录音已完成 · {recordingSeconds} 秒</span><button type="button" className={button} onClick={resetRecording}>重新录音</button></>}</div>{recordingUrl && <audio aria-label="本人录音试听" controls src={recordingUrl} className="h-10 w-full" />}</section>
    <label className="block text-sm">或上传本人录音<input aria-label="本人录音" type="file" accept=".wav,.mp3,.m4a,.ogg,.webm,audio/wav,audio/mpeg,audio/mp4,audio/ogg,audio/webm" className={field} onChange={event => { resetRecording(); setVoiceFile(event.target.files?.[0]); }} /><span className="mt-1 block text-xs text-text-muted">支持 WAV、MP3、M4A、OGG、WebM，最大 10MB。新录音将替代视频提取的候选音色。</span></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={voiceConsent} onChange={event => setVoiceConsent(event.target.checked)} />我确认这是本人声音，并授权用于 HeyGen、方舟声音复刻及企业商业口播</label>{voiceCloneJob && <div className={`rounded-lg p-3 text-sm ${voiceCloneJob.status === 'completed' ? 'bg-emerald-50 text-emerald-800' : voiceCloneJob.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-900'}`}><div className="flex flex-wrap items-center gap-2"><strong>声音处理状态：{voiceCloneJob.status === 'completed' ? '已完成，可继续绑定' : voiceCloneJob.status === 'failed' ? '失败' : voiceCloneJob.status === 'uncertain' ? '待核对' : '处理中'}</strong>{voiceCloneJob.status !== 'completed' && <button type="button" className={button} disabled={busy} onClick={() => void refreshVoiceClone()}>{voiceCloneJob.status === 'uncertain' ? '核对原声音任务' : '刷新声音状态'}</button>}</div>{voiceCloneJob.candidates && voiceCloneJob.candidates.length > 1 && <fieldset className="mt-3 space-y-2"><legend className="font-semibold text-text-primary">选择一版本人音色</legend><p className="text-xs text-text-muted">供应商返回了 {voiceCloneJob.candidates.length} 版候选，试听后选择一版作为统一口播音色。</p>{voiceCloneJob.candidates.map((candidate, index) => <label key={candidate.id} className={`block rounded-lg border p-3 ${voiceCloneJob.voiceId === candidate.id ? 'border-accent bg-blue-50' : 'border-border bg-white'}`}><span className="flex items-center gap-2"><input type="radio" name={`voice-candidate-${voiceCloneJob.id}`} checked={voiceCloneJob.voiceId === candidate.id} onChange={() => { setVoiceId(candidate.id); setVoiceCloneJob(current => current ? { ...current, voiceId: candidate.id } : current); }} /><strong>候选 {index + 1}</strong><span className="text-xs text-text-muted">{candidate.name}</span></span>{candidate.previewUrl && <audio className="mt-2 h-10 w-full" controls src={candidate.previewUrl} aria-label={`本人音色候选 ${index + 1}`} />}</label>)}</fieldset>}{voiceCloneJob.arkVoice?.status === 'processing' && <p className="mt-2 text-xs">同一段本人录音已同步到豆包声音复刻；Seedance 将同时使用该录音作为音色参考。</p>}{voiceCloneJob.arkVoice?.status === 'not_configured' && <p className="mt-2 text-xs">当前未开通豆包声音复刻，已保留录音并作为 Seedance 音色参考，不额外创建方舟音色。</p>}{voiceCloneJob.arkVoice?.status === 'failed' && <p className="mt-2 text-xs text-amber-900">HeyGen 音色不受影响；豆包声音复刻暂未完成，Seedance 仍会使用已保存的本人录音作为音色参考。</p>}{['failed', 'completed'].includes(voiceCloneJob.status) && <button type="button" className={button} disabled={busy} onClick={() => { clearVoiceCloneJob(); resetRecording(); setActionError(''); }}>重新录入声音</button>}{voiceCloneJob.status === 'completed' && <p className="mt-1">上次录入的本人声音已可用；可直接绑定，也可重新录入。</p>}</div>}
  </div>;
  const voicePicker = <div className="space-y-3"><div className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-1" aria-label="人物声音录入方式"><button type="button" className={`rounded-lg px-3 py-2 text-sm ${voiceEntry === 'existing' ? 'bg-white font-bold shadow-sm' : ''}`} onClick={() => setVoiceEntry('existing')}>选择已有声音</button><button type="button" className={`rounded-lg px-3 py-2 text-sm ${voiceEntry === 'own' ? 'bg-white font-bold shadow-sm' : ''}`} onClick={() => { setVoiceEntry('own'); setVoiceId(''); }}>录入本人声音</button></div>{voiceEntry === 'existing' ? <>{cap?.privateCatalog && <label className="block text-sm">声音来源<select aria-label="声音来源" className={field} value={voiceScope} onChange={e => { const scope = e.target.value as 'public' | 'private'; setVoiceScope(scope); void presenterApi.voices('', '', scope).then(page => { setVoices(page.items); setVoiceToken(page.nextToken); }).catch(error => setError(String(error))); }}><option value="public">公共音色</option><option value="private">本企业已录入音色</option></select></label>}<label className="block text-sm">人物声音<select aria-label="人物声音" className={field} value={voiceId} onChange={e => setVoiceId(e.target.value)}>
    <option value="">请选择声音</option>{voiceId && !voices.some(v => v.id === voiceId) && <option value={voiceId}>人物原配声音</option>}
    {voices.map(v => <option key={v.id} value={v.id}>{v.name} · {v.language}</option>)}
  </select></label>{voice && !voice.previewUrl && <p className="text-xs text-text-muted">此声音暂未提供试听样本</p>}{voice?.previewUrl && <audio aria-label="声音试听" controls src={voice.previewUrl} className="h-10 w-full" />}
    {voiceToken && <button className={button} type="button" disabled={busy} onClick={() => void run(async () => { const result = await presenterApi.voices(voiceToken, '', voiceScope); setVoices(current => [...new Map([...current, ...result.items].map(v => [v.id, v])).values()]); setVoiceToken(result.nextToken); })}>加载更多声音</button>}</> : ownVoiceRecorder}</div>;
  const ownCreationVoice = voiceEntry === 'own' ? <div className="space-y-3"><button type="button" className={button} onClick={() => { setVoiceEntry('existing'); setVoiceId(selected?.look.voiceId || jobs.find(job => job.id === selected?.creationId)?.voiceId || ''); }}>使用录制视频中的本人声音</button>{ownVoiceRecorder}</div> : <div className="space-y-3" aria-label="默认本人声音"><div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-semibold text-text-primary">本人声音</h4><p className="mt-1 text-xs leading-5 text-text-muted">已默认使用录制本人形象时绑定的声音，无需再次选择。</p></div><span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 size={15} />已选用</span></div>{voice?.previewUrl && <audio aria-label="本人声音试听" controls src={voice.previewUrl} className="h-10 w-full" />}<button type="button" className={button} onClick={() => { setVoiceEntry('own'); setVoiceId(''); }}>声音不对？更换本人声音</button></div>;
  const ownVoiceReady = Boolean((voiceCloneJob && ['submitting', 'processing', 'completed'].includes(voiceCloneJob.status))
    || (voiceName.trim() && voiceConsent && (voiceFile || voiceCandidate || recordingState === 'recording' || recordingState === 'paused')));
  const enrollmentVoiceReady = voiceEntry === 'existing' ? Boolean(voiceId) : ownVoiceReady;
  const videoVoiceReview = <section aria-label="人物资料口播验收" className="space-y-3">
    <div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-semibold text-text-primary">口播声音</h4><p className="mt-1 text-xs leading-5 text-text-muted">麦克风音轨已随本人视频录入，无需重复录制；试听异常时再更换。</p></div>{candidateState === 'ready' || candidateState === 'short' ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 size={15} />已完成</span> : null}</div>
    <p role="status" className={`rounded-lg p-3 text-sm ${candidateState === 'ready' || candidateState === 'short' ? 'bg-emerald-50 text-emerald-800' : candidateState === 'failed' ? 'bg-amber-50 text-amber-900' : 'bg-sky-50 text-sky-900'}`}>{candidateState === 'extracting' ? '正在从视频生成口播声音…' : candidateState === 'ready' || candidateState === 'short' ? '口播声音已生成，可以直接继续。' : candidateState === 'failed' ? '视频音轨读取失败，请更换视频或单独录制声音。' : '正在读取视频音轨。'} {candidateState === 'ready' || candidateState === 'short' ? '' : candidateHint}</p>
    {candidateUrl && <audio aria-label="视频中的本人口播试听" controls src={candidateUrl} className="h-10 w-full" />}
    <details className="rounded-lg border border-border p-3" open={candidateState === 'failed'}><summary className="cursor-pointer text-sm font-semibold">声音不对？更换口播声音</summary><div className="mt-3">{ownVoiceRecorder}</div></details>
  </section>;
  return <dialog ref={dialog}
    onClickCapture={event => { const target = event.target; if (target instanceof HTMLInputElement && target.type === 'file') armFilePickerGuard(); }}
    onChangeCapture={event => { const target = event.target; if (target instanceof HTMLInputElement && target.type === 'file') settleFilePickerGuard(); }}
    onCancel={event => { event.preventDefault(); if (busy || filePickerActive.current) { settleFilePickerGuard(); return; } onClose(); }}
    aria-labelledby="presenter-manager-title" className="m-auto max-h-[90vh] w-[min(900px,94vw)] overflow-y-auto rounded-2xl border border-border bg-white p-0 text-text-primary shadow-xl backdrop:bg-black/35">
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-white p-5"><div><h2 id="presenter-manager-title" className="font-bold">{voiceOnlyPresenter ? '录入本人声音' : initialConfiguration ? '接入数字人物与声音' : '企业人物资产'}</h2></div><button type="button" disabled={busy} onClick={onClose} className={button} aria-label="关闭人物管理">关闭</button></header>
    <div className="space-y-5 p-5">
      {cap?.reason && (!initialConfiguration || initialStage === 'certification') && <p className="rounded-lg bg-amber-50 p-3 text-sm">{cap.reason}</p>}
      {cap && !selectedCreationEnabled && selectedCreationReason && selectedCreationReason !== cap.reason && tab === 'create' && (!initialConfiguration || initialStage === 'certification') && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">当前创建方式暂不可用：{selectedCreationReason}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm">{notice}</p>}
      {(!initialConfiguration || wizardStep === 1) && <section className="space-y-3" aria-label="选择数字人接入方式"><p className="text-sm font-semibold text-text-primary">先选择数字人来源</p><div className="grid gap-3 sm:grid-cols-2"><button type="button" className={`group flex min-h-36 flex-col items-start justify-between gap-5 rounded-xl border bg-white p-5 text-left transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${tab === 'create' ? 'border-accent shadow-sm' : 'border-border'}`} disabled={busy} onClick={() => { setTab('create'); setOwnSourceMode('new'); setSelected(undefined); setAuthorized(false); }}><span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tab === 'create' ? 'bg-gradient-to-br from-blue-600 to-violet-600 text-white' : 'bg-blue-50 text-blue-600'}`}><UserRoundPlus size={22} aria-hidden="true" /></span><span><span className="flex items-center gap-2 font-bold text-text-primary">使用本人形象 <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">推荐</span></span><span className="mt-1 block text-xs leading-5 text-text-muted">录入新人物，或选择灵枢本地已创建的本人形象</span></span></button><button type="button" className={`group flex min-h-36 flex-col items-start justify-between gap-5 rounded-xl border bg-white p-5 text-left transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${tab === 'import' ? 'border-accent shadow-sm' : 'border-border'}`} disabled={busy} onClick={() => { setTab('import'); if (!looks.length) void loadCatalog(); if (!initialConfiguration && !favoritesSynced) void syncFavorites(); }}><span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tab === 'import' ? 'bg-gradient-to-br from-blue-600 to-violet-600 text-white' : 'bg-violet-50 text-violet-600'}`}><UsersRound size={22} aria-hidden="true" /></span><span><span className="font-bold text-text-primary">选择 HeyGen 已有人物</span><span className="mt-1 block text-xs leading-5 text-text-muted">从已授权人物库中直接选择并使用</span></span></button></div></section>}
      {initialConfiguration && tab === 'create' && wizardStep === 1 && <section className="space-y-3" aria-label="选择本人形象来源"><div className="grid gap-2 sm:grid-cols-2"><button type="button" aria-pressed={ownSourceMode === 'new'} disabled={busy} onClick={() => setOwnSourceMode('new')} className={`rounded-lg border p-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${ownSourceMode === 'new' ? 'border-accent bg-blue-50' : 'border-border bg-white hover:bg-surface-2'}`}><strong className="block text-sm text-text-primary">录入新人物</strong><span className="mt-1 block text-xs leading-5 text-text-muted">录制视频并同步获得照片与口播声音</span></button><button type="button" aria-pressed={ownSourceMode === 'local'} disabled={busy} onClick={() => setOwnSourceMode('local')} className={`rounded-lg border p-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${ownSourceMode === 'local' ? 'border-accent bg-blue-50' : 'border-border bg-white hover:bg-surface-2'}`}><strong className="block text-sm text-text-primary">选择已创建的本人形象</strong><span className="mt-1 block text-xs leading-5 text-text-muted">仅显示在灵枢本地完成创建的人物</span></button></div></section>}
      {initialConfiguration && tab === 'create' && wizardStep === 1 && ownSourceMode === 'local' && <section aria-label="本地已创建的本人形象" className="space-y-3"><div><h3 className="text-sm font-semibold text-text-primary">本地已创建的本人形象</h3><p className="mt-1 text-xs leading-5 text-text-muted">只展示当前灵枢账号中已完成创建的人物，不读取 HeyGen 账号的其他人物。</p></div>{jobs.filter(job => job.status === 'completed' && job.look).length > 0 ? <div className="grid gap-2 sm:grid-cols-2">{jobs.filter(job => job.status === 'completed' && job.look).map(job => <button type="button" key={job.id} disabled={busy} onClick={() => { setTab('import'); choose(job.look!, job); }} className="grid min-w-0 grid-cols-[64px_1fr_auto] items-center gap-3 rounded-lg border border-border bg-white p-3 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"><span className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-sm font-semibold text-text-secondary">{job.name.slice(0, 1)}{job.look?.imageUrl && <img src={job.look.imageUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={event => { event.currentTarget.style.display = 'none'; }} />}</span><span className="min-w-0"><strong className="block truncate text-sm text-text-primary">{job.name}</strong><span className="mt-1 block text-xs text-text-muted">本地创建 · 可用</span></span><span className="text-xs font-semibold text-blue-700">选择</span></button>)}</div> : <div className="rounded-lg border border-dashed border-border p-5 text-center"><p className="text-sm font-semibold text-text-primary">暂无已创建的本人形象</p><p className="mt-1 text-xs leading-5 text-text-muted">完成一次本人形象录入和授权后，即可在这里直接选择。</p><button type="button" className={`${button} mt-3`} onClick={() => setOwnSourceMode('new')}>录入新人物</button></div>}</section>}
      {tab === 'create' && (!initialConfiguration || wizardStep === 1) && (!initialConfiguration || ownSourceMode === 'new') && <fieldset disabled={busy || ((!initialConfiguration || initialStage === 'certification') && !selectedCreationEnabled)} className="space-y-4 disabled:opacity-60">
        <label className="block text-sm"><span className="flex items-center justify-between gap-2"><span>人物名称</span>{initialConfiguration && name.trim() && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 size={15} />已完成</span>}</span><input aria-label="人物名称" className={field} value={name} maxLength={100} onChange={e => setName(e.target.value)} placeholder="例如：品牌主理人、销售顾问" /></label>
        {initialConfiguration ? <section className="space-y-4 rounded-lg border border-border p-4" aria-label="统一人物资料"><div><p className="text-sm font-semibold">一次录制完成人物资料</p><p className="mt-1 text-xs leading-5 text-text-muted">正对镜头照读推荐口播词。系统会保存本人视频、自动截取清晰照片，并提取声音用于后续口播。</p></div><blockquote className="rounded-lg border border-border bg-surface-2 p-3 text-sm leading-7 text-text-secondary">{recordingScript}</blockquote><div className="overflow-hidden rounded-xl border border-border bg-black"><div className="aspect-video">{videoRecordingState === 'recording' ? <video ref={videoPreview} aria-label="本人视频录制预览" muted playsInline className="h-full w-full object-contain" /> : videoRecordingUrl ? <video aria-label="本人视频录制回放" controls playsInline src={videoRecordingUrl} className="h-full w-full object-contain" /> : <div className="flex h-full flex-col items-center justify-center gap-3 text-white"><Camera size={32} aria-hidden="true" /><p className="text-sm">录制前请确认光线充足、面部无遮挡、环境安静</p></div>}</div></div><div className="flex flex-wrap items-center gap-2">{videoRecordingState === 'idle' && <button type="button" className={`${button} bg-gradient-to-r from-blue-600 to-violet-600 text-white`} onClick={() => void startVideoRecording()}>打开摄像头并录制</button>}{videoRecordingState === 'requesting' && <span role="status" className="text-sm text-text-muted">正在请求摄像头和麦克风权限…</span>}{videoRecordingState === 'recording' && <><button type="button" disabled={videoRecordingSeconds < 30} className={`${button} border-red-200 text-red-700`} onClick={stopVideoRecording}>完成录制</button><span role="status" className="text-sm font-semibold text-red-600">● 录制中 {Math.floor(videoRecordingSeconds / 60)}:{String(videoRecordingSeconds % 60).padStart(2, '0')}</span><span className="text-xs text-text-muted">至少录制 30 秒</span></>}{videoRecordingState === 'processing' && <span role="status" className="text-sm text-text-muted">正在生成照片与声音素材…</span>}{videoRecordingState === 'ready' && <><span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700"><CheckCircle2 size={16} />视频、照片和声音已准备</span><button type="button" className={button} onClick={resetVideoRecording}>重新录制</button></>}</div><details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">无法现场录制？上传本人视频</summary><label className="mt-3 block text-xs text-text-secondary">30 秒至 5 分钟、至少 720p/24fps，并包含本人清晰说话音频。<input aria-label="统一人物本人视频" type="file" accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm" onChange={event => { resetVideoRecording(); void selectVideo(event.target.files?.[0]); }} className={`${field} mt-2 bg-white`} /></label></details>{photoFile && <div className="grid gap-3 sm:grid-cols-[160px_1fr]"><div className="aspect-video overflow-hidden rounded-lg border border-border bg-surface-2"><img src={photoPreviewUrl} alt={photoSource === 'frame' ? '从本人视频抽取的图片素材帧' : '自行上传的本人照片'} className="h-full w-full object-contain" /></div><div><p className="text-sm font-semibold text-text-primary">自动截取的本人照片</p><p className="mt-1 text-xs leading-5 text-text-muted">该照片会直接复用于平台认证，不需要再次上传。</p><label className="mt-2 block text-xs font-semibold text-text-primary">更换照片<input aria-label="统一人物正面照片" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={event => selectPhoto(event.target.files?.[0])} className={`${field} mt-1 bg-white`} /></label></div></div>}{videoFile && videoVoiceReview}</section> : <label className="block text-sm">人物素材<input key={file ? 'selected' : 'empty'} aria-label="人物素材" type="file" accept=".jpg,.jpeg,.png,.mp4,.mov,.webm,image/jpeg,image/png,video/mp4,video/quicktime,video/webm" onChange={e => setFile(e.target.files?.[0])} className={field} /><span className="mt-1 block text-xs text-text-muted">{file ? `已选择：${file.name}。${file.type.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(file.name) ? '视频将创建 Digital Twin，并进入 HeyGen 官方本人授权。' : '照片将创建照片人物，由灵枢保存本人授权记录。'}` : '照片支持 JPG/PNG；Digital Twin 视频须为 30 秒至 5 分钟、至少 720p/24fps并包含清晰人声。'}</span></label>}
        {initialConfiguration && initialStage === 'person' ? <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3"><p className="text-xs leading-5 text-text-muted">本步骤只把资料安全保存到当前企业，不调用 HeyGen，也不产生供应商费用。</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={localStorageConfirmed} onChange={event => setLocalStorageConfirmed(event.target.checked)} />我已取得此人物的肖像及素材使用授权，同意由灵枢安全保存</label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={adultConfirmed} onChange={event => setAdultConfirmed(event.target.checked)} />我已核验画面主体为成年人</label></div> : <><p className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">提交后需要在 HeyGen 官方页面完成本人授权，再返回灵枢配置声音。</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={authorized} onChange={e => setAuthorized(e.target.checked)} />我已取得此人物的肖像及素材使用授权，同意将素材提交给 HeyGen，并由灵枢安全保存</label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={adultConfirmed} onChange={e => setAdultConfirmed(e.target.checked)} />我已核验画面主体为成年人</label>{cap?.privateCatalog && reusePresenterId && <div className="space-y-2 rounded-lg border border-emerald-200 p-3 text-sm"><label className="flex gap-2"><input type="checkbox" checked={reuseGroup} onChange={e => { setReuseGroup(e.target.checked); setSamePersonConfirmed(false); }} />沿用当前人物的 HeyGen 人物组授权</label>{reuseGroup && <label className="flex gap-2"><input type="checkbox" checked={samePersonConfirmed} onChange={e => setSamePersonConfirmed(e.target.checked)} />确认新增素材与当前已授权人物为同一人</label>}<p className="text-xs text-text-muted">若是另一位人物，取消沿用后创建独立人物组，由本人完成所需验证。</p></div>}<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />确认创建人物{Number(selectedReservationCny) > 0 ? `并接受供应商计费（本次安全预留上限 ¥${selectedReservationCny}，以实际账单为准）` : '；供应商费用需由管理员配置安全上限后才能提交'}</label></>}
        <div className="flex gap-2"><button type="button" disabled={busy || !name.trim() || (initialConfiguration ? !photoFile || !videoFile : !file) || (initialConfiguration && initialStage === 'person' ? !localStorageConfirmed || !adultConfirmed : !selectedCreationEnabled || !authorized || !adultConfirmed || !confirmed || Boolean(cap?.privateCatalog && reusePresenterId && reuseGroup && !samePersonConfirmed))} onClick={() => void create()} className={`${button} bg-gradient-to-r from-blue-600 to-violet-600 text-white`}>{busy ? (initialConfiguration && initialStage === 'person' ? '正在安全保存人物资料…' : submitStage === 'upload' ? '正在安全入库并复用人物资料…' : '正在创建人物任务…') : initialConfiguration && initialStage === 'person' ? '保存人物资料' : '提交资料并继续本人授权'}</button></div>
        <div ref={actionFeedback} tabIndex={-1} className="outline-none">
          {busy && <p role="status" className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">{initialConfiguration && initialStage === 'person' ? '正在将照片和视频安全保存到当前企业，不会调用外部供应商。' : submitStage === 'upload' ? (uploadPercent < 100 ? `第 1 步：上传至本地服务 ${uploadPercent}%` : (uploadStage === 'confirming_upload' ? '正在确认 HeyGen 素材登记，完成后创建人物。' : uploadStage === 'uploading_to_provider' ? '正在上传至 HeyGen；尚未提交人物创建，请等待结果。' : '素材已传到本地服务，正在检查并处理视频。')) : '第 2 步：正在创建人物；完成后将进入官方本人授权。'}</p>}
          {actionError && <div role="alert" className="space-y-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><strong className="block">本次提交未完成</strong><p>{actionError}</p><p className="text-xs">已填写内容会保留。请按提示处理后，在这里继续。</p></div>}
        </div>
        {!initialConfiguration && (!name.trim() || !file || !authorized || !adultConfirmed || !confirmed) && <p role="status" className="rounded-lg bg-surface-2 p-3 text-xs text-text-secondary">还需完成：{[!name.trim() && '填写人物名称', !file && '上传人物素材', !authorized && '确认肖像及素材授权', !adultConfirmed && '确认人物已成年', !confirmed && '确认创建人物'].filter(Boolean).join('、')}。</p>}
        {attempt.current && <p className="text-xs">如提交未返回结果，保持名称和文件不变后重试，将继续核对同一请求。</p>}
      </fieldset>}
      {initialConfiguration && tab === 'create' && wizardStep === 2 && <section aria-label="HeyGen 授权确认" className="space-y-3 rounded-xl border border-border p-4"><h3 className="font-semibold">人物资料已保存</h3><p className="text-sm text-text-secondary">下一步将前往 HeyGen 完成本人验证。此操作会离开灵枢；你可以先核对资料，稍后再继续。</p>{jobs.filter(job => ['pending_consent', 'processing', 'completed', 'uncertain', 'failed'].includes(job.status)).slice(0, 3).map(job => <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 p-3 text-sm"><span>{job.name} · {statusText(job)}</span><div className="flex flex-wrap items-center gap-2">{job.status === 'completed' && job.look ? <button type="button" disabled={busy} className={button} onClick={() => { setTab('import'); choose(job.look!, job); }}>继续配置声音</button> : job.status === 'pending_consent' && !job.consentRequestedAt ? <button type="button" disabled={busy} className={`${button} bg-gradient-to-r from-blue-600 to-violet-600 text-white`} onClick={() => beginOfficialConsent(job)}>确认前往 HeyGen</button> : <button type="button" disabled={busy} className={button} onClick={() => void run(async () => { updateJob(await presenterApi.refresh(job.id)); setError(''); setActionError(''); })}>{job.status === 'pending_consent' ? '刷新授权状态' : '刷新任务状态'}</button>}{['completed', 'failed'].includes(job.status) && (discardingCreationId === job.id ? <><button type="button" disabled={busy} className={`${button} border-red-200 text-red-700`} onClick={() => void discardCreation(job)}>确认删除</button><button type="button" disabled={busy} className={button} onClick={() => setDiscardingCreationId('')}>取消</button></> : <button type="button" disabled={busy} className={`${button} text-red-700`} onClick={() => setDiscardingCreationId(job.id)}>删除</button>)}</div></div>)}<button type="button" className={button} onClick={() => setWizardStep(1)}>返回查看素材</button></section>}
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
      {!initialConfiguration && <section ref={authorizationSection} className="scroll-mt-24 space-y-3 border-t border-border pt-4"><div className="flex items-center justify-between"><div><h3 className="font-bold">人物授权状态</h3><p className="mt-1 text-xs text-text-muted">照片人物保留本页的本人授权声明；视频数字分身还需由本人在 HeyGen 官方页面完成验证。验证通过后才能保存为企业默认人物。</p></div><button disabled={busy} className={button} onClick={() => void run(async () => { setJobs(await presenterApi.creations()); setActionError(''); })}>刷新状态</button></div>
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
          {job.consentUrl && <div className="rounded-lg bg-amber-50 p-3 text-sm"><button type="button" className="font-bold text-emerald-700 underline" onClick={() => beginOfficialConsent(job)}>前往 HeyGen 完成本人授权</button><span className="ml-2 text-xs text-amber-900">请由人物本人在 HeyGen 页面完成验证；完成后返回此处点击“刷新状态”。</span></div>}
        </div>)}
      </section>}
      {selected && tab === 'import' && (!initialConfiguration || wizardStep === 3) && <fieldset disabled={busy} className="space-y-3 rounded-xl border border-border bg-white p-4"><h3 className="font-bold">{voiceOnlyPresenter ? `为 ${selected.look.name} 录入本人声音` : `配置声音并保存 · ${selected.look.name}`}</h3>
        {selected.look.videoUrl ? <video aria-label="人物预览" controls src={selected.look.videoUrl} poster={selected.look.imageUrl} className="max-h-64 w-full rounded" /> : selected.look.imageUrl ? <img src={selected.look.imageUrl} alt={selected.look.name} className="max-h-64 w-full object-contain" /> : <p className="text-sm">供应商暂未提供预览，请稍后刷新。</p>}
        {selected.creationId && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{jobs.find(job => job.id === selected.creationId)?.type === 'photo' ? '照片人物已创建，本人使用授权声明已留档。现在配置声音。' : '人物官方授权已通过。现在配置声音，不会影响或重复提交人像任务。'}</p>}{voiceOnlyPresenter ? ownVoiceRecorder : selected.creationId ? ownCreationVoice : voicePicker}{!selected.creationId && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={authorized} onChange={event => setAuthorized(event.target.checked)} />{voiceOnlyPresenter ? '我已试听本人录音，并确认绑定到当前数字人用于企业真人口播' : catalogScope === 'private' ? '我已取得此人物肖像及对应声音用于本企业商业口播的授权，并已预览确认' : '我已预览人物与声音，并确认将其用于企业真人口播'}</label>}{catalogScope === 'private' && !selected.creationId && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={adultConfirmed} onChange={event => setAdultConfirmed(event.target.checked)} />我已核验此人物为成年人</label>}{initialConfiguration && <p className="text-xs text-text-muted">{voiceOnlyPresenter ? '保存后，这次录入会成为当前数字人的默认声音；已单独配置渠道音色的渠道继续沿用原设置。' : '保存后，所有后续真人口播都会默认使用此人物；首帧背景将从当前对标分镜素材中合成。'}</p>}<div ref={actionFeedback} tabIndex={-1} className="space-y-2 outline-none">{(busy || submitStage === 'voice_processing') && <p role="status" className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">{submitStage === 'voice_processing' ? '本人声音正在 HeyGen 处理中，完成后会自动保存。' : submitStage === 'voice' ? '正在录入本人声音…' : voiceOnlyPresenter ? '正在绑定本人声音…' : '正在保存默认人物…'}</p>}{actionError && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700"><strong className="block">声音配置未完成</strong><p>{actionError}</p></div>}</div><div className="flex gap-2"><button className={button} onClick={() => { if (voiceOnlyPresenter) { onClose(); return; } setSelected(undefined); if (initialConfiguration) { setWizardStep(1); setTab('choose'); } }}>{voiceOnlyPresenter ? '取消' : '上一步'}</button><button type="button" disabled={!authorized || (catalogScope === 'private' && !selected.creationId && !adultConfirmed) || !enrollmentVoiceReady || (!voiceOnlyPresenter && !(selected.look.imageUrl || selected.look.videoUrl)) || submitStage === 'voice_processing'} className={`${button} bg-gradient-to-r from-blue-600 to-violet-600 text-white`} onClick={() => { if (recordingState === 'recording' || recordingState === 'paused') { submitRecordingOnStop.current = true; finishRecording(); } else void saveSelected(); }}>{submitStage === 'voice_processing' ? '声音处理中，将自动保存…' : voiceOnlyPresenter ? '保存本人声音' : initialConfiguration ? '保存为默认口播人物' : '添加到企业'}</button></div>
      </fieldset>}
    </div>
  </dialog>;
}
