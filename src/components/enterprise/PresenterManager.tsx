import { useEffect, useRef, useState } from 'react';
import { presenterApi } from '../../lib/presenterApi';
import type { PresenterCapabilities, PresenterCreation, PresenterLook, PresenterVoice } from '../../lib/presenterAssets';
import type { ProductionDefaults } from '../../lib/shotProduction';

const statusText = (job: PresenterCreation) => job.status === 'pending_consent'
  ? job.consentRequestedAt ? '授权入口已生成 · 待 HeyGen 确认' : '待发起本人授权'
  : ({ submitting: '正在提交', processing: '处理中', completed: '可用', failed: '处理失败', uncertain: '提交结果待核实' } as const)[job.status];
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
export default function PresenterManager({ onClose, onSaved, onSynced, initialMode = 'quick', fixedMode = false, reusePresenterId, initialConfiguration = false }: { onClose: () => void; onSaved: (value: ProductionDefaults) => void | Promise<void>; onSynced?: (value: ProductionDefaults) => void | Promise<void>; initialMode?: 'quick' | 'expert'; fixedMode?: boolean; reusePresenterId?: string; initialConfiguration?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'create' | 'import'>(initialConfiguration ? 'import' : 'create');
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [cap, setCap] = useState<PresenterCapabilities>();
  const [jobs, setJobs] = useState<PresenterCreation[]>([]);
  const [looks, setLooks] = useState<PresenterLook[]>([]); const [lookToken, setLookToken] = useState('');
  const [voices, setVoices] = useState<PresenterVoice[]>([]); const [voiceToken, setVoiceToken] = useState('');
  const [voiceScope, setVoiceScope] = useState<'public' | 'private'>('public');
  const [name, setName] = useState(''); const [type, setType] = useState<'photo' | 'photo_from_video' | 'digital_twin'>(initialMode === 'expert' ? 'digital_twin' : 'photo');
  const creationMode = type === 'digital_twin' ? 'expert' : 'quick';
  const selectedCreationEnabled = creationMode === 'expert' ? (cap?.digitalTwinCreationEnabled ?? cap?.creationEnabled) : (cap?.photoCreationEnabled ?? cap?.creationEnabled);
  const selectedCreationReason = creationMode === 'expert' ? cap?.digitalTwinCreationReason : cap?.photoCreationReason;
  const [file, setFile] = useState<File>(); const [voiceId, setVoiceId] = useState('');
  const [authorized, setAuthorized] = useState(false); const [adultConfirmed, setAdultConfirmed] = useState(false); const [confirmed, setConfirmed] = useState(false);
  const [reuseGroup, setReuseGroup] = useState(true);
  const [samePersonConfirmed, setSamePersonConfirmed] = useState(false);
  const [selected, setSelected] = useState<{ look: PresenterLook; creationId?: string }>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [expandedGroupId, setExpandedGroupId] = useState('');
  const [catalogScope, setCatalogScope] = useState<'public' | 'private'>('public');
  const [favoritesSynced, setFavoritesSynced] = useState(false);
  const favoriteSyncStarted = useRef(false);
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
  useEffect(() => { if (initialConfiguration && !looks.length && !inFlight.current) void loadCatalog(); }, [initialConfiguration]);
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
  const syncFavorites = () => run(async () => {
    const result = await presenterApi.syncFavorites();
    await onSynced?.(result.defaults);
    setFavoritesSynced(true);
    setNotice(`HeyGen 收藏 ${result.favoriteCount} 个，本次自动导入 ${result.importedCount} 个${result.skippedWithoutVoice ? `；${result.skippedWithoutVoice} 个缺少原配音色，需手动补选` : ''}${result.capacityReached ? '；企业人物已达上限' : ''}。`);
  });
  useEffect(() => {
    if (favoriteSyncStarted.current) return;
    favoriteSyncStarted.current = true;
    void syncFavorites();
  }, []);
  const choose = (look: PresenterLook, job?: PresenterCreation) => {
    setSelected({ look, creationId: job?.id }); setVoiceId(job?.voiceId || look.voiceId || ''); setAuthorized(false); if (initialConfiguration) setWizardStep(2);
  };
  const create = () => run(async () => {
    if (!file) throw new Error('请先选择人物素材');
    const reuseId = cap?.privateCatalog && reuseGroup ? reusePresenterId : undefined;
    const signature = `${type}:${name.trim()}:${file.name}:${file.size}:${file.lastModified}:${reuseId || ''}`;
    if (attempt.current?.signature && attempt.current.signature !== signature) throw new Error('上次提交结果尚未核实，请先刷新任务列表');
    attempt.current ||= { requestId: crypto.randomUUID(), uploadRequestId: crypto.randomUUID(), signature };
    if (!attempt.current.uploadId) {
      try { attempt.current.uploadId = (await presenterApi.upload(file, attempt.current.uploadRequestId, undefined, type === 'photo_from_video' ? 1 : undefined, type === 'digital_twin')).id; }
      catch (e) { attempt.current = undefined; throw e; }
    }
    const job = await presenterApi.create({ name: name.trim(), type: type === 'photo_from_video' ? 'photo' : type, voiceId, uploadId: attempt.current.uploadId, requestId: attempt.current.requestId, authorized, adultConfirmed, confirmed, ...(reuseId ? { reusePresenterId: reuseId, samePersonConfirmed } : {}) });
    updateJob(job); attempt.current = undefined; setFile(undefined); setConfirmed(false); setAuthorized(false); setAdultConfirmed(false);
    setSamePersonConfirmed(false);
    setNotice('人物任务已保存。训练和授权完成后，预览并添加到企业即可使用。');
  });
  const voice = voices.find(item => item.id === voiceId);
  const normalizedSearch = search.trim().toLowerCase();
  const catalogGroups = groupPresenterLooks(looks).filter(group => !normalizedSearch
    || group.name.toLowerCase().includes(normalizedSearch)
    || group.looks.some(look => look.name.toLowerCase().includes(normalizedSearch)));
  const voicePicker = <div className="space-y-2">{cap?.privateCatalog && <label className="block text-sm">声音来源<select aria-label="声音来源" className={field} value={voiceScope} onChange={e => { const scope = e.target.value as 'public' | 'private'; setVoiceScope(scope); void presenterApi.voices('', '', scope).then(page => { setVoices(page.items); setVoiceToken(page.nextToken); }).catch(error => setError(String(error))); }}><option value="public">公共音色</option><option value="private">本企业已录入音色</option></select></label>}<label className="block text-sm">人物声音<select aria-label="人物声音" className={field} value={voiceId} onChange={e => setVoiceId(e.target.value)}>
    <option value="">请选择声音</option>{voiceId && !voices.some(v => v.id === voiceId) && <option value={voiceId}>人物原配声音</option>}
    {voices.map(v => <option key={v.id} value={v.id}>{v.name} · {v.language}</option>)}
  </select></label>{voice && !voice.previewUrl && <p className="text-xs text-text-muted">此声音暂未提供试听样本</p>}{voice?.previewUrl && <audio aria-label="声音试听" controls src={voice.previewUrl} className="h-10 w-full" />}
    {voiceToken && <button className={button} type="button" disabled={busy} onClick={() => void run(async () => { const result = await presenterApi.voices(voiceToken, '', voiceScope); setVoices(current => [...new Map([...current, ...result.items].map(v => [v.id, v])).values()]); setVoiceToken(result.nextToken); })}>加载更多声音</button>}</div>;
  return <dialog ref={dialog} onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} aria-labelledby="presenter-manager-title" className="m-auto max-h-[90vh] w-[min(900px,94vw)] overflow-y-auto rounded-2xl border border-border bg-white p-0 text-text-primary shadow-xl backdrop:bg-black/35">
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-white p-5"><div><h2 id="presenter-manager-title" className="font-bold">{initialConfiguration ? '选择人物与声音' : '企业人物资产'}</h2></div><button type="button" disabled={busy} onClick={onClose} className={button} aria-label="关闭人物管理">关闭</button></header>
    <div className="space-y-5 p-5">
      {cap?.reason && <p className="rounded-lg bg-amber-50 p-3 text-sm">{cap.reason}</p>}
      {cap && !selectedCreationEnabled && selectedCreationReason && selectedCreationReason !== cap.reason && tab === 'create' && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">当前创建方式暂不可用：{selectedCreationReason}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm">{notice}</p>}
      {initialConfiguration && <ol className="grid grid-cols-3 gap-2" aria-label="人物配置步骤">{['选择人物','配置人物','保存资产'].map((label, index) => <li key={label} className={`rounded-lg border px-2 py-2 text-center text-xs ${wizardStep === index + 1 ? 'border-emerald-600 bg-emerald-50 font-bold text-emerald-800' : wizardStep > index + 1 ? 'border-emerald-200 text-emerald-700' : 'border-border text-text-muted'}`}>{index + 1}. {label}</li>)}</ol>}
      {(!initialConfiguration || wizardStep === 1) && <div className="grid grid-cols-2 gap-2"><button className={`${button} ${tab === 'import' ? 'border-emerald-600 bg-emerald-50 font-bold text-emerald-800' : ''}`} disabled={busy} onClick={() => { setTab('import'); if (!looks.length) void loadCatalog(); if (!favoritesSynced) void syncFavorites(); }}>选择已有人物</button><button className={`${button} ${tab === 'create' ? 'border-emerald-600 bg-emerald-50 font-bold text-emerald-800' : ''}`} disabled={busy} onClick={() => { setTab('create'); setSelected(undefined); setAuthorized(false); if (initialConfiguration) setWizardStep(2); }}>创建新人物</button></div>}
      {tab === 'create' && (!initialConfiguration || wizardStep === 2) && <fieldset disabled={busy || !selectedCreationEnabled} className="space-y-4 disabled:opacity-60">
        {!fixedMode && <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-1" aria-label="数字人创建模式">
          <button type="button" onClick={() => { if (creationMode !== 'quick') { setType('photo_from_video'); setFile(undefined); } }} className={`rounded-lg px-3 py-3 text-left text-sm ${creationMode === 'quick' ? 'bg-white font-bold shadow-sm' : ''}`}><span className="block">照片形象</span><span className="mt-1 block text-xs font-normal text-text-muted">上传照片或从视频抽帧，创建本人外观</span></button>
          <button type="button" onClick={() => { if (creationMode !== 'expert') { setType('digital_twin'); setFile(undefined); } }} className={`rounded-lg px-3 py-3 text-left text-sm ${creationMode === 'expert' ? 'bg-white font-bold shadow-sm' : ''}`}><span className="block">视频分身（专家）</span><span className="mt-1 block text-xs font-normal text-text-muted">完整真人视频训练，保留表情与动作习惯</span></button>
        </div>}
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">人物名称<input aria-label="人物名称" className={field} value={name} maxLength={100} onChange={e => setName(e.target.value)} placeholder="例如：品牌主理人、销售顾问" /></label>
          {creationMode === 'quick' ? <label className="text-sm">快速创建来源<select aria-label="创建方式" value={type} onChange={e => {
            const nextType = e.target.value as typeof type;
            const usesVideo = (value: typeof type) => value === 'photo_from_video' || value === 'digital_twin';
            if (!(usesVideo(type) && usesVideo(nextType))) setFile(undefined);
            setType(nextType);
          }} className={field}><option value="photo">上传本人照片</option><option value="photo_from_video">从本人视频提取照片</option></select></label> : <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm"><strong>Digital Twin 真人动作人物</strong><span className="mt-1 block text-xs text-text-muted">训练完成后可使用专家表演与动作控制</span></div>}</div>
        {creationMode === 'expert' && <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-950">上传 30 秒至 5 分钟、至少 720p 的单人连续口播视频。</p>}
        <label className="block text-sm">{type === 'photo' ? '正面照片' : type === 'photo_from_video' ? '正脸视频' : '连续口播视频'}<input key={type + (file ? 'selected' : 'empty')} aria-label="人物素材" type="file" accept={type === 'photo' ? '.jpg,.jpeg,.png,image/jpeg,image/png' : '.mp4,.mov,.webm,video/mp4,video/quicktime,video/webm'} onChange={e => setFile(e.target.files?.[0])} className={field} /><span className="mt-1 block text-xs text-text-muted">{file ? `已选择：${file.name}` : type === 'photo' ? 'JPG 或 PNG，人物正脸清晰。' : 'MP4、MOV 或 WebM。'}</span></label>
        {voicePicker}
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={authorized} onChange={e => setAuthorized(e.target.checked)} />我已取得此人物的肖像及素材使用授权，同意将素材提交给 HeyGen 处理</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={adultConfirmed} onChange={e => setAdultConfirmed(e.target.checked)} />我已核验画面主体为成年人</label>
        {cap?.privateCatalog && reusePresenterId && <div className="space-y-2 rounded-lg border border-emerald-200 p-3 text-sm"><label className="flex gap-2"><input type="checkbox" checked={reuseGroup} onChange={e => { setReuseGroup(e.target.checked); setSamePersonConfirmed(false); }} />沿用当前人物的 HeyGen 人物组授权</label>{reuseGroup && <label className="flex gap-2"><input type="checkbox" checked={samePersonConfirmed} onChange={e => setSamePersonConfirmed(e.target.checked)} />确认新增素材与当前已授权人物为同一人</label>}<p className="text-xs text-text-muted">若是另一位人物，取消沿用后创建独立人物组，由本人完成所需验证。</p></div>}
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />确认创建人物{Number(type !== 'digital_twin' ? cap?.photoReservationCny ?? cap?.reservationCny : cap?.digitalTwinReservationCny ?? cap?.reservationCny) > 0 ? `并接受供应商计费（本次预算预留 ¥${type !== 'digital_twin' ? cap?.photoReservationCny ?? cap?.reservationCny : cap?.digitalTwinReservationCny ?? cap?.reservationCny}）` : ''}</label>
        <div className="flex gap-2">{initialConfiguration && <button className={button} type="button" onClick={() => setWizardStep(1)}>上一步</button>}<button type="button" disabled={!name.trim() || !file || !voiceId || !authorized || !adultConfirmed || !confirmed || Boolean(cap?.privateCatalog && reusePresenterId && reuseGroup && !samePersonConfirmed)} onClick={() => void create()} className={`${button} bg-blue-600 text-white`}>{busy ? '正在提交…' : '创建人物'}</button></div>
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
              <span><strong className="block text-sm">{group.name}</strong><span className="mt-1 block text-xs text-text-muted">{group.looks.length} 个场景造型</span></span>
              <span className="text-xs font-medium text-emerald-700">{expanded ? '收起场景' : '查看场景'}</span>
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
      {(!initialConfiguration || tab === 'create') && <section className="space-y-3 border-t border-border pt-4"><div className="flex items-center justify-between"><h3 className="font-bold">创建进度</h3><button disabled={busy} className={button} onClick={() => void run(async () => setJobs(await presenterApi.creations()))}>刷新</button></div>
        {!jobs.length && <p className="text-sm text-text-muted">暂无创建任务。提交后进度会保存在这里，关闭页面也不会丢失。</p>}
        {jobs.map(job => <div key={job.id} className="space-y-2 rounded-lg border border-border p-3"><div className="flex flex-wrap items-center gap-3">{job.look?.imageUrl && <img alt={job.name} src={job.look.imageUrl} className="h-14 w-14 rounded object-contain" />}<strong className="text-sm">{job.name}</strong><span className="text-xs">{statusText(job)}</span>
          <button disabled={busy} className={button} onClick={() => void run(async () => updateJob(await presenterApi.refresh(job.id)))}>刷新状态</button>
          {job.status === 'completed' && job.look && <button disabled={busy} className={button} onClick={() => { setTab('import'); choose(job.look!, job); if (initialConfiguration) setWizardStep(2); }}>选择此人物</button>}
          {job.status === 'pending_consent' && !job.consentUrl && <button disabled={busy} className={button} onClick={() => void run(async () => updateJob(await presenterApi.consent(job.id, crypto.randomUUID())))}>获取本人授权入口</button>}
        </div>{job.error && <p className="text-xs text-amber-700">{job.error}</p>}
          {job.type === 'digital_twin' && job.groupId && <p className="break-all text-xs text-text-muted">绑定的 HeyGen 人物组：{job.groupId}</p>}
          {job.status === 'processing' && <p role="status" className="rounded-lg bg-sky-50 p-3 text-xs text-sky-950">人物处理中，完成后即可选择。</p>}
          {job.consentUrl && <div className="rounded-lg bg-amber-50 p-3 text-sm"><a className="font-bold text-emerald-700 underline" href={job.consentUrl} target="_blank" rel="noopener noreferrer">前往本人验证</a><span className="ml-2 text-xs text-amber-900">完成后返回并刷新。</span></div>}
        </div>)}
      </section>}
      {selected && tab === 'import' && (!initialConfiguration || wizardStep >= 2) && <fieldset disabled={busy} className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/30 p-4"><h3 className="font-bold">配置人物 · {selected.look.name}</h3>
        {selected.look.videoUrl ? <video aria-label="人物预览" controls src={selected.look.videoUrl} poster={selected.look.imageUrl} className="max-h-64 w-full rounded" /> : selected.look.imageUrl ? <img src={selected.look.imageUrl} alt={selected.look.name} className="max-h-64 w-full object-contain" /> : <p className="text-sm">供应商暂未提供预览，请稍后刷新。</p>}
        {voicePicker}<div className="flex gap-2"><button className={button} onClick={() => { setSelected(undefined); if (initialConfiguration) setWizardStep(1); }}>上一步</button><button type="button" disabled={!voiceId || !(selected.look.imageUrl || selected.look.videoUrl)} className={`${button} bg-blue-600 text-white`} onClick={() => void run(async () => { const value = await presenterApi.import({ lookId: selected.look.id, creationId: selected.creationId, voiceId, reviewed: true }); await onSaved(value); if (initialConfiguration) setWizardStep(3); setNotice('人物和声音已保存为企业资产。'); setSelected(undefined); })}>{initialConfiguration ? '保存人物与声音' : '添加到企业'}</button></div>
      </fieldset>}
    </div>
  </dialog>;
}
