import { useEffect, useRef, useState } from 'react';
import { presenterApi } from '../../lib/presenterApi';
import type { PresenterCapabilities, PresenterCreation, PresenterLook, PresenterVoice } from '../../lib/presenterAssets';
import type { ProductionDefaults } from '../../lib/shotProduction';

const statusText = (job: PresenterCreation) => job.status === 'pending_consent'
  ? job.consentRequestedAt ? '授权入口已生成 · 待 HeyGen 确认' : '待发起本人授权'
  : ({ submitting: '正在提交', processing: '处理中', completed: '可用', failed: '处理失败', uncertain: '提交结果待核实' } as const)[job.status];
const field = 'w-full rounded-lg border border-border bg-white p-2 text-sm';
const button = 'rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40';
const heygenAvatarPage = 'https://app.heygen.com/avatars';
export default function PresenterManager({ onClose, onSaved, initialMode = 'quick' }: { onClose: () => void; onSaved: (value: ProductionDefaults) => void | Promise<void>; initialMode?: 'quick' | 'expert' }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'create' | 'import'>('create');
  const [cap, setCap] = useState<PresenterCapabilities>();
  const [jobs, setJobs] = useState<PresenterCreation[]>([]);
  const [looks, setLooks] = useState<PresenterLook[]>([]); const [lookToken, setLookToken] = useState('');
  const [voices, setVoices] = useState<PresenterVoice[]>([]); const [voiceToken, setVoiceToken] = useState('');
  const [name, setName] = useState(''); const [type, setType] = useState<'photo' | 'photo_from_video' | 'digital_twin'>(initialMode === 'expert' ? 'digital_twin' : 'photo');
  const creationMode = type === 'digital_twin' ? 'expert' : 'quick';
  const [file, setFile] = useState<File>(); const [voiceId, setVoiceId] = useState('');
  const [authorized, setAuthorized] = useState(false); const [confirmed, setConfirmed] = useState(false); const [reviewed, setReviewed] = useState(false);
  const [selected, setSelected] = useState<{ look: PresenterLook; creationId?: string }>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [catalogScope, setCatalogScope] = useState<'public' | 'private'>('public');
  const attempt = useRef<{ requestId: string; uploadRequestId: string; uploadId?: string; signature?: string } | undefined>(undefined);
  const inFlight = useRef(false);
  const updateJob = (job: PresenterCreation) => setJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
  const run = async (operation: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : '人物服务请求失败'); }
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
  useEffect(() => {
    const pending = jobs.filter(j => ['processing', 'pending_consent'].includes(j.status));
    if (!pending.length) return;
    let live = true;
    const timer = window.setTimeout(async () => {
      if (inFlight.current) { if (live) setJobs(current => [...current]); return; }
      const results = await Promise.allSettled(pending.map(job => presenterApi.refresh(job.id)));
      if (!live) return;
      const updated = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
      setJobs(current => current.map(job => updated.find(item => item.id === job.id) || job));
      if (results.some(r => r.status === 'rejected')) setError('人物状态刷新暂时失败，可点击“刷新状态”重试');
    }, 15000);
    return () => { live = false; window.clearTimeout(timer); };
  }, [jobs]);
  const loadCatalog = () => run(async () => {
    const result = await presenterApi.catalog(lookToken, catalogScope);
    setLooks(current => [...new Map([...current, ...result.items].map(look => [look.id, look])).values()]); setLookToken(result.nextToken);
  });
  const choose = (look: PresenterLook, job?: PresenterCreation) => {
    setSelected({ look, creationId: job?.id }); setVoiceId(job?.voiceId || look.voiceId || ''); setReviewed(false); setAuthorized(false);
  };
  const create = () => run(async () => {
    if (!file) throw new Error('请先选择人物素材');
    const signature = `${type}:${name.trim()}:${file.name}:${file.size}:${file.lastModified}`;
    if (attempt.current?.signature && attempt.current.signature !== signature) throw new Error('上次提交结果尚未核实，请先刷新任务列表');
    attempt.current ||= { requestId: crypto.randomUUID(), uploadRequestId: crypto.randomUUID(), signature };
    if (!attempt.current.uploadId) {
      try { attempt.current.uploadId = (await presenterApi.upload(file, attempt.current.uploadRequestId, undefined, type === 'photo_from_video' ? 1 : undefined, type === 'digital_twin')).id; }
      catch (e) { attempt.current = undefined; throw e; }
    }
    const job = await presenterApi.create({ name: name.trim(), type: type === 'photo_from_video' ? 'photo' : type, uploadId: attempt.current.uploadId, requestId: attempt.current.requestId, authorized, confirmed });
    updateJob(job); attempt.current = undefined; setFile(undefined); setConfirmed(false); setAuthorized(false);
    setNotice('人物任务已保存。训练和授权完成后，预览并添加到企业即可使用。');
  });
  const voice = voices.find(item => item.id === voiceId);
  const voicePicker = <div className="space-y-2"><label className="block text-sm">人物声音<select aria-label="人物声音" className={field} value={voiceId} onChange={e => setVoiceId(e.target.value)}>
    <option value="">请选择声音</option>{voiceId && !voices.some(v => v.id === voiceId) && <option value={voiceId}>人物原配声音</option>}
    {voices.map(v => <option key={v.id} value={v.id}>{v.name} · {v.language}</option>)}
  </select></label>{voice && !voice.previewUrl && <p className="text-xs text-text-muted">此声音暂未提供试听样本</p>}{voice?.previewUrl && <audio aria-label="声音试听" controls src={voice.previewUrl} className="h-10 w-full" />}
    {voiceToken && <button className={button} type="button" disabled={busy} onClick={() => void run(async () => { const result = await presenterApi.voices(voiceToken); setVoices(current => [...new Map([...current, ...result.items].map(v => [v.id, v])).values()]); setVoiceToken(result.nextToken); })}>加载更多声音</button>}</div>;
  return <dialog ref={dialog} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} aria-labelledby="presenter-manager-title" className="m-auto max-h-[90vh] w-[min(900px,94vw)] overflow-y-auto rounded-2xl border border-border bg-white p-0 text-text-primary shadow-xl backdrop:bg-black/35">
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-white p-5"><div><h2 id="presenter-manager-title" className="font-bold">企业人物资产</h2><p className="mt-1 text-xs text-text-muted">在这里创建、预览和选择企业出镜人物</p></div><button type="button" disabled={busy} onClick={onClose} className={button} aria-label="关闭人物管理">关闭</button></header>
    <div className="space-y-5 p-5">
      {cap?.reason && <p className="rounded-lg bg-amber-50 p-3 text-sm">{cap.reason}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm">{notice}</p>}
      <div className="flex gap-2"><button className={`${button} ${tab === 'create' ? 'bg-emerald-50 font-bold' : ''}`} disabled={busy} onClick={() => { setTab('create'); setSelected(undefined); setAuthorized(false); }}>创建企业人物</button><button className={`${button} ${tab === 'import' ? 'bg-emerald-50 font-bold' : ''}`} disabled={busy} onClick={() => { setTab('import'); if (!looks.length) void loadCatalog(); }}>导入已有人物</button></div>
      {tab === 'create' && <fieldset disabled={busy || !cap?.creationEnabled} className="space-y-4 disabled:opacity-60">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-1" aria-label="数字人创建模式">
          <button type="button" onClick={() => { if (creationMode !== 'quick') { setType('photo_from_video'); setFile(undefined); } }} className={`rounded-lg px-3 py-3 text-left text-sm ${creationMode === 'quick' ? 'bg-white font-bold shadow-sm' : ''}`}><span className="block">照片形象</span><span className="mt-1 block text-xs font-normal text-text-muted">上传照片或从视频抽帧，创建本人外观</span></button>
          <button type="button" onClick={() => { if (creationMode !== 'expert') { setType('digital_twin'); setFile(undefined); } }} className={`rounded-lg px-3 py-3 text-left text-sm ${creationMode === 'expert' ? 'bg-white font-bold shadow-sm' : ''}`}><span className="block">视频分身（专家）</span><span className="mt-1 block text-xs font-normal text-text-muted">完整真人视频训练，保留表情与动作习惯</span></button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">人物名称<input aria-label="人物名称" className={field} value={name} maxLength={100} onChange={e => setName(e.target.value)} placeholder="例如：品牌主理人、销售顾问" /></label>
          {creationMode === 'quick' ? <label className="text-sm">快速创建来源<select aria-label="创建方式" value={type} onChange={e => {
            const nextType = e.target.value as typeof type;
            const usesVideo = (value: typeof type) => value === 'photo_from_video' || value === 'digital_twin';
            if (!(usesVideo(type) && usesVideo(nextType))) setFile(undefined);
            setType(nextType);
          }} className={field}><option value="photo">上传本人照片</option><option value="photo_from_video">从本人视频提取照片</option></select></label> : <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm"><strong>Digital Twin 真人动作人物</strong><span className="mt-1 block text-xs text-text-muted">训练完成后可使用专家表演与动作控制</span></div>}</div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-xs leading-5 text-emerald-900">{type === 'photo'
          ? '照片人物：上传一张单人正面照片。人物面部应占画面主要区域，眼睛和嘴部清晰，避免遮挡、模糊和过暗。声音在人物创建完成、添加到企业时选择。'
          : type === 'photo_from_video' ? '低成本本人形象：从视频第 1 秒提取清晰正面帧，按照片人物创建。保留本人外观，但不会学习原视频中的动作；声音在创建完成后选择。'
          : '真人动作人物：人物训练必须使用完整、连续、无剪辑的正面说话视频，不能用 7 秒测试片段代替。建议 1080p、30fps、光线均匀、环境安静且面部无遮挡。创建后还需由同一人物完成 HeyGen 本人授权。'}</div>
        {creationMode === 'expert' && <div className="grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 sm:grid-cols-2"><span>✓ 30 秒至 5 分钟连续录制</span><span>✓ 至少 720p、24fps</span><span>✓ 本人清晰说话音轨</span><span>✓ 无剪辑、无遮挡、均匀光线</span><span className="sm:col-span-2">提交前系统自动检查时长、画幅、帧率和音轨；推荐使用约 2 分钟的 1080p、30fps 素材。</span></div>}
        <label className="block text-sm">{type === 'photo' ? '清晰的单人正面照片' : type === 'photo_from_video' ? '包含本人清晰正脸的视频' : '单人正面连续口播视频'}<input key={type + (file ? 'selected' : 'empty')} aria-label="人物素材" type="file" accept={type === 'photo' ? '.jpg,.jpeg,.png,image/jpeg,image/png' : '.mp4,.mov,.webm,video/mp4,video/quicktime,video/webm'} onChange={e => setFile(e.target.files?.[0])} className={field} /><span className="mt-1 block text-xs text-text-muted">{file ? `已选择：${file.name} · ` : ''}单个文件不超过 200MB。{type === 'photo' ? '支持 JPG、PNG。' : type === 'photo_from_video' ? '支持 MP4、MOV、WebM；系统只提取第 1 秒画面作为本人照片。' : '支持 MP4、MOV、WebM；训练视频必须包含本人清晰说话音频并保持完整。人物创建成功后，单条口播测试再限制为 7 秒以内。'}</span></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={authorized} onChange={e => setAuthorized(e.target.checked)} />我已取得此人物的肖像及素材使用授权，同意将素材提交给 HeyGen 处理</label>
        <p className="text-xs text-text-muted">{type === 'digital_twin' ? `创建后按提示完成本人授权。授权视频必须由素材中的同一人物录制，逐字朗读当次授权文字并控制在 30 秒内。${cap?.directConsent ? '可直接提交本人录制的授权视频。' : '本人验证将在官方授权页完成，返回后可在这里继续查看进度。'}` : '照片人物通过供应商校验后即可预览；添加到企业时再选择声音。'}</p>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />确认创建人物并接受供应商计费{(type !== 'digital_twin' ? cap?.photoReservationCny ?? cap?.reservationCny : cap?.digitalTwinReservationCny ?? cap?.reservationCny) != null ? `（本次预算预留 ¥${type !== 'digital_twin' ? cap?.photoReservationCny ?? cap?.reservationCny : cap?.digitalTwinReservationCny ?? cap?.reservationCny}，实际费用以供应商账单为准）` : ''}</label>
        <button type="button" disabled={!name.trim() || !file || !authorized || !confirmed} onClick={() => void create()} className={`${button} bg-emerald-700 text-white`}>{busy ? '正在提交，请稍候…' : '创建人物'}</button>
        {attempt.current && <p className="text-xs">如提交未返回结果，保持名称和文件不变后重试，将继续核对同一请求。</p>}
      </fieldset>}
      {tab === 'import' && <div className="space-y-3"><p className="text-xs text-text-muted">选择公共人物，或从下方“本企业创建任务”添加已完成的人物。已绑定的人物继续显示在企业出镜设置中。</p>
        {cap?.privateCatalog && <label className="block text-sm">人物来源<select className={field} value={catalogScope} disabled={busy} onChange={e => { const scope = e.target.value as 'public' | 'private'; setCatalogScope(scope); setSelected(undefined); void run(async () => { const result = await presenterApi.catalog('', scope); setLooks(result.items); setLookToken(result.nextToken); }); }}><option value="public">公共人物库</option><option value="private">企业账号已有的人物</option></select></label>}
        <input aria-label="筛选人物" placeholder="按名称筛选已加载人物" value={search} onChange={e => setSearch(e.target.value)} className={field} />
        <div className="grid max-h-80 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-4">{looks.filter(look => look.name.toLowerCase().includes(search.toLowerCase())).map(look => <button type="button" disabled={busy || look.status !== 'completed'} key={look.id} onClick={() => choose(look)} className={`overflow-hidden rounded-lg border p-2 text-left text-xs ${selected?.look.id === look.id ? 'border-emerald-600 bg-emerald-50' : 'border-border'}`}>
          {look.imageUrl && <img src={look.imageUrl} alt={look.name} loading="lazy" className="mb-2 h-28 w-full rounded object-contain" />}<span>{look.name}</span></button>)}</div>
        <button className={button} type="button" disabled={busy} onClick={() => void loadCatalog()}>{lookToken ? '加载更多人物' : '刷新人物列表'}</button>
      </div>}
      <section className="space-y-3 border-t border-border pt-4"><div className="flex items-center justify-between"><h3 className="font-bold">本企业创建任务</h3><button disabled={busy} className={button} onClick={() => void run(async () => setJobs(await presenterApi.creations()))}>刷新列表</button></div>
        {!jobs.length && <p className="text-sm text-text-muted">暂无创建任务。提交后进度会保存在这里，关闭页面也不会丢失。</p>}
        {jobs.map(job => <div key={job.id} className="space-y-2 rounded-lg border border-border p-3"><div className="flex flex-wrap items-center gap-3">{job.look?.imageUrl && <img alt={job.name} src={job.look.imageUrl} className="h-14 w-14 rounded object-contain" />}<strong className="text-sm">{job.name}</strong><span className="text-xs">{statusText(job)}</span>
          <button disabled={busy} className={button} onClick={() => void run(async () => updateJob(await presenterApi.refresh(job.id)))}>刷新状态</button>
          {job.status === 'completed' && job.look && <button disabled={busy} className={button} onClick={() => { setTab('import'); choose(job.look!, job); }}>预览并添加</button>}
          {job.status === 'pending_consent' && !job.consentUrl && <button disabled={busy} className={button} onClick={() => void run(async () => updateJob(await presenterApi.consent(job.id, crypto.randomUUID())))}>获取本人授权入口</button>}
        </div>{job.error && <p className="text-xs text-amber-700">{job.error}</p>}
          {job.type === 'digital_twin' && job.groupId && <p className="break-all text-xs text-text-muted">绑定的 HeyGen 人物组：{job.groupId}</p>}
          {job.status === 'pending_consent' && <div className="grid gap-2 rounded-lg bg-surface-2 p-3 text-xs sm:grid-cols-2"><div className="rounded-lg border border-emerald-200 bg-white p-3"><strong className="text-emerald-800">✓ 第 1 步：专家训练视频已完成</strong><p className="mt-1 text-text-muted">人物外观、动作与表情训练素材已经保存，无需重复上传。</p></div><div className="rounded-lg border border-amber-200 bg-white p-3"><strong className="text-amber-800">第 2 步：本人授权待确认</strong><p className="mt-1 text-text-muted">这是 HeyGen 要求的独立短授权视频，不是专家训练视频。</p></div></div>}
          {job.status === 'pending_consent' && cap?.directConsent && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm"><p className="font-medium text-emerald-950">在灵枢内提交短授权视频，并直接绑定上方 HeyGen 人物组。</p><p className="mt-1 text-xs text-emerald-900">不会替换已上传的专家训练视频。授权未完成时仍可继续编写脚本、匹配素材和设置镜头；授权通过后再选择该专家人物生成。</p><div className="mt-3 flex flex-wrap gap-2"><label className={`${button} inline-flex cursor-pointer bg-emerald-700 text-white`}><span>{busy ? '正在提交授权视频…' : '选择短授权视频并提交'}</span><input disabled={busy} aria-label={`${job.name}授权视频`} className="sr-only" type="file" accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm" onChange={e => { const consent = e.target.files?.[0]; e.target.value = ''; if (consent) void run(async () => { const upload = await presenterApi.upload(consent, crypto.randomUUID()); updateJob(await presenterApi.consent(job.id, crypto.randomUUID(), upload.id)); setNotice('本人授权视频已绑定当前人物组并提交 HeyGen 审核，无需重复创建人物。'); }); }} /></label><a className={`${button} inline-flex items-center bg-white text-emerald-800`} href={heygenAvatarPage} target="_blank" rel="noopener noreferrer">前往 HeyGen 查看人物与授权</a><button type="button" disabled={busy} className={button} onClick={onClose}>先返回继续创作</button></div><p className="mt-2 text-xs text-text-muted">当前先跳转 HeyGen 人物资产页；具体授权落地页后续接入后可替换链接。</p></div>}
          {job.consentUrl && !cap?.directConsent && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p className="font-medium text-amber-950">此入口只用于验证上方绑定的人物组，不会替换灵枢已上传的训练视频。</p><p className="mt-1 text-xs text-amber-900">如果 HeyGen 页面要求“新建虚拟形象”或进入账号新手引导，请不要继续创建；返回灵枢刷新状态。已录制且未显示失败原因时无需重复录制。</p><p className="mt-2"><a className="text-emerald-700 underline" href={job.consentUrl} target="_blank" rel="noopener noreferrer">打开 HeyGen 本人授权</a><span className="ml-2 text-xs text-text-muted">链接有效期 24 小时；完成后等待 HeyGen 审核并刷新状态。</span></p></div>}
        </div>)}
      </section>
      {selected && tab === 'import' && <fieldset disabled={busy} className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/30 p-4"><h3 className="font-bold">确认人物 · {selected.look.name}</h3>
        {selected.look.videoUrl ? <video aria-label="人物预览" controls src={selected.look.videoUrl} poster={selected.look.imageUrl} className="max-h-64 w-full rounded" /> : selected.look.imageUrl ? <img src={selected.look.imageUrl} alt={selected.look.name} className="max-h-64 w-full object-contain" /> : <p className="text-sm">供应商暂未提供预览，请稍后刷新。</p>}
        {voicePicker}<label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />已预览并确认使用此人物</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={authorized} onChange={e => setAuthorized(e.target.checked)} />已确认人物和声音使用授权</label>
        <button type="button" disabled={!reviewed || !authorized || !voiceId || !(selected.look.imageUrl || selected.look.videoUrl)} className={`${button} bg-emerald-700 text-white`} onClick={() => void run(async () => { const value = await presenterApi.import({ lookId: selected.look.id, creationId: selected.creationId, voiceId, authorized, reviewed }); await onSaved(value); setNotice('人物已添加到企业，镜头编辑也可以直接选择。'); setSelected(undefined); })}>添加到企业</button>
      </fieldset>}
    </div>
  </dialog>;
}
