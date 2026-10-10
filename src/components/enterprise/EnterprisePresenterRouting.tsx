import { useEffect, useState } from 'react';
import { productionApi } from '../../lib/productionApi';
import { EMPTY_DEFAULTS, type PresenterChannel, type ProductionDefaults, type PresenterRoute, type ShotLayout } from '../../lib/shotProduction';

const CHANNELS: Array<{ id: PresenterChannel; label: string }> = [
  { id: 'default', label: '企业默认' }, { id: 'tiktok', label: 'TikTok' }, { id: 'youtube', label: 'YouTube' },
  { id: 'facebook', label: 'Facebook' }, { id: 'instagram', label: 'Instagram' }, { id: 'live', label: '直播' },
];
const layoutLabel: Record<ShotLayout, string> = { full: '全屏人物', split: '人物与产品分屏', pip: '产品主画面＋人物小窗' };

export default function EnterprisePresenterRouting() {
  const [value, setValue] = useState<ProductionDefaults>(EMPTY_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { let live = true; void productionApi.defaults().then(next => { if (live) { setValue({ ...EMPTY_DEFAULTS, ...next, presenterRoutes: next.presenterRoutes || [] }); setLoaded(true); } }).catch(error => setMessage(String(error))); return () => { live = false; }; }, []);
  const routeFor = (channel: PresenterChannel): PresenterRoute => value.presenterRoutes.find(item => item.channel === channel) || { channel, presenterId: '', voiceId: '', layout: value.defaultLayout };
  const update = (channel: PresenterChannel, patch: Partial<PresenterRoute>) => setValue(current => ({ ...current, presenterRoutes: [...current.presenterRoutes.filter(item => item.channel !== channel), { ...routeFor(channel), ...patch }] }));
  const save = async () => { setSaving(true); setMessage(''); try { setValue(await productionApi.saveDefaults(value)); setMessage('渠道与出镜策略已保存，新的内容任务会读取这里的配置。'); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setSaving(false); } };
  return <section className="rounded-xl border border-border bg-white p-5">
    <h3 className="text-sm font-bold">渠道与出镜策略</h3>
    <p className="mt-1 text-xs text-text-muted">维护各渠道默认人物、人物音色和画面布局。未单独配置的渠道继承企业默认。</p>
    <fieldset disabled={!loaded || saving || !value.presenters.length} className="mt-4 space-y-3 disabled:opacity-50">
      {CHANNELS.map(channel => { const route = routeFor(channel.id); const presenter = value.presenters.find(item => item.id === route.presenterId); return <div key={channel.id} className="grid gap-3 rounded-xl border border-border p-3 md:grid-cols-[140px_1fr_1fr_1fr] md:items-end">
        <strong className="text-sm">{channel.label}</strong>
        <label className="text-xs">默认人物<select className="mt-1 w-full rounded-lg border p-2" value={route.presenterId} onChange={event => { const next = value.presenters.find(item => item.id === event.target.value); update(channel.id, { presenterId: event.target.value, voiceId: next?.voiceId || '' }); }}><option value="">继承企业默认</option>{value.presenters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-xs">人物音色<input className="mt-1 w-full rounded-lg border bg-slate-50 p-2" value={route.voiceId || presenter?.voiceId || ''} onChange={event => update(channel.id, { voiceId: event.target.value })} placeholder="随人物默认音色" /></label>
        <label className="text-xs">画面布局<select className="mt-1 w-full rounded-lg border p-2" value={route.layout} onChange={event => update(channel.id, { layout: event.target.value as ShotLayout })}>{(Object.keys(layoutLabel) as ShotLayout[]).map(id => <option key={id} value={id}>{layoutLabel[id]}</option>)}</select></label>
      </div>; })}
      {!value.presenters.length && <p className="text-sm text-amber-700">请先在“人物与音色资产”中选择或创建企业人物。</p>}
      <button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? '保存中…' : '保存出镜策略'}</button>
    </fieldset>
    {message && <p role="status" className="mt-3 text-xs text-text-secondary">{message}</p>}
  </section>;
}
