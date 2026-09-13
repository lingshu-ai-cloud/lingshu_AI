import { useEffect, useRef, useState } from 'react';
import { parseShotCommand, shotFingerprint, shotBlockers, type ShotProduction, type ProductionDefaults, type AvatarJob, type PresenterAsset } from '../lib/shotProduction';
import { avatarCandidateReady } from '../lib/shotProduction';

type Asset = { id: string; name: string; type?: string; url?: string; poster?: string };
export default function ShotProductionPanel(props: {
  shot: ShotProduction; context: string; title: string; defaults: ProductionDefaults; materials: Asset[]; products: { id: string; label: string }[];
  jobs: AvatarJob[]; refreshingJobIds?: string[]; preview?: Asset; reason: string; error: string; busy: boolean; configured: boolean; capabilityReason?: string; costPerSecond: number | null;
  onChange: (patch: Partial<ShotProduction>) => void; onClose: () => void; onNarration: () => void;
  onDefaults: (value: ProductionDefaults) => Promise<void>; onGenerate: () => void; onAi: () => void; onShoot: () => void;
  onMaterial: () => void; onAdopt: (id: string) => void; onRefresh: (id: string) => void;
}) {
  const { shot, defaults } = props;
  const [presenter, setPresenter] = useState<PresenterAsset>({ id: '', name: '', avatarId: '', voiceId: '', authorized: false, supportsAlpha: false });
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsError, setDefaultsError] = useState('');
  const [chargeConfirmed, setChargeConfirmed] = useState(false);
  const [command, setCommand] = useState(''); const [commandMessage, setCommandMessage] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialogRef.current?.focus(); return () => previous?.focus(); }, []);
  const mediaSelect = (label: string, field: 'productMaterialId' | 'backgroundMaterialId') => <label className="block text-xs">{label}<select value={shot[field]} disabled={shot.locked} onChange={e => props.onChange({ [field]: e.target.value })} className="mt-1 w-full rounded-lg border p-2"><option value="">不使用</option>{props.materials.filter(item => item.type !== 'audio').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
  const selectedProduct = props.materials.find(item => item.id === shot.productMaterialId);
  const background = props.materials.find(item => item.id === shot.backgroundMaterialId);
  const renderMedia = (asset?: Asset, cls = '') => !asset?.url ? null : asset.type === 'image' ? <img src={asset.url} alt={asset.name} className={cls} /> : <video src={asset.url} muted controls playsInline className={cls} />;
  return <div className="absolute inset-0 z-40 flex justify-end bg-black/25">
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="镜头编辑" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); props.onClose(); }
      if (event.key === 'Tab') { const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary') || [])].filter(item => item.offsetParent !== null && !item.closest('fieldset:disabled')); const first = controls[0]; const last = controls.at(-1); if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    }} className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl">
      <div className="flex justify-between"><h2 className="font-bold">{props.title} · 镜头编辑</h2><button type="button" onClick={props.onClose}>关闭</button></div>
      <p className="my-2 text-xs text-text-muted">{props.reason}</p>
      <form className="my-3 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); const patch = parseShotCommand(command); if (!patch) { setCommandMessage('暂未识别。可说：改成分屏、使用数字人、安排拍摄、使用原声、台词改为…、锁定镜头。'); return; } if (shot.locked && patch.locked !== false) { setCommandMessage('请先解锁镜头'); return; } props.onChange(patch); setCommandMessage(patch.narration ? '台词已填入，请应用到脚本；不会自动生成付费视频。' : '已更新当前镜头设置，未发起付费生成。'); setCommand(''); }}>
        <input aria-label="用一句话编辑当前镜头" value={command} onChange={event => setCommand(event.target.value)} placeholder="例如：改成画中画" className="min-w-0 flex-1 rounded-lg border p-2 text-xs" />
        <button disabled={props.busy || !command.trim()} type="submit" className="rounded-lg border px-3 text-xs disabled:opacity-40">应用指令</button>
        {commandMessage && <p role="status" className="w-full text-xs text-text-muted">{commandMessage}</p>}
      </form>
      <div className="relative mb-3 h-48 overflow-hidden rounded-xl bg-slate-900">
        {shot.layout === 'full' ? <>{renderMedia(background, 'absolute inset-0 h-full w-full object-cover')}{renderMedia(props.preview, 'relative h-full w-full object-contain')}</> : shot.layout === 'split' ? <div className="flex h-full">{renderMedia(props.preview, 'h-full w-1/2 object-cover')}{renderMedia(selectedProduct, 'h-full w-1/2 object-contain')}</div> : <>{renderMedia(selectedProduct, 'h-full w-full object-contain')}{renderMedia(props.preview, 'absolute bottom-2 right-2 h-2/5 w-2/5 object-contain')}</>}
      </div>
      <p className="mb-3 text-[10px] text-text-muted">布局示意预览；最终声音与字幕请使用成片预览验收。</p>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={shot.locked} onChange={e => props.onChange({ locked: e.target.checked })} />锁定镜头（禁止替换和自动推荐）</label>
      <fieldset disabled={shot.locked || props.busy} className="mt-4 space-y-4 disabled:opacity-60">
        <label className="block text-xs">制作来源<select value={shot.source} onChange={e => props.onChange({ source: e.target.value as ShotProduction['source'] })} className="mt-1 w-full rounded-lg border p-2"><option value="material">已有素材</option><option value="avatar">数字人口播</option><option value="ai">AI创意画面</option><option value="shoot">安排真人拍摄</option></select></label>
        <label className="block text-xs">台词<textarea rows={3} value={shot.narration} onChange={e => props.onChange({ narration: e.target.value })} className="mt-1 w-full rounded-lg border p-2" /><button type="button" onClick={props.onNarration} className="mt-1 text-accent">应用台词到脚本（旧配音与字幕需更新）</button></label>
        <label className="block text-xs">声音方式<select value={shot.sound} onChange={e => props.onChange({ sound: e.target.value as ShotProduction['sound'] })} className="mt-1 w-full rounded-lg border p-2"><option value="voiceover">连续旁白</option><option value="source">使用镜头原声 / 人物说话</option><option value="silent">此镜无声</option></select></label>
        {shot.source === 'avatar' && <>
          <label className="block text-xs">企业人物<select value={shot.presenterId} onChange={e => props.onChange({ presenterId: e.target.value })} className="mt-1 w-full rounded-lg border p-2"><option value="">请选择授权人物</option>{defaults.presenters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={shot.transparent} onChange={e => props.onChange({ transparent: e.target.checked })} />生成透明人物层（须人物支持；用于抠像画中画或独立背景）</label>
          <p className="text-xs text-amber-700">数字人画中画必须去掉原背景；带背景的矩形小窗不算抠像。未验证透明人物时，请先用全屏普通混剪。</p>
          <p className="text-xs text-text-muted">人物说话使用所选人物声音；连续旁白会截取本镜头的已确认音频驱动嘴型，与产品镜头共享同一讲解音轨。</p>
        </>}
        <label className="block text-xs">布局<select value={shot.layout} onChange={e => props.onChange({ layout: e.target.value as ShotProduction['layout'] })} className="mt-1 w-full rounded-lg border p-2"><option value="full">全屏画面 / 人物</option><option value="split">人物与产品分屏</option><option value="pip">产品主画面 + 人物小窗</option></select></label>
        <label className="block text-xs">关联产品<select value={shot.productId} onChange={e => props.onChange({ productId: e.target.value })} className="mt-1 w-full rounded-lg border p-2"><option value="">沿用草稿产品</option>{props.products.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        {mediaSelect('产品画面（独立图层）', 'productMaterialId')}
        {shot.productId && <label className="flex gap-2 text-xs"><input type="checkbox" checked={shot.factsConfirmed} onChange={e => props.onChange({ factsConfirmed: e.target.checked })} />已核对该SKU与台词、参数及证据一致</label>}
        {mediaSelect('背景素材', 'backgroundMaterialId')}
        <label className="block text-xs">背景性质<select value={shot.backgroundMode} onChange={e => props.onChange({ backgroundMode: e.target.value as ShotProduction['backgroundMode'] })} className="mt-1 w-full rounded-lg border p-2"><option value="independent">独立背景：只重新合成</option><option value="baked">已在视频中：换背景需重生成</option></select></label>
        {shot.backgroundMode === 'baked' && <p className="text-xs text-amber-700">不能直接擦除原片背景。改背景将使旧候选过期；首版请使用透明人物层或替换整条素材。</p>}
        {shot.source === 'material' && <button type="button" onClick={props.onMaterial} className="rounded-lg border px-4 py-2 text-xs">打开素材库选画面</button>}
        {shot.source === 'shoot' && <button type="button" onClick={props.onShoot} className="rounded-lg border px-4 py-2 text-xs">创建待拍任务</button>}
        {shot.source === 'ai' && <button type="button" onClick={props.onAi} className="rounded-lg border px-4 py-2 text-xs">生成这一镜（使用现有Seedance计费）</button>}
        {shot.source === 'avatar' && <div className="space-y-2 rounded-xl bg-surface-2 p-3">
          <p className="text-xs">{props.configured ? 'HeyGen接口已启用；仅生成此镜头，已有候选保留。' : 'HeyGen未配置或未启用，当前不会调用付费生成。'}</p>
          {!props.configured && props.capabilityReason && <p className="text-xs" role="status">{props.capabilityReason}</p>}
          <p className="text-xs">提交结果未知时只核对原任务，不自动再次生成。预算预占是调用准入控制，不等于供应商最终账单。</p>
          <p className="text-xs">{props.costPerSecond ? `配置估价约 ¥${(Math.max(1, shot.narration.length / 4) * props.costPerSecond).toFixed(2)}；按实际时长计费，重试可能产生额外成本。` : '未配置单价，费用以供应商账单为准。'}</p>
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={chargeConfirmed} onChange={e => setChargeConfirmed(e.target.checked)} />确认本次镜头生成及供应商计费</label>
          <button type="button" disabled={!props.configured || !chargeConfirmed || !shot.presenterId || !shot.narration.trim()} onClick={() => { setChargeConfirmed(false); props.onGenerate(); }} className="rounded-lg bg-accent px-4 py-2 text-xs text-white disabled:opacity-40">{props.busy ? '提交中…' : '生成新候选'}</button>
        </div>}
      </fieldset>
      {[props.error, ...shotBlockers(shot, props.context)].filter(Boolean).map((message, i) => <p role="alert" key={i} className="mt-2 text-xs text-red-600">{message}</p>)}
      <div className="mt-4 space-y-2"><h3 className="text-sm font-bold">候选与任务</h3>
        <p className="text-[10px] text-text-muted">新数字人文件入库前检查实际画幅、分辨率、音轨和透明区域。技术通过不代表口型、人物边缘与观感已人工验收。</p>
        {props.jobs.map(job => <div key={job.id} className="rounded-lg border p-2 text-xs">{job.error?.startsWith('供应商已生成') ? '已生成 · 待入库核验' : ({ submitting: '正在提交', pending: '生成处理中', completed: '候选已就绪', failed: '生成失败', uncertain: '提交结果待核对' }[job.status])} {job.error}
          {job.status === 'pending' && job.error && <p className="mt-1 text-text-muted">已暂停自动重查。处理问题后可手动刷新原任务，不会重新付费生成。</p>}
          <button type="button" disabled={props.refreshingJobIds?.includes(job.id)} onClick={() => props.onRefresh(job.id)} className="ml-2 text-accent disabled:opacity-40">{props.refreshingJobIds?.includes(job.id) ? '正在核验…' : '刷新原任务'}</button></div>)}
        {shot.candidates.map((candidate, index) => <div key={candidate.id} className="flex justify-between rounded-lg border p-2 text-xs"><span>V{index + 1} · {candidate.source} {candidate.fingerprint !== shotFingerprint(shot, props.context) ? '· 要求已变化' : ''} {!avatarCandidateReady(candidate, props.jobs) ? '· 任务未完成或待核验' : ''}</span><button type="button" disabled={shot.locked || candidate.fingerprint !== shotFingerprint(shot, props.context) || !avatarCandidateReady(candidate, props.jobs)} onClick={() => props.onAdopt(candidate.id)} className="text-accent disabled:opacity-40">{shot.adoptedId === candidate.id ? '当前采用' : '采用 / 恢复'}</button></div>)}
      </div>
      <details className="mt-5 rounded-xl border p-3"><summary className="cursor-pointer text-xs font-bold">企业默认出镜偏好与人物资产</summary>
        <select aria-label="企业默认出镜偏好" value={defaults.preference} onChange={async e => { try { await props.onDefaults({ ...defaults, preference: e.target.value as ProductionDefaults['preference'] }); } catch (error) { setDefaultsError(String(error)); } }} className="my-2 w-full rounded-lg border p-2 text-xs"><option value="auto">AI推荐</option><option value="avatar">优先数字人</option><option value="real">优先真人实拍</option><option value="none">不出镜</option></select>
        {defaults.presenters.map(item => <div key={item.id} className="my-2 flex justify-between text-xs"><span>{item.name}</span><button type="button" onClick={async () => { try { await props.onDefaults({ ...defaults, defaultPresenterId: item.id }); } catch (error) { setDefaultsError(String(error)); } }}>{defaults.defaultPresenterId === item.id ? '默认人物' : '设为默认'}</button></div>)}
        <p className="my-2 text-xs text-text-muted">绑定已在供应商创建并授权的人物，不自动训练或采购数字分身。</p>
        {(['name', 'avatarId', 'voiceId'] as const).map(field => <input key={field} aria-label={field} placeholder={{ name: '人物名称', avatarId: 'HeyGen人物/Look ID', voiceId: 'HeyGen声音ID' }[field]} value={presenter[field]} onChange={e => setPresenter(value => ({ ...value, [field]: e.target.value }))} className="my-1 w-full rounded-lg border p-2 text-xs" />)}
        <label className="my-2 flex gap-2 text-xs"><input type="checkbox" checked={presenter.authorized} onChange={e => setPresenter(value => ({ ...value, authorized: e.target.checked }))} />确认持有人物及声音的使用授权</label>
        <label className="my-2 flex gap-2 text-xs"><input type="checkbox" checked={presenter.supportsAlpha} onChange={e => setPresenter(value => ({ ...value, supportsAlpha: e.target.checked }))} />已核验该人物支持透明WebM</label>
        <label className="my-2 block text-xs">人物原生画幅（查看供应商预览后人工核验）<select aria-label="人物原生画幅" value={presenter.nativeOrientation || 'unknown'} onChange={e => setPresenter(value => ({ ...value, nativeOrientation: e.target.value as PresenterAsset['nativeOrientation'] }))}><option value="unknown">未核验</option><option value="portrait">竖屏</option><option value="landscape">横屏</option><option value="square">方形</option></select></label>
        <button type="button" disabled={savingDefaults || !presenter.authorized || !presenter.name || !presenter.avatarId || !presenter.voiceId} onClick={async () => { setSavingDefaults(true); setDefaultsError(''); try { const item = { ...presenter, id: crypto.randomUUID() }; await props.onDefaults({ ...defaults, presenters: [...defaults.presenters, item], defaultPresenterId: defaults.defaultPresenterId || item.id }); setPresenter({ id: '', name: '', avatarId: '', voiceId: '', authorized: false, supportsAlpha: false }); } catch (error) { setDefaultsError(String(error)); } finally { setSavingDefaults(false); } }} className="mt-2 rounded-lg border px-3 py-2 text-xs disabled:opacity-40">保存人物资产</button>
        {defaultsError && <p role="alert" className="mt-2 text-xs text-red-600">{defaultsError}</p>}
      </details>
    </section>
  </div>;
}
