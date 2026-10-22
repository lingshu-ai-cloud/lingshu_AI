import { useEffect, useRef, useState, type ReactNode } from 'react';
import { authHeader, getToken, AUTH_TOKEN_CHANGED_EVENT } from '../../lib/auth';
import { canExplicitlySubmitReferenceAsr, referenceAsrAvailabilityLabel, canRefreshExistingReferenceAsr, existingReferenceAsrRefreshBody } from '../../lib/referenceAsrSubmission';
import { directorReviewAction } from './inspirationAnalysisProjection';

export interface DirectorReviewHandoff {
  status: 'review_only' | 'production_ready';
  directorHandoffReady?: boolean;
  selectedHookShotId?: string | null;
  shots: Array<{ shotId: string; startSeconds: number; endSeconds: number; content: string; purpose: string; issues: string[]; evidence: { clipRef?: string | null; firstFrameRef?: string | null; extractionStatus?: string } }>;
  issues: Array<{ code: string; shotId?: string | null; evidenceRefs?: string[]; action: string }>;
  productionExecutionAllowed: boolean;
}

const hookScriptLabels = { camera: '运镜', visual: '画面', subject: '出镜主体', music: '配乐', voiceover: '配音', soundEffects: '音效', spokenWords: '主体话术', subjectAction: '主体动作' } as const;
type HookScriptKey = keyof typeof hookScriptLabels;
const hookScriptKeys = Object.keys(hookScriptLabels) as HookScriptKey[];

interface DirectorShotReview {
  referenceRecordId: string;
  sourceAnalysisRunId: string | null;
  version: string;
  sections: Array<{ sectionId: string; title: string; start: number; end: number; purpose: string; confirmed: boolean }>;
  shots: Array<{ shotId: string; start: number; end: number; content: string; purpose: string; sourceShotIds: string[]; reviewStatus: 'candidate' | 'confirmed' | 'discarded'; mixedScene: boolean; labels: string[]; evidenceRefs: string[]; hookAction: string; hookMotionConfirmed: boolean; hookScript?: Record<HookScriptKey, string>; hookScriptConfirmed?: boolean }>;
  selectedHookShotId: string | null;
  reviewComplete: boolean;
  productionExecutionAllowed: false;
}

interface DirectorVerifiedSpeech {
  analysisRunId: string | null;
  sourceSha256: string | null;
  duration: number;
  status: string;
  coverageConfirmed: boolean;
  lines: Array<{ text: string; start: number; end: number; visibility: 'on_camera' | 'voiceover' | 'unknown'; speakerId?: string | null }>;
}

interface DirectorPhraseAsrJob {
  ok: boolean;
  status: 'not_found' | 'unavailable' | 'needs_confirmation' | 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'uncertain' | 'submitting';
  taskId?: string;
  existingTaskId?: string | null;
  enabled: boolean;
  canSubmit?: boolean;
  submissionGap?: string | null;
  budgetReason?: string;
  reservationCny?: number | null;
  remainingCny?: number | null;
  candidateLines: Array<{ text: string; start: number; end: number; precision: 'phrase'; provenance: string; visibility: 'unknown' }>;
}

interface DirectorSpeechTimeline {
  lines: Array<{ speechId: string; text: string; start: number; end: number; sectionIds: string[]; shotIds: string[]; visibility: string; timingPrecision: 'coarse' | 'phrase'; needsReview: boolean }>;
  coarseWindows: Array<{ speechId: string; text: string; start: number; end: number; sectionIds: string[] }>;
  sections: Array<{ sectionId: string; speechIds: string[]; coarseEvidenceIds: string[] }>;
  reviewQuestions: string[];
  productionReady: boolean;
}

const reviewSeconds = (value: number) => `${Number.isFinite(value) ? value.toFixed(2) : '—'}s`;

export function splitDirectorReviewedShot(review: DirectorShotReview, shotId: string, cut: number): DirectorShotReview {
  const current = review.shots.find(item => item.shotId === shotId);
  if (!current || !Number.isFinite(cut) || cut - current.start < 0.15 || current.end - cut < 0.15) throw new Error('invalid_review_cut');
  const left = { ...current, end: cut, reviewStatus: 'candidate' as const, mixedScene: false, evidenceRefs: [], hookMotionConfirmed: false, hookScriptConfirmed: false };
  const right = { ...current, shotId: `review-${Date.now()}`, start: cut, reviewStatus: 'candidate' as const, mixedScene: false, evidenceRefs: [], hookAction: '', hookMotionConfirmed: false, hookScript: undefined, hookScriptConfirmed: false };
  return { ...review, shots: review.shots.flatMap(item => item.shotId === shotId ? [left, right] : [item]), selectedHookShotId: review.selectedHookShotId === shotId ? null : review.selectedHookShotId };
}

export function reviseDirectorHookAction(review: DirectorShotReview, shotId: string, hookAction: string): DirectorShotReview {
  return { ...review, shots: review.shots.map(item => item.shotId === shotId ? { ...item, hookAction, hookMotionConfirmed: false } : item) };
}

export function asrCandidatesToReviewDraft(speech: DirectorVerifiedSpeech, candidates: DirectorPhraseAsrJob['candidateLines']): DirectorVerifiedSpeech {
  return { ...speech, coverageConfirmed: false, status: 'partial_review', lines: candidates.map(line => ({ text: line.text, start: line.start, end: line.end, visibility: 'unknown' })) };
}

export default function DirectorReviewWorkspace({ recordId, onPreview, handoff, renderVideo, renderImage }: { recordId: string; onPreview: () => void; handoff: DirectorReviewHandoff | null; renderVideo: (url: string) => ReactNode; renderImage: (url: string, alt: string) => ReactNode }) {
  const [review, setReview] = useState<DirectorShotReview | null>(null);
  const [speech, setSpeech] = useState<DirectorVerifiedSpeech | null>(null);
  const [timeline, setTimeline] = useState<DirectorSpeechTimeline | null>(null);
  const [savedReview, setSavedReview] = useState('');
  const [previewShotId, setPreviewShotId] = useState<string | null>(null);
  const [asrJob, setAsrJob] = useState<DirectorPhraseAsrJob | null>(null);
  const [asrConsent, setAsrConsent] = useState(false);
  const [asrBusy, setAsrBusy] = useState(false);
  const [asrPolling, setAsrPolling] = useState(false);
  const [activeSection, setActiveSection] = useState(0);
  const [showCandidates, setShowCandidates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const identity = useRef({recordId,token:getToken(),active:true});
  useEffect(()=>{const session={recordId,token:getToken(),active:true};identity.current=session;const changed=()=>{session.active=false;setReview(null);setSpeech(null);setAsrPolling(false);setMessage('登录身份已变化，请从原周任务重新打开审核。');};window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.addEventListener('storage',changed);return()=>{session.active=false;window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.removeEventListener('storage',changed);};},[recordId]);
  const current=()=>identity.current.active&&identity.current.recordId===recordId&&!!identity.current.token&&getToken()===identity.current.token;
  const checkedFetch=async(url:string,init?:RequestInit)=>{const session=identity.current;if(!current())throw Error('reference_review_login_changed');const response=await fetch(url,{...init,headers:{...init?.headers,Authorization:`Bearer ${session.token}`}});if(identity.current!==session||!current())throw Error('reference_review_login_changed');return response;};
  const refresh = async () => {
    const [reviewResponse, speechResponse] = await Promise.all([
      checkedFetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/shot-review`, { headers: authHeader() }),
      checkedFetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/verified-speech`, { headers: authHeader() }),
    ]);
    if (!reviewResponse.ok) throw new Error('镜头审核记录读取失败');
    if (!speechResponse.ok) throw new Error('逐句口播记录读取失败');
    const nextReview = await reviewResponse.json() as DirectorShotReview;
    const nextSpeech = await speechResponse.json() as DirectorVerifiedSpeech;
    if(!current()||nextReview.referenceRecordId!==recordId)throw Error('原参考身份变化');
    setReview(nextReview);
    setSavedReview(JSON.stringify([nextReview.sections, nextReview.shots, nextReview.selectedHookShotId]));
    setSpeech(nextSpeech);
    return { nextReview, nextSpeech };
  };
  const loadTimeline = async (nextReview: DirectorShotReview) => {
    const response = await checkedFetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/speech-timeline`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ sections: nextReview.sections.map(section => ({ sectionId: section.sectionId, title: section.title, start: section.start, end: section.end, purpose: section.purpose })) }),
    });
    if (!response.ok) throw new Error('口播与六段结构映射失败');
    const next=await response.json() as DirectorSpeechTimeline;if(current())setTimeline(next);
  };
  const readPhraseAsr = async (confirmed: boolean, refreshExisting = false) => {
    if(!current() || (confirmed && !canExplicitlySubmitReferenceAsr(asrJob,asrConsent,asrBusy)))return;
    if(refreshExisting && !canRefreshExistingReferenceAsr(asrJob,asrBusy))return;
    setAsrBusy(true);
    try {
      const response = await checkedFetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/phrase-asr`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(refreshExisting && asrJob ? existingReferenceAsrRefreshBody(asrJob) : { confirmed }),
      });
      const result = await response.json() as DirectorPhraseAsrJob & { error?: string };
      if(!current())return;
      if (!response.ok) throw new Error(result.error || `句级 ASR 请求失败（HTTP ${response.status}）`);
      setAsrJob(result);
      setAsrPolling(result.status === 'PENDING' || result.status === 'RUNNING' || result.status === 'submitting');
      if (result.status === 'SUCCEEDED') setMessage('句级 ASR 候选已返回；请听原片逐句校对，并确认画内或画外音。');
      else if (result.status === 'FAILED' || result.status === 'uncertain') setMessage('句级 ASR 任务需要人工排查，不会自动重复付费提交。');
    } catch (error) { if(!current())return;setAsrPolling(false); setMessage(error instanceof Error ? error.message : '句级 ASR 请求失败'); }
    finally { if(current())setAsrBusy(false); }
  };
  useEffect(() => {
    let active = true;
    void refresh().then(({ nextReview }) => { if (active && current()) void loadTimeline(nextReview).catch(error => setMessage(String(error))); })
      .catch(error => { if (active && current()) setMessage(error instanceof Error ? error.message : '复核记录读取失败'); });
    // No automatic ASR or polling; false must remain a server-side read only command.
    return () => { active = false; };
  }, [recordId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveReview = async () => {
    if (!review) return;
    setBusy(true); setMessage('');
    try {
      const response = await checkedFetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/shot-review`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ expectedVersion: review.version, sections: review.sections, shots: review.shots, selectedHookShotId: review.selectedHookShotId }),
      });
      const result = await response.json();
      if(!current())return;
      if (!response.ok) throw new Error(result.error || '保存镜头审核失败');
      setReview(result as DirectorShotReview);
      setSavedReview(JSON.stringify([(result as DirectorShotReview).sections, (result as DirectorShotReview).shots, (result as DirectorShotReview).selectedHookShotId]));
      await loadTimeline(result as DirectorShotReview);
      setMessage('六段结构与镜头审核已保存；仍需完成所有质量门槛才可交接制作。');
    } catch (error) { if(!current())return;setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { if(current())setBusy(false); }
  };
  const saveSpeech = async () => {
    if (!speech || !review) return;
    if (speech.lines.some(line => line.visibility === 'unknown')) { setMessage('请逐句确认画内口播或画外音，再保存人工校时。'); return; }
    setBusy(true); setMessage('');
    try {
      const response = await checkedFetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/verified-speech`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ analysisRunId: speech.analysisRunId, sourceSha256: speech.sourceSha256, lines: speech.lines, coverageConfirmed: speech.coverageConfirmed }),
      });
      const result = await response.json();
      if(!current())return;
      if (!response.ok) throw new Error(result.error || '保存逐句口播失败');
      setSpeech(result as DirectorVerifiedSpeech);
      await loadTimeline(review);
      setMessage('逐句口播已保存，请核对六段归属与画内／画外音。');
    } catch (error) { if(!current())return;setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { if(current())setBusy(false); }
  };
  if (!review || !speech) return <section className="mb-4 rounded-lg border border-border bg-white p-4 text-xs text-text-muted" aria-label="六段结构编导复核">{message || '正在读取六段结构、镜头和口播证据…'}</section>;
  const changeSectionBoundary = (index: number, edge: 'start' | 'end', value: number) => {
    setReview({ ...review, sections: review.sections.map((item, position) => {
      if (position === index) return { ...item, [edge]: value, confirmed: false };
      if (edge === 'start' && position === index - 1) return { ...item, end: value, confirmed: false };
      if (edge === 'end' && position === index + 1) return { ...item, start: value, confirmed: false };
      return item;
    }) });
  };
  const splitShot = (shotId: string) => {
    const current = review.shots.find(item => item.shotId === shotId);
    if (!current || current.end - current.start < 0.30) { setMessage('镜头短于 0.30 秒，无法拆成两个至少 0.15 秒的镜头。'); return; }
    const proposed = window.prompt(`在 ${reviewSeconds(current.start)}–${reviewSeconds(current.end)} 之间输入切点秒数`, String(Number(((current.start + current.end) / 2).toFixed(2))));
    if (proposed === null) return;
    const cut = Number(proposed);
    if (!Number.isFinite(cut) || cut - current.start < 0.15 || current.end - cut < 0.15) { setMessage('切点无效；切分后每段至少 0.15 秒。'); return; }
    setReview(splitDirectorReviewedShot(review, shotId, cut));
    setMessage('已拆成两个候选镜头；请重新核对内容、目的、首帧和钩子。');
  };
  const materializeShot = async (shotId: string) => {
    if (JSON.stringify([review.sections, review.shots, review.selectedHookShotId]) !== savedReview) { setMessage('请先保存镜头范围，再重新抽取切片和首帧。'); return; }
    setBusy(true); setMessage('正在从原片重新抽取分镜切片和首帧…');
    try {
      const response = await checkedFetch(`/api/overseas/videos/${encodeURIComponent(recordId)}/shot-review/${encodeURIComponent(shotId)}/materialize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ expectedVersion: review.version }),
      });
      const result = await response.json();
      if(!current())return;
      if (!response.ok) throw new Error(result.error || '重新抽取镜头素材失败');
      const next = result as DirectorShotReview;
      setReview(next);
      setSavedReview(JSON.stringify([next.sections, next.shots, next.selectedHookShotId]));
      setMessage(`${shotId} 的切片与真实首帧已按复核后的时间范围重新抽取。`);
    } catch (error) { if(!current())return;setMessage(error instanceof Error ? error.message : '重新抽取失败'); }
    finally { if(current())setBusy(false); }
  };
  const section = review.sections[activeSection] || review.sections[0];
  const sectionShots = section ? review.shots.filter(shot => shot.reviewStatus !== 'discarded' && shot.start < section.end && shot.end > section.start) : [];
  const sectionLines = section ? (timeline?.lines || []).filter(line => line.sectionIds.includes(section.sectionId)) : [];
  const sectionCoarse = section ? (timeline?.coarseWindows || []).filter(line => line.sectionIds.includes(section.sectionId)) : [];
  return <section aria-label="六段结构编导复核" className="mb-4 rounded-lg border border-border bg-white p-4 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold text-text-primary">六段内容结构与逐句口播</h3><p className="mt-1 text-text-muted">先确认叙事段，再复核分镜和原声逐句时间码。粗 ASR 可提供逐句大致时间码，界面会明确标记为估计；可按需人工修正。</p></div><span className={`rounded px-2 py-1 font-bold ${review.reviewComplete && timeline?.productionReady ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{review.reviewComplete && timeline?.productionReady ? '待最终交接门槛' : '编导复核中'}</span></div>
    <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 leading-5 text-amber-900"><strong>内容 Agent 制作门槛</strong><p>年限、功效、交期等经营事实暂不作为交接门槛；原片宣称保留待核验标记。逐镜、口播、开场动作和企业“销售”人物资产仍须满足制作证据要求。</p><ul className="mt-1 list-inside list-disc">{['hook_action_unverified', 'presenter_asset_unlocked'].filter(code => handoff?.issues.some(issue => issue.code === code)).map(code => <li key={code}>{directorReviewAction(code).gap}：{directorReviewAction(code).next}</li>)}</ul><p className="mt-1 font-semibold">当前制作状态：{handoff?.productionExecutionAllowed ? '已通过后端交接门槛' : '待补齐制作证据'}</p></div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{review.sections.map((item, index) => <button key={item.sectionId} type="button" onClick={() => setActiveSection(index)} className={`rounded-lg border px-2 py-2 text-left ${activeSection === index ? 'border-accent bg-accent-glow text-accent' : 'border-border text-text-secondary'}`}><strong className="block">{index + 1}. {item.title}</strong><span className="mt-1 block text-[10px]">{reviewSeconds(item.start)}–{reviewSeconds(item.end)} · {item.confirmed ? '已确认' : '待确认'}</span></button>)}</div>
    {section && <div className="mt-4 rounded-lg border border-border p-3"><div className="grid gap-2 sm:grid-cols-[1fr_80px_80px]"><label className="font-semibold">结构段名称<input aria-label="结构段名称" className="mt-1 w-full rounded border border-border px-2 py-1" value={section.title} onChange={event => setReview({ ...review, sections: review.sections.map((item, index) => index === activeSection ? { ...item, title: event.target.value, confirmed: false } : item) })} /></label><label>开始秒<input aria-label="结构段开始秒" disabled={activeSection === 0} type="number" step="0.01" className="mt-1 w-full rounded border border-border px-2 py-1" value={section.start} onChange={event => changeSectionBoundary(activeSection, 'start', Number(event.target.value))} /></label><label>结束秒<input aria-label="结构段结束秒" disabled={activeSection === review.sections.length - 1} type="number" step="0.01" className="mt-1 w-full rounded border border-border px-2 py-1" value={section.end} onChange={event => changeSectionBoundary(activeSection, 'end', Number(event.target.value))} /></label></div><label className="mt-2 block">表达目的<input aria-label="结构段表达目的" className="mt-1 w-full rounded border border-border px-2 py-1" value={section.purpose} onChange={event => setReview({ ...review, sections: review.sections.map((item, index) => index === activeSection ? { ...item, purpose: event.target.value, confirmed: false } : item) })} /></label><label className="mt-2 inline-flex items-center gap-2 font-semibold"><input type="checkbox" checked={section.confirmed} onChange={event => setReview({ ...review, sections: review.sections.map((item, index) => index === activeSection ? { ...item, confirmed: event.target.checked } : item) })} />已对照原片确认本段边界与内容</label></div>}
    <div className="mt-4"><div className="flex items-center justify-between"><h4 className="font-black">本段分镜</h4><button type="button" onClick={() => setShowCandidates(!showCandidates)} className="text-accent underline">{showCandidates ? '收起候选切点' : `展开 ${sectionShots.length} 个候选切点`}</button></div>{showCandidates && <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">{sectionShots.map(shot => <div key={shot.shotId} className="rounded-lg border border-border p-2"><div className="flex flex-wrap items-center gap-2"><strong>{shot.shotId} · {reviewSeconds(shot.start)}–{reviewSeconds(shot.end)}</strong><select aria-label={`${shot.shotId} 复核状态`} value={shot.reviewStatus} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, reviewStatus: event.target.value as typeof item.reviewStatus } : item) })} className="ml-auto rounded border border-border px-1 py-0.5"><option value="candidate">待复核</option><option value="confirmed">已确认</option><option value="discarded">废弃</option></select></div><div className="mt-2 grid gap-2 sm:grid-cols-[72px_72px_1fr]"><input aria-label={`${shot.shotId} 开始秒`} type="number" step="0.01" value={shot.start} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, start: Number(event.target.value), hookMotionConfirmed: false, evidenceRefs: [] } : item) })} className="w-full rounded border border-border px-1 py-1" /><input aria-label={`${shot.shotId} 结束秒`} type="number" step="0.01" value={shot.end} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, end: Number(event.target.value), hookMotionConfirmed: false, evidenceRefs: [] } : item) })} className="w-full rounded border border-border px-1 py-1" /><input aria-label={`${shot.shotId} 内容`} value={shot.content} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, content: event.target.value } : item) })} className="w-full rounded border border-border px-2 py-1" /></div><input aria-label={`${shot.shotId} 表达目的`} value={shot.purpose} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, purpose: event.target.value } : item) })} className="mt-2 w-full rounded border border-border px-2 py-1" /><input aria-label={`${shot.shotId} 素材类型标签`} placeholder="素材类型标签，逗号分隔，如真人口播、工厂实拍" value={shot.labels.join(",")} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, labels: event.target.value.split(/[,，]/).map(label => label.trim()).filter(Boolean) } : item) })} className="mt-2 w-full rounded border border-border px-2 py-1" /><div className="mt-2 flex flex-wrap gap-2 text-[10px]"><label><input type="checkbox" checked={shot.mixedScene} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, mixedScene: event.target.checked } : item) })} /> 混镜待拆</label><button type="button" onClick={() => splitShot(shot.shotId)} className="text-accent underline">按秒数拆分</button><label><input type="radio" name="selectedHookShotId" disabled={shot.start >= 1 || shot.end <= 0 || shot.end - shot.start < 0.2} checked={review.selectedHookShotId === shot.shotId} onChange={() => setReview({ ...review, selectedHookShotId: shot.shotId, shots: review.shots.map(item => ({ ...item, hookMotionConfirmed: false })) })} /> 开场钩子</label><button type="button" disabled={busy || JSON.stringify([review.sections, review.shots, review.selectedHookShotId]) !== savedReview} onClick={() => void materializeShot(shot.shotId)} className="text-accent underline disabled:opacity-40">重新抽取切片和首帧</button>{shot.evidenceRefs.length > 0 && <button type="button" onClick={() => setPreviewShotId(previewShotId === shot.shotId ? null : shot.shotId)} className="text-accent underline">{previewShotId === shot.shotId ? '收起证据' : '查看证据'}</button>}</div>{review.selectedHookShotId === shot.shotId && <div className="mt-2 rounded bg-sky-50 p-2"><label className="block font-semibold">开场钩子动作脚本（至少 20 字）<textarea aria-label="开场钩子动作脚本" className="mt-1 w-full rounded border border-border px-2 py-1" rows={3} value={shot.hookAction} onChange={event => setReview(reviseDirectorHookAction(review, shot.shotId, event.target.value))} placeholder="按首帧、第一秒、动作峰值、手势轨迹、声音进入点、转场描述" /></label><label className="mt-1 inline-flex items-center gap-1"><input type="checkbox" checked={shot.hookMotionConfirmed} disabled={shot.hookAction.trim().length < 20} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, hookMotionConfirmed: event.target.checked } : item) })} />已逐帧核对钩子动作与原片一致</label><div className="mt-2 grid gap-2 sm:grid-cols-2">{hookScriptKeys.map(key => <label key={key} className="text-xs">{hookScriptLabels[key]}<input aria-label={`开场钩子${hookScriptLabels[key]}`} value={shot.hookScript?.[key] || ''} placeholder="请按原片填写；确实没有填“无”" onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, hookScript: { camera: '', visual: '', subject: '', music: '', voiceover: '', soundEffects: '', spokenWords: '', subjectAction: '', ...item.hookScript, [key]: event.target.value }, hookScriptConfirmed: false } : item) })} className="mt-1 w-full rounded border border-border px-2 py-1" /></label>)}</div><label className="mt-2 inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={shot.hookScriptConfirmed === true} disabled={hookScriptKeys.some(key => !shot.hookScript?.[key]?.trim())} onChange={event => setReview({ ...review, shots: review.shots.map(item => item.shotId === shot.shotId ? { ...item, hookScriptConfirmed: event.target.checked } : item) })} />已逐项对照原片确认八项钩子脚本</label></div>}{previewShotId === shot.shotId && <div className="mt-2 grid gap-2 sm:grid-cols-2">{shot.evidenceRefs.filter(ref => ref.includes('/clip')).map(ref => renderVideo(ref))}{shot.evidenceRefs.filter(ref => ref.includes('first-frame')).map(ref => renderImage(ref, `${shot.shotId} 原片首帧`))}</div>}</div>)}</div>}</div>
    <div className="mt-4 border-t border-border pt-3"><h4 className="font-black">本段口播 · {sectionLines.length} 句已定位</h4>{sectionLines.length ? <ul className="mt-2 space-y-1">{sectionLines.map(line => <li key={line.speechId} className="rounded bg-emerald-50 px-2 py-1">{reviewSeconds(line.start)}–{reviewSeconds(line.end)} · {line.text} <span className="text-text-muted">{line.timingPrecision === 'coarse' ? '估计时间码' : '人工校时'} · {line.visibility === 'voiceover' ? '画外音' : line.visibility === 'on_camera' ? '画内口播' : '声音来源待判'} · {line.shotIds.join('、')}</span></li>)}</ul> : <p className="mt-1 text-amber-800">尚无可用的逐句口播。</p>}{sectionCoarse.length > 0 && <details className="mt-2 rounded bg-amber-50 p-2"><summary className="cursor-pointer font-semibold">{sectionCoarse.length} 条粗 ASR 估计口播时间窗</summary><ul className="mt-2 space-y-1">{sectionCoarse.map(item => <li key={item.speechId}>{reviewSeconds(item.start)}–{reviewSeconds(item.end)} · {item.text}</li>)}</ul></details>}</div>
    <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3"><h4 className="font-black">获取句级时间码候选</h4><p className="mt-1 leading-5 text-text-secondary">该操作调用千问句级 ASR，可能产生供应商费用。候选仍须逐句听原片、核对起止秒数及画内／画外音；不会自动确认为编导交接物。</p><p className="mt-1 text-text-muted">服务状态：{referenceAsrAvailabilityLabel(asrJob)}{asrJob?.budgetReason ? ` · ${asrJob.budgetReason}` : ''} · 预留：{asrJob?.reservationCny == null ? '未知' : `¥${asrJob.reservationCny}`} · 剩余预算：{asrJob?.remainingCny == null ? '未知' : `¥${asrJob.remainingCny}`}</p><label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={asrConsent} onChange={event => setAsrConsent(event.target.checked)} disabled={asrJob?.canSubmit!==true || asrBusy} />我确认启动可能计费的句级 ASR 分析</label><div className="mt-2 flex gap-2"><button type="button" disabled={!canExplicitlySubmitReferenceAsr(asrJob,asrConsent,asrBusy)} onClick={() => void readPhraseAsr(true)} className="rounded bg-accent px-2 py-1 font-bold text-white disabled:opacity-40">{asrBusy ? '处理中…' : '获取句级时间码'}</button><button type="button" disabled={asrBusy} onClick={() => void readPhraseAsr(false)} className="rounded border border-border px-2 py-1">查询已有候选（只读）</button>{canRefreshExistingReferenceAsr(asrJob,false) && <button type="button" disabled={!canRefreshExistingReferenceAsr(asrJob,asrBusy)} onClick={()=>void readPhraseAsr(false,true)} className="rounded border border-border px-2 py-1">查询原识别任务</button>}{asrJob && (asrJob.status==='uncertain'||(['PENDING','RUNNING','submitting'].includes(asrJob.status)&&!asrJob.existingTaskId)) && <span>供应商状态不确定，请人工核对原回执；不会重新提交。</span>}</div>{asrJob?.candidateLines?.length ? <div className="mt-3"><p className="font-semibold">{asrJob.candidateLines.length} 条机器候选（未核对）</p><div className="mt-2 max-h-48 space-y-1 overflow-y-auto">{asrJob.candidateLines.map((line, index) => <p key={`${line.start}-${index}`} className="rounded bg-white px-2 py-1">{reviewSeconds(line.start)}–{reviewSeconds(line.end)} · {line.text}</p>)}</div><button type="button" onClick={() => setSpeech(asrCandidatesToReviewDraft(speech, asrJob.candidateLines))} className="mt-2 text-accent underline">载入人工校对草稿（不会保存或确认）</button></div> : null}</div>
    <div className="mt-4 border-t border-border pt-3"><h4 className="font-black">可选：逐句口播人工修正</h4><p className="mt-1 text-text-muted">粗 ASR 的大致时间码已可用于交接；如发现错字、漏句或错位，可听原片修正并保存。</p><button type="button" onClick={onPreview} className="mt-1 text-accent underline">播放原片核对</button><div className="mt-2 max-h-64 space-y-2 overflow-y-auto">{speech.lines.map((line, index) => <div key={index} className="grid gap-1 sm:grid-cols-[70px_70px_1fr_90px_24px]"><input aria-label={`第 ${index + 1} 句开始秒`} type="number" step="0.01" value={line.start} onChange={event => setSpeech({ ...speech, coverageConfirmed: false, lines: speech.lines.map((item, i) => i === index ? { ...item, start: Number(event.target.value) } : item) })} className="rounded border border-border px-1" /><input aria-label={`第 ${index + 1} 句结束秒`} type="number" step="0.01" value={line.end} onChange={event => setSpeech({ ...speech, coverageConfirmed: false, lines: speech.lines.map((item, i) => i === index ? { ...item, end: Number(event.target.value) } : item) })} className="rounded border border-border px-1" /><input aria-label={`第 ${index + 1} 句原文`} value={line.text} onChange={event => setSpeech({ ...speech, coverageConfirmed: false, lines: speech.lines.map((item, i) => i === index ? { ...item, text: event.target.value } : item) })} className="rounded border border-border px-2" /><select aria-label={`第 ${index + 1} 句画内或画外`} value={line.visibility} onChange={event => setSpeech({ ...speech, coverageConfirmed: false, lines: speech.lines.map((item, i) => i === index ? { ...item, visibility: event.target.value as typeof item.visibility } : item) })} className="rounded border border-border px-1"><option value="unknown">待判断</option><option value="on_camera">画内</option><option value="voiceover">画外</option></select><button type="button" aria-label={`删除第 ${index + 1} 句`} onClick={() => setSpeech({ ...speech, coverageConfirmed: false, lines: speech.lines.filter((_, i) => i !== index) })}>×</button></div>)}</div><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => setSpeech({ ...speech, coverageConfirmed: false, lines: [...speech.lines, { text: '', start: 0, end: 0, visibility: 'unknown' }] })} className="rounded border border-border px-2 py-1">添加一句</button><label className="inline-flex items-center gap-1"><input type="checkbox" checked={speech.coverageConfirmed} onChange={event => setSpeech({ ...speech, coverageConfirmed: event.target.checked })} />已听完整片并确认无漏句</label><button type="button" disabled={busy} onClick={() => void saveSpeech()} className="rounded bg-accent px-2 py-1 font-bold text-white disabled:opacity-50">保存逐句校时</button></div></div>
    <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" disabled={busy} onClick={() => void saveReview()} className="rounded bg-accent px-3 py-2 font-bold text-white disabled:opacity-50">保存六段与镜头复核</button><span className="text-text-muted">{review.shots.filter(shot => shot.reviewStatus === 'candidate').length} 个候选镜头待复核 · {timeline?.coarseWindows.length || 0} 个粗 ASR 窗口</span></div>{message && <p role="status" className="mt-2 text-amber-800">{message}</p>}{timeline?.reviewQuestions.length ? <details className="mt-3"><summary className="cursor-pointer font-semibold">交接前还需处理 {timeline.reviewQuestions.length} 项</summary><ul className="mt-1 list-inside list-disc space-y-1 text-amber-800">{timeline.reviewQuestions.map((item, index) => <li key={index}>{item}</li>)}</ul></details> : null}
  </section>;
}
