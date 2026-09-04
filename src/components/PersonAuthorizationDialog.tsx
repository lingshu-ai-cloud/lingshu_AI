import {useEffect, useRef, useState} from 'react';
import {studioApi, type Material} from '../lib/studioApi';
import type {PersonOnboardingCapability} from '../lib/personConsentPolicy';

export default function PersonAuthorizationDialog({asset, onClose, onComplete}: {
  asset: Material; onClose: () => void; onComplete: (state: string) => void;
}) {
  const [capability, setCapability] = useState<PersonOnboardingCapability>();
  const [confirmed, setConfirmed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [openingCamera, setOpeningCamera] = useState(false);
  const [video, setVideo] = useState<Blob>();
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const live = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | undefined>(undefined);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const stopCamera = () => {
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = undefined;
    if (live.current) live.current.srcObject = null;
  };
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    void studioApi.personOnboarding().then(value => {if (alive.current) setCapability(value);});
    return () => {
      alive.current = false;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stopCamera();
    };
  }, []);
  useEffect(() => {
    if (!video) {setPreview(''); return;}
    const url = URL.createObjectURL(video); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [video]);
  async function startRecording() {
    if (!capability?.available || busy || openingCamera || recording) return;
    setError(''); setVideo(undefined); setOpeningCamera(true);
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('当前浏览器不支持站内录制。请在HTTPS页面或本地预览打开，也可上传本人录制的授权视频。');
      }
      const captured = await navigator.mediaDevices.getUserMedia({audio: true, video: {facingMode: 'user', width: {ideal: 720}, height: {ideal: 1280}}});
      if (!alive.current) {captured.getTracks().forEach(track => track.stop()); return;}
      stream.current = captured;
      if (live.current) {live.current.srcObject = captured; void live.current.play().catch(() => {});}
      const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('当前浏览器录制格式不兼容，请上传MP4或WebM授权视频。');
      const rec = new MediaRecorder(captured, {mimeType, videoBitsPerSecond: 900_000, audioBitsPerSecond: 96_000});
      recorder.current = rec;
      const chunks: Blob[] = []; let totalBytes = 0; let oversized = false; let failed = false;
      rec.ondataavailable = event => {
        if (!event.data.size) return;
        totalBytes += event.data.size;
        if (totalBytes > capability.maxVideoBytes) {
          oversized = true;
          if (rec.state === 'recording') rec.stop();
          return;
        }
        chunks.push(event.data);
      };
      rec.onerror = () => {failed = true; stopCamera(); if (alive.current) {setRecording(false); setError('录制中断，请检查摄像头和麦克风后重录。');}};
      rec.onstop = () => {
        stopCamera();
        if (!alive.current) return;
        setRecording(false);
        if (failed) return;
        if (oversized) {setError('录制超过20MB，请缩短后重新录制。'); return;}
        const blob = new Blob(chunks, {type: mimeType.split(';')[0]});
        if (blob.size) setVideo(blob);
      };
      rec.start(1000); setRecording(true);
      timer.current = setTimeout(() => {if (rec.state === 'recording') rec.stop();}, 60_000);
    } catch (cause) {
      stopCamera();
      if (alive.current) setError(cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? '摄像头或麦克风权限被拒绝。请在浏览器中允许后重试，或上传本人录制的视频。'
        : cause instanceof Error ? cause.message : '无法开启摄像头');
    } finally {if (alive.current) setOpeningCamera(false);}
  }
  function chooseFile(file?: File) {
    if (!file || !capability?.available) return;
    setError('');
    if (!['video/mp4', 'video/webm'].includes(file.type) || !file.size || file.size > capability.maxVideoBytes) {
      setError('请选择20MB以内的MP4或WebM授权视频。'); return;
    }
    setVideo(file);
  }
  async function submit() {
    if (!video || !confirmed || !capability?.available || busy || recording) return;
    setBusy(true); setError('');
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onerror = () => reject(new Error('无法读取授权视频'));
        reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.readAsDataURL(video);
      });
      const result = await studioApi.submitPersonInApp(asset.id, {dataBase64, mimeType: video.type.split(';')[0], version: capability.consentVersion, subjectConfirmed: true, processingConfirmed: true});
      if (!alive.current) return;
      if (!result.ok) {setError(result.error || '提交未完成，请先刷新人物状态'); return;}
      if (!['consent_review', 'training', 'ready'].includes(result.state || '')) {
        setError('人物尚未进入准备队列，请先刷新状态；不会自动重交或跳转站外。'); onComplete(result.state || 'consent_required'); return;
      }
      setSubmitted(true); setVideo(undefined); onComplete(result.state!);
    } catch (cause) {if (alive.current) setError(cause instanceof Error ? cause.message : '提交未完成，请先刷新状态');}
    finally {if (alive.current) setBusy(false);}
  }
  return <dialog ref={dialog} aria-labelledby="person-authorization-title" onCancel={event => {event.preventDefault(); if (!busy) onClose();}}
    className="fixed inset-0 m-auto max-h-[90vh] w-[min(94vw,680px)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-800 shadow-2xl backdrop:bg-black/40">
    <div className="flex items-center justify-between gap-3"><h2 id="person-authorization-title" className="text-lg font-bold">创建企业人物 · {asset.name}</h2><button type="button" disabled={busy} onClick={onClose} aria-label="关闭本人授权" className="rounded px-3 py-1 disabled:opacity-40">关闭</button></div>
    <ol className="my-4 flex flex-wrap gap-3 text-sm" aria-label="人物创建步骤"><li>✓ 1 上传真人母片</li><li className={submitted ? '' : 'font-bold text-emerald-700'}>2 本人授权</li><li className={submitted ? 'font-bold text-emerald-700' : ''}>3 人物准备</li></ol>
    {submitted ? <div role="status" className="rounded-xl bg-emerald-50 p-5"><h3 className="font-bold">已提交人物准备</h3><p className="mt-2 text-sm">后台将完成授权审核和人物准备。你可以关闭此窗口继续创作，准备完成后会显示「可生成口播」。</p><button onClick={onClose} className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-white">完成</button></div> : <>
      {!capability && <p role="status">正在检查站内验证服务…</p>}
      {capability && !capability.available && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{capability.reason}</p>}
      {capability && <><h3 className="mt-4 font-semibold">请本人阅读授权说明</h3><p className="mt-2 text-sm leading-6">{capability.notice}</p>
        <h3 className="mt-4 font-semibold">录制时请清晰读出</h3><p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm leading-6">{capability.statement}</p></>}
      <video ref={live} muted playsInline className={recording || openingCamera ? 'mt-4 max-h-64 w-full rounded-lg bg-black' : 'hidden'} />
      {preview && <video src={preview} controls playsInline className="mt-4 max-h-64 w-full rounded-lg bg-black" aria-label="授权视频预览" />}
      <div className="mt-4 flex flex-wrap gap-3">
        {recording ? <button onClick={() => recorder.current?.stop()} className="rounded-lg bg-red-600 px-4 py-2 text-white">结束录制</button>
          : <button disabled={!capability?.available || busy || openingCamera} onClick={() => void startRecording()} className="rounded-lg border px-4 py-2 disabled:opacity-40">{openingCamera ? '正在开启摄像头…' : video ? '重新录制' : '开启摄像头录制'}</button>}
        <label className="rounded-lg border px-4 py-2 text-sm">上传本人授权视频<input type="file" accept="video/mp4,video/webm" disabled={!capability?.available || busy || recording || openingCamera} className="mt-1 block max-w-full text-xs" onChange={event => {chooseFile(event.target.files?.[0]); event.target.value = '';}} /></label>
      </div>
      <p className="mt-2 text-xs text-slate-500">建议20–40秒，站内录制最多60秒；上传视频3–120秒、20MB以内。关闭窗口会停止摄像头并清除未提交的录制内容。</p>
      <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} className="mt-1" /><span>我就是母片和授权视频中的本人，已阅读上述说明，同意创建数字形象、授权所述使用范围，并同意将视频交由受托服务处理。</span></label>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button disabled={!capability?.available || !video || !confirmed || busy || recording || openingCamera} onClick={() => void submit()} className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-3 font-bold text-white disabled:opacity-40">{busy ? '正在提交，请勿重复点击…' : '提交并准备人物'}</button>
    </>}
  </dialog>;
}
