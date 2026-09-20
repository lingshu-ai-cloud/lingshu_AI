import { useEffect, useState } from 'react';
import PresenterManager from './PresenterManager';
import { productionApi } from '../../lib/productionApi';
import { EMPTY_DEFAULTS, type ProductionDefaults, type PresenterAsset } from '../../lib/shotProduction';

export default function EnterprisePresenters() {
  const [value, setValue] = useState<ProductionDefaults>(EMPTY_DEFAULTS);
  const [managerOpen, setManagerOpen] = useState(false);
  const [loaded, setLoaded] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => { let live = true; void productionApi.defaults().then(result => { if (live) { setValue(result); setLoaded(true); } }).catch(error => { if (live) setMessage(String(error)); }); return () => { live = false; }; }, []);
  const save = async (next: ProductionDefaults) => { if (!loaded || busy) return false; setBusy(true); setMessage(''); try { setValue(await productionApi.saveDefaults(next)); setMessage('已保存到企业，新的创作草稿会继承'); return true; } catch (error) { setMessage(String(error)); return false; } finally { setBusy(false); } };
  return <section className="rounded-xl border border-border bg-white p-5">
    <h3 className="text-sm font-bold">数字人社媒 · 企业出镜设置</h3><p className="mt-1 text-xs text-text-muted">统一管理企业出镜人物，创建或导入后可在镜头编辑中直接选择。</p>
    <fieldset disabled={!loaded || busy} className="mt-3 space-y-3 disabled:opacity-50">
      <label className="block text-xs">默认出镜偏好<select value={value.preference} onChange={event => void save({ ...value, preference: event.target.value as ProductionDefaults['preference'] })} className="mt-1 w-full rounded-lg border p-2"><option value="auto">AI推荐</option><option value="avatar">优先数字人</option><option value="real">优先真人实拍</option><option value="none">不出镜</option></select></label>
      {value.presenters.map(presenter => <div key={presenter.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-xs"><span className="flex items-center gap-2">{presenter.imageUrl && <img src={presenter.imageUrl} alt={presenter.name} className="h-12 w-12 rounded object-contain" />}{presenter.name} · 已添加</span>
        <label className="flex items-center gap-1"><input type="checkbox" checked={presenter.supportsAlpha} onChange={event => void save({ ...value, presenters: value.presenters.map(item => item.id === presenter.id ? { ...item, supportsAlpha: event.target.checked } : item) })} />已核验透明视频支持</label>
        <label>原生画幅<select aria-label={`${presenter.name}原生画幅`} value={presenter.nativeOrientation || 'unknown'} onChange={event => void save({ ...value, presenters: value.presenters.map(item => item.id === presenter.id ? { ...item, nativeOrientation: event.target.value as PresenterAsset['nativeOrientation'] } : item) })}><option value="unknown">未核验</option><option value="portrait">竖屏</option><option value="landscape">横屏</option><option value="square">方形</option></select></label>
        <button type="button" onClick={() => void save({ ...value, defaultPresenterId: presenter.id })}>{value.defaultPresenterId === presenter.id ? '默认人物' : '设为默认'}</button></div>)}
      <button type="button" onClick={() => setManagerOpen(true)} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white">添加企业人物</button>
    </fieldset>
    {managerOpen && <PresenterManager onClose={() => setManagerOpen(false)} onSaved={next => { setValue(next); setMessage('企业人物已保存'); }} />}
    {message && <p role="status" className="mt-3 text-xs text-text-secondary">{message}</p>}
  </section>;
}
