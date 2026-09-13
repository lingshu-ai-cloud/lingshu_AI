import { useEffect, useState } from 'react';
import { productionApi } from '../../lib/productionApi';
import { EMPTY_DEFAULTS, type ProductionDefaults, type PresenterAsset } from '../../lib/shotProduction';

export default function EnterprisePresenters() {
  const [value, setValue] = useState<ProductionDefaults>(EMPTY_DEFAULTS);
  const [draft, setDraft] = useState<PresenterAsset>({ id: '', name: '', avatarId: '', voiceId: '', authorized: false, supportsAlpha: false });
  const [loaded, setLoaded] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => { let live = true; void productionApi.defaults().then(result => { if (live) { setValue(result); setLoaded(true); } }).catch(error => { if (live) setMessage(String(error)); }); return () => { live = false; }; }, []);
  const save = async (next: ProductionDefaults) => { if (!loaded || busy) return false; setBusy(true); setMessage(''); try { setValue(await productionApi.saveDefaults(next)); setMessage('已保存到企业，新的创作草稿会继承'); return true; } catch (error) { setMessage(String(error)); return false; } finally { setBusy(false); } };
  return <section className="rounded-xl border border-border bg-white p-5">
    <h3 className="text-sm font-bold">数字人社媒 · 企业出镜设置</h3><p className="mt-1 text-xs text-text-muted">与镜头编辑共用同一套人物资产。这里只绑定已有授权人物，不自动训练或产生生成费用。</p>
    <fieldset disabled={!loaded || busy} className="mt-3 space-y-3 disabled:opacity-50">
      <label className="block text-xs">默认出镜偏好<select value={value.preference} onChange={event => void save({ ...value, preference: event.target.value as ProductionDefaults['preference'] })} className="mt-1 w-full rounded-lg border p-2"><option value="auto">AI推荐</option><option value="avatar">优先数字人</option><option value="real">优先真人实拍</option><option value="none">不出镜</option></select></label>
      {value.presenters.map(presenter => <div key={presenter.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-xs"><span>{presenter.name} · 已确认使用授权</span>
        <label>人工核验原生画幅<select aria-label={`${presenter.name}原生画幅`} value={presenter.nativeOrientation || 'unknown'} onChange={event => void save({ ...value, presenters: value.presenters.map(item => item.id === presenter.id ? { ...item, nativeOrientation: event.target.value as PresenterAsset['nativeOrientation'] } : item) })}><option value="unknown">未核验</option><option value="portrait">竖屏</option><option value="landscape">横屏</option><option value="square">方形</option></select></label>
        <button type="button" onClick={() => void save({ ...value, defaultPresenterId: presenter.id })}>{value.defaultPresenterId === presenter.id ? '默认人物' : '设为默认'}</button></div>)}
      <details><summary className="cursor-pointer text-xs font-bold">添加授权人物</summary><div className="mt-2 grid gap-2 sm:grid-cols-3">{(['name', 'avatarId', 'voiceId'] as const).map(field => <input key={field} aria-label={field} value={draft[field]} placeholder={{ name: '人物名称', avatarId: 'HeyGen人物/Look ID', voiceId: 'HeyGen声音ID' }[field]} onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))} className="rounded-lg border p-2 text-xs" />)}</div>
        <label className="mt-2 flex gap-2 text-xs"><input type="checkbox" checked={draft.authorized} onChange={event => setDraft(current => ({ ...current, authorized: event.target.checked }))} />已取得人物和声音使用授权</label>
        <label className="mt-2 flex gap-2 text-xs"><input type="checkbox" checked={draft.supportsAlpha} onChange={event => setDraft(current => ({ ...current, supportsAlpha: event.target.checked }))} />已验证透明人物视频支持</label>
        <label className="mt-2 block text-xs">人物原生画幅（查看供应商预览后人工核验）<select aria-label="人物原生画幅" value={draft.nativeOrientation || 'unknown'} onChange={event => setDraft(current => ({ ...current, nativeOrientation: event.target.value as PresenterAsset['nativeOrientation'] }))}><option value="unknown">未核验</option><option value="portrait">竖屏</option><option value="landscape">横屏</option><option value="square">方形</option></select></label>
        <button type="button" disabled={!draft.authorized || !draft.name || !draft.avatarId || !draft.voiceId} onClick={async () => { const item = { ...draft, id: crypto.randomUUID() }; if (await save({ ...value, presenters: [...value.presenters, item], defaultPresenterId: value.defaultPresenterId || item.id })) setDraft({ id: '', name: '', avatarId: '', voiceId: '', authorized: false, supportsAlpha: false }); }} className="mt-2 rounded-lg border px-3 py-2 text-xs disabled:opacity-40">保存人物</button>
      </details>
    </fieldset>
    {message && <p role="status" className="mt-3 text-xs text-text-secondary">{message}</p>}
  </section>;
}
