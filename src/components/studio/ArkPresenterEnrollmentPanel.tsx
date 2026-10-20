import { useEffect, useState } from 'react';
import { Alert, Modal } from 'antd';
import { productionApi } from '../../lib/productionApi';

type Enrollment = Awaited<ReturnType<typeof productionApi.refreshArkEnrollment>>;
type ArkEnrollmentCapability = Awaited<ReturnType<typeof productionApi.arkEnrollmentCapabilities>>;
export default function ArkPresenterEnrollmentPanel(props: {
  presenterId: string;
  onStarted?: (presenterId: string) => void;
  photos: Array<{ id: string; name: string }>;
  videos: Array<{ id: string; name: string }>;
  initialPhotoMaterialId?: string;
  initialVideoMaterialId?: string;
  authorizationConfirmed?: boolean;
  onStart: (input: { name: string; photo?: File; video?: File; photoMaterialId?: string; videoMaterialId?: string; requestId: string }) => Promise<Enrollment>;
  onReady: () => Promise<void>;
}) {
  const optionalError = (message: string) => /active subscription|subscribe to an advanced|premium plan/i.test(message)
    ? '当前方舟套餐不支持人物认证。该能力为可选增强，不影响 HeyGen 数字人口播；升级方舟套餐后可再配置。'
    : message;
  const [photo, setPhoto] = useState<File>(); const [video, setVideo] = useState<File>();
  const [photoMaterialId, setPhotoMaterialId] = useState(props.initialPhotoMaterialId || ''); const [videoMaterialId, setVideoMaterialId] = useState(props.initialVideoMaterialId || '');
  const [consent, setConsent] = useState(props.authorizationConfirmed === true); const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [capability, setCapability] = useState<ArkEnrollmentCapability>();
  const [error, setError] = useState(''); const [enrollment, setEnrollment] = useState<Enrollment>();
  const [verifyConfirmOpen, setVerifyConfirmOpen] = useState(false);
  useEffect(() => { let live = true; productionApi.arkEnrollmentCapabilities().then(value => { if (live) setCapability(value); }).catch(cause => { if (live) setCapability({ ready: false, reason: cause instanceof Error ? cause.message : '认证服务暂时不可用', missing: [] }); }); return () => { live = false; }; }, []);
  useEffect(() => {
    let live = true;
    setEnrollment(undefined); setError(''); setPhoto(undefined); setVideo(undefined); setPhotoMaterialId(props.initialPhotoMaterialId || ''); setVideoMaterialId(props.initialVideoMaterialId || ''); setConsent(props.authorizationConfirmed === true);
    if (props.presenterId) productionApi.arkEnrollments(props.presenterId).then(items => { if (live) setEnrollment(items[0]); }).catch(() => {});
    return () => { live = false; };
  }, [props.presenterId, props.initialPhotoMaterialId, props.initialVideoMaterialId, props.authorizationConfirmed]);
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
    } catch (cause) { setError(optionalError(cause instanceof Error ? cause.message : '人物认证提交失败')); }
    finally { setBusy(false); }
  };
  const reusedMaterials = Boolean(!photo && !video
    && props.initialPhotoMaterialId && props.initialVideoMaterialId
    && photoMaterialId === props.initialPhotoMaterialId && videoMaterialId === props.initialVideoMaterialId);
  if (!capability) return <section aria-label="人物认证与方舟图片入库" className="rounded-lg border border-border bg-white p-4">
    <p className="text-sm font-semibold text-text-primary">方舟人物认证（可选增强）</p>
    <p role="status" className="mt-2 text-xs text-text-muted">正在检查方舟认证能力…</p>
  </section>;
  if (!capability.ready) {
    const missingLabels = capability.missing.map(item => ({
      provider_credentials: '方舟服务',
      public_asset_delivery: '公网 HTTPS 素材存储',
      verification_return_url: 'HTTPS 验证回跳地址',
    }[item]));
    return <section aria-label="人物认证与方舟图片入库" className="rounded-lg border border-border bg-white p-4">
      <p className="text-sm font-semibold text-text-primary">方舟人物认证（可选增强）</p>
      <Alert
        className="mt-3"
        type="warning"
        showIcon
        title="方舟认证暂不可用"
        description={<span>不影响 HeyGen 数字人口播，可稍后再配置。{missingLabels.length ? `启用方舟人物替换前还需配置：${missingLabels.join('、')}。` : '管理员完成方舟服务配置后即可使用人物替换增强能力。'}</span>}
      />
    </section>;
  }
  return <section aria-label="人物认证与方舟图片入库" className="space-y-2 rounded-lg border border-border bg-white p-4 text-xs">
    <p className="font-bold">人物替换认证 · {enrollment?.state === 'ready' ? '可用于 Seedance' : enrollment?.state === 'processing' ? '方舟图片审核中' : enrollment?.state === 'needs_verification' ? '等待本人验证' : enrollment?.state === 'uncertain' ? '提交结果待核对' : enrollment?.state === 'failed' ? '认证未完成' : '待提交'}</p>
    <ol className="list-inside list-decimal space-y-1 text-text-secondary" aria-label="方舟人物认证步骤">
      <li>上传或复用当前人物的正面照片和本人视频，并确认成年人及人物处理授权。</li>
      <li>打开方舟页面，由出镜本人完成真人验证；此步需要离开灵枢。</li>
      <li>返回企业知识库，等待系统查询验证结果、提交照片并核验方舟图片资产达到 Active。</li>
    </ol>
    <p>{reusedMaterials ? '已复用统一接入时上传的照片和本人视频，不需要再次录入。' : '仅旧人物缺少认证资料时需要在这里补充一次照片和本人视频。'}</p>
    {!enrollment || enrollment.state === 'failed' ? <div className="space-y-2">
      {!props.presenterId && <label className="block">人物名称<input aria-label="认证人物名称" value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>}
      {!reusedMaterials && <><label className="block">本人视频<input aria-label="人物认证视频" type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={event => { setVideo(event.target.files?.[0]); setVideoMaterialId(''); }} className="mt-1 block w-full" /></label>
        {!!props.videos.length && <select aria-label="选择已有本人人物视频" value={videoMaterialId} onChange={event => { setVideoMaterialId(event.target.value); setVideo(undefined); }} className="w-full rounded border p-2"><option value="">或选择已上传视频</option>{props.videos.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
        <label className="block">清晰正面照片<input aria-label="人物认证照片" type="file" accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic" onChange={event => { setPhoto(event.target.files?.[0]); setPhotoMaterialId(''); }} className="mt-1 block w-full" /></label>
        {!!props.photos.length && <select aria-label="选择已有本人人物照片" value={photoMaterialId} onChange={event => { setPhotoMaterialId(event.target.value); setPhoto(undefined); }} className="w-full rounded border p-2"><option value="">或选择已上传照片</option>{props.photos.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}</>}
      {props.authorizationConfirmed ? <p className="rounded bg-white p-2 text-emerald-800">成年人及人物处理授权已在统一接入时确认。</p> : <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />我确认出镜人为成年人，已取得本人同意：由方舟进行真人验证、处理照片并用于数字人制作</label>}
      <button type="button" disabled={busy || !consent || (!props.presenterId && !name.trim()) || !(photo || photoMaterialId) || !(video || videoMaterialId)} onClick={() => void start()} className="rounded bg-accent px-3 py-2 font-bold text-white disabled:opacity-40">{busy ? '正在提交…' : reusedMaterials ? '开始人物认证' : '提交人物资料并开始认证'}</button>
    </div> : null}
    {enrollment?.state === 'needs_verification' && <><button type="button" onClick={() => setVerifyConfirmOpen(true)} className="inline-block rounded bg-accent px-3 py-2 font-bold text-white">前往方舟本人验证</button><Modal open={verifyConfirmOpen} onCancel={() => setVerifyConfirmOpen(false)} title="确认前往方舟完成人物验证？" footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setVerifyConfirmOpen(false)} className="rounded border px-3 py-2">暂不跳转</button><a href={enrollment.verificationUrl} target="_blank" rel="noopener noreferrer" onClick={() => setVerifyConfirmOpen(false)} className="rounded bg-accent px-3 py-2 font-bold text-white">确认前往方舟</a></div>}><p>即将离开灵枢，前往方舟完成出镜本人验证。完成后请返回此页，系统会继续刷新认证状态。</p></Modal></>}
    {enrollment?.state === 'processing' && <p role="status">本人验证已完成，正在等待方舟图片审核；完成后会自动用于当前人物。</p>}
    {enrollment?.state === 'uncertain' && <div className="space-y-2"><p role="alert">方舟上传结果尚不明确。系统已暂停再次提交，请先核对原任务。</p><button type="button" onClick={() => void productionApi.refreshArkEnrollment(enrollment.id).then(next => { setEnrollment(next); if (next.state === 'ready') void props.onReady(); }).catch(cause => setError(cause instanceof Error ? cause.message : '原任务核对失败'))} className="rounded border bg-white px-3 py-2">核对原方舟任务</button></div>}
    {(enrollment?.error || error) && <Alert type="warning" showIcon title="方舟可选认证未完成" description={optionalError(enrollment?.error || error)} />}
  </section>;
}
