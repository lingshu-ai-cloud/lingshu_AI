import { useEffect, useState } from 'react';
import { authHeader } from '../../lib/auth';
import { productionApi } from '../../lib/productionApi';
import type { PresenterAsset } from '../../lib/shotProduction';
import type { SwapJob } from '../../../server/routes/personSwap';
const base = '/api/overseas/studio/person-swap';
async function request<T>(route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await res.json(); if (!res.ok) throw new Error(value.error || '请求失败'); return value;
}
const labels: Record<SwapJob['status'], string> = { ready: '视频已检查，等待生成替换预览', image_submitting: '关键帧提交中，勿重复提交', image_pending: '人物替换预览生成中', preview: '请检查人物和背景，确认后生成视频', video_submitting: '视频提交中，勿重复提交', video_pending: '视频生成中', completed: '视频已完成，原音轨已保留', failed: '生成失败', uncertain: '提交结果待人工核对' };
export default function PersonSwapPanel() {
  const [presenters, setPresenters] = useState<PresenterAsset[]>([]);
  const [person, setPerson] = useState(''), [file, setFile] = useState<File | null>(null);
  const [jobs, setJobs] = useState<SwapJob[]>([]), [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [cap, setCap] = useState<{ enabled: boolean; reason: string; imageCny: number | null; videoCnyPerSecond: number | null } | null>(null);
  const job = jobs.find(j => j.id === selected);
  const media = (name: string) => `${base}/jobs/${job!.id}/media/${name}`;
  const put = (j: SwapJob) => { setJobs(old => [j, ...old.filter(x => x.id !== j.id)]); setSelected(j.id); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); } finally { setBusy(false); } };
  useEffect(() => { void Promise.all([request<SwapJob[]>('/jobs'), request<NonNullable<typeof cap>>('/capabilities'), productionApi.defaults()]).then(([list, c, defaults]) => { setPresenters(defaults.presenters); setJobs(list); setSelected(list[0]?.id || ''); setCap(c); }).catch(e => setError(String(e))); }, []);
  useEffect(() => { setConfirmed(false); }, [selected, job?.status]);
  useEffect(() => {
    if (!job || !['image_pending', 'video_pending'].includes(job.status)) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { const j = await request<SwapJob>(`/jobs/${job.id}/refresh`, {}); if (!stopped) { put(j); if (['image_pending', 'video_pending'].includes(j.status)) timer = setTimeout(poll, 7000); } } catch (e) { if (!stopped) setError(String(e)); } };
    timer = setTimeout(poll, 7000); return () => { stopped = true; clearTimeout(timer); };
  }, [selected, job?.status]);
  const cost = job?.status === 'ready' ? cap?.imageCny : job && cap?.videoCnyPerSecond ? Math.ceil(job.generationDuration * cap.videoCnyPerSecond * 100) / 100 : null;
  return <section className="mt-5 space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/30 p-5">
    <div><h3 className="font-bold">案例视频换人物 · 10 秒内</h3><p className="mt-1 text-sm text-text-muted">上传 ≤10 秒视频 → 选择企业人物 → 确认替换预览 → 生成并下载视频。上传单人连续镜头。保留原服装、动作和场景作为生成目标；原配乐、人声和环境音一并保留。</p></div>
    {cap && !cap.enabled && <p role="status" className="text-sm text-amber-800">{cap.reason}。可先上传检查素材。</p>}
    <fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
      <label className="text-sm">案例视频（MP4/MOV，≤10 秒，≤40MB）<input aria-label="案例视频" type="file" accept="video/mp4,video/quicktime,.mov" onChange={e => { setFile(e.target.files?.[0] || null); setError(''); }} className="mt-1 block max-w-xs text-sm" /></label>
      <label className="text-sm">企业人物<select aria-label="替换为企业人物" value={person} onChange={e => setPerson(e.target.value)} className="ml-2 rounded border p-2"><option value="">请选择</option>{presenters.filter(p => p.authorized && p.imageUrl).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <button disabled={!file || !person} className="rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-40" onClick={() => void run(async () => {
        if (!file || file.size > 40 * 1024 * 1024) throw new Error('请选择 40MB 以内的视频');
        const video = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(Error('文件读取失败')); reader.readAsDataURL(file); });
        put(await request<SwapJob>('/jobs', { presenterId: person, video: video.replace(/^data:[^;]*;/, file.name.toLowerCase().endsWith('.mov') ? 'data:video/quicktime;' : 'data:video/mp4;') }));
      })}>上传并检查</button>
    </fieldset>
    {!presenters.some(p => p.authorized && p.imageUrl) && <p className="text-sm">请先到企业资料的企业出镜设置中添加带参考图片的人物，再返回此处。</p>}
    {jobs.length > 0 && <label className="block text-sm">已有任务<select className="ml-2 max-w-full rounded border p-2" value={selected} onChange={e => setSelected(e.target.value)}>{jobs.map(j => <option key={j.id} value={j.id}>{new Date(j.createdAt).toLocaleString()} · {j.presenterName} · {labels[j.status]}</option>)}</select></label>}
    {job && <div className="space-y-3">
      <p role="status" className="text-sm font-medium">{labels[job.status]} · {job.duration.toFixed(2)} 秒 · {job.presenterName}{job.duration < 2 ? '（生成时补至 2 秒，输出恢复原时长）' : ''}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <figure><video key={job.id} src={media('source.mp4')} controls className="h-60 w-full rounded bg-black object-contain" /><figcaption className="text-xs">原案例视频</figcaption></figure>
        <figure><img src={media('person.png')} alt="企业人物参考" className="h-60 w-full rounded bg-white object-contain" /><figcaption className="text-xs">企业人物参考</figcaption></figure>
        {['preview', 'video_submitting', 'video_pending', 'completed'].includes(job.status) && <figure><img src={media('keyframe.png')} alt="替换关键帧预览" className="h-60 w-full rounded bg-black object-contain" /><figcaption className="text-xs">检查人物、产品及背景；不满意时不要继续生成</figcaption></figure>}
      </div>
      {['ready', 'preview'].includes(job.status) && <div className="space-y-2 text-sm">
        <p>本阶段估价：{cost == null ? '待配置' : `¥${cost.toFixed(2)}`}。关键帧与视频分阶段计费，最终以供应商账单为准。</p>
        <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{job.status === 'preview' ? '已确认预览效果，同意本阶段生成费用' : '确认生成替换预览及本阶段费用'}</label>
        <button disabled={busy || !cap?.enabled || !confirmed || cost == null} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-40" onClick={() => void run(async () => put(await request<SwapJob>(`/jobs/${job.id}/${job.status === 'ready' ? 'image' : 'video'}`, { confirmed: true, maxCostCny: cost })))}>{job.status === 'ready' ? '生成替换预览' : '确认并生成视频'}</button>
      </div>}
      {['image_pending', 'video_pending'].includes(job.status) && <button disabled={busy} className="rounded border px-3 py-2 text-sm" onClick={() => void run(async () => put(await request<SwapJob>(`/jobs/${job.id}/refresh`, {})))}>刷新原任务</button>}
      {job.error && <p role="alert" className="text-sm text-amber-800">{job.error}</p>}
      {job.status === 'completed' && <div><video src={media('output.mp4')} controls className="max-h-96 w-full rounded bg-black" /><a className="mt-2 inline-block text-sm text-emerald-800 underline" href={media('output.mp4')} download={`企业人物替换-${job.id}.mp4`}>下载输出视频</a><p className="text-xs text-text-muted">请人工检查人物一致性、遮挡与产品细节；技术检查通过不代表视觉质量已验收。</p></div>}
    </div>}
    {busy && <p role="status" className="text-sm">正在处理，请保持当前页面…</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
