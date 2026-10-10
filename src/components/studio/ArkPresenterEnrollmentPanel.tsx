import { useEffect, useState } from 'react';
import { productionApi } from '../../lib/productionApi';

type Enrollment = Awaited<ReturnType<typeof productionApi.refreshArkEnrollment>>;
export default function ArkPresenterEnrollmentPanel(props: {
  presenterId: string;
  onStarted?: (presenterId: string) => void;
  photos: Array<{ id: string; name: string }>;
  videos: Array<{ id: string; name: string }>;
  onStart: (input: { name: string; photo?: File; video?: File; photoMaterialId?: string; videoMaterialId?: string; requestId: string }) => Promise<Enrollment>;
  onReady: () => Promise<void>;
}) {
  const [photo, setPhoto] = useState<File>(); const [video, setVideo] = useState<File>();
  const [photoMaterialId, setPhotoMaterialId] = useState(''); const [videoMaterialId, setVideoMaterialId] = useState('');
  const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [capability, setCapability] = useState<{ ready: boolean; reason: string }>();
  const [error, setError] = useState(''); const [enrollment, setEnrollment] = useState<Enrollment>();
  useEffect(() => { let live = true; productionApi.arkEnrollmentCapabilities().then(value => { if (live) setCapability(value); }).catch(cause => { if (live) setCapability({ ready: false, reason: cause instanceof Error ? cause.message : '认证服务暂时不可用' }); }); return () => { live = false; }; }, []);
  useEffect(() => {
    let live = true;
    setEnrollment(undefined); setError(''); setPhoto(undefined); setVideo(undefined); setPhotoMaterialId(''); setVideoMaterialId(''); setConsent(false);
    if (props.presenterId) productionApi.arkEnrollments(props.presenterId).then(items => { if (live) setEnrollment(items[0]); }).catch(() => {});
    return () => { live = false; };
  }, [props.presenterId]);
  useEffect(() => {
    if (!enrollment || !['needs_verification', 'processing'].includes(enrollment.state)) return;
    let live = true;
    const poll = async () => {
      try {
        const next = await productionApi.refreshArkEnrollment(enrollment.id);
        if (!live) return;
        setEnrollment(next);
        if (next.state === 'ready') await props.onReady();
      } catch (cause) { if (live) setError(cause instanceof Error ? cause.message : '认证状态查询失败'); }
    };
    const interval = window.setInterval(() => void poll(), 5000);
    return () => { live = false; window.clearInterval(interval); };
  }, [enrollment?.id, enrollment?.state, props.onReady]);
  const start = async () => {
    setBusy(true); setError('');
    try {
      const next = await props.onStart({ name, photo, video, photoMaterialId: photo ? undefined : photoMaterialId, videoMaterialId: video ? undefined : videoMaterialId, requestId: crypto.randomUUID() });
      setEnrollment(next);
      props.onStarted?.(next.presenterId);
      if (next.state === 'ready') await props.onReady();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '人物认证提交失败'); }
    finally { setBusy(false); }
  };
  return <section aria-label="人物认证与方舟图片入库" className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
    <p className="font-bold">人物照片认证 · {enrollment?.state === 'ready' ? '可用于 Seedance' : enrollment?.state === 'processing' ? '方舟审核中' : enrollment?.state === 'needs_verification' ? '等待本人验证' : '待提交'}</p>
    <p>首次使用请上传本人视频和清晰正面照片，确认授权后在灵枢打开一次本人验证。方舟图片资产由系统自动创建和绑定；已有素材可直接选择。</p>
    {capability && !capability.ready && <p role="status" className="rounded bg-white p-2 text-amber-800">当前暂不能开始认证：{capability.reason}</p>}
    {!enrollment || enrollment.state === 'failed' ? <div className="space-y-2">
      {!props.presenterId && <label className="block">人物名称<input aria-label="认证人物名称" value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>}
      <label className="block">本人视频<input aria-label="人物认证视频" type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={event => { setVideo(event.target.files?.[0]); setVideoMaterialId(''); }} className="mt-1 block w-full" /></label>
      {!!props.videos.length && <select aria-label="选择已有本人人物视频" value={videoMaterialId} onChange={event => { setVideoMaterialId(event.target.value); setVideo(undefined); }} className="w-full rounded border p-2"><option value="">或选择已上传视频</option>{props.videos.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      <label className="block">清晰正面照片<input aria-label="人物认证照片" type="file" accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic" onChange={event => { setPhoto(event.target.files?.[0]); setPhotoMaterialId(''); }} className="mt-1 block w-full" /></label>
      {!!props.photos.length && <select aria-label="选择已有本人人物照片" value={photoMaterialId} onChange={event => { setPhotoMaterialId(event.target.value); setPhoto(undefined); }} className="w-full rounded border p-2"><option value="">或选择已上传照片</option>{props.photos.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />我确认出镜人为成年人，已取得本人同意：由方舟进行真人验证、处理照片并用于数字人制作</label>
      <button type="button" disabled={busy || capability?.ready !== true || !consent || (!props.presenterId && !name.trim()) || !(photo || photoMaterialId) || !(video || videoMaterialId)} onClick={() => void start()} className="rounded bg-accent px-3 py-2 font-bold text-white disabled:opacity-40">{busy ? '正在提交…' : '提交人物资料并开始认证'}</button>
    </div> : null}
    {enrollment?.state === 'needs_verification' && <a href={enrollment.verificationUrl} target="_blank" rel="noreferrer" className="inline-block rounded bg-accent px-3 py-2 font-bold text-white">打开本人验证</a>}
    {enrollment?.state === 'processing' && <p role="status">本人验证已完成，正在等待方舟图片审核；完成后会自动用于当前人物。</p>}
    {enrollment?.state === 'uncertain' && <div className="space-y-2"><p role="alert">方舟上传结果尚不明确。系统已暂停再次提交，请先核对原任务。</p><button type="button" onClick={() => void productionApi.refreshArkEnrollment(enrollment.id).then(next => { setEnrollment(next); if (next.state === 'ready') void props.onReady(); }).catch(cause => setError(cause instanceof Error ? cause.message : '原任务核对失败'))} className="rounded border bg-white px-3 py-2">核对原方舟任务</button></div>}
    {(enrollment?.error || error) && <p role="alert" className="text-red-700">{enrollment?.error || error}</p>}
  </section>;
}
