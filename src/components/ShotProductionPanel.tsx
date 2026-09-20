import { useEffect, useRef, useState } from 'react';
import { avatarMotionPrompt, parseShotCommand, shotFingerprint, shotBlockers, type ShotProduction, type ProductionDefaults, type AvatarJob } from '../lib/shotProduction';
import { avatarCandidateReady } from '../lib/shotProduction';
import PresenterManager from './enterprise/PresenterManager';

type Asset = { id: string; name: string; type?: string; url?: string; poster?: string };
export default function ShotProductionPanel(props: {
  shot: ShotProduction; context: string; title: string; defaults: ProductionDefaults; materials: Asset[]; products: { id: string; label: string }[];
  duration: number;
  jobs: AvatarJob[]; refreshingJobIds?: string[]; preview?: Asset; reason: string; error: string; busy: boolean; configured: boolean; motionPromptEnabled?: boolean; capabilityReason?: string; costPerSecond: number | null; singleTestCapCny?: number | null;
  onChange: (patch: Partial<ShotProduction>) => void; onClose: () => void; onNarration: () => void;
  onDefaults: (value: ProductionDefaults) => Promise<void>; onGenerate: () => void; onAi: () => void; onShoot: () => void;
  onMaterial: () => void; onAdopt: (id: string) => void; onRefresh: (id: string) => void;
}) {
  const { shot, defaults } = props;
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerMode, setManagerMode] = useState<'quick' | 'expert'>('quick');
  const [defaultsError, setDefaultsError] = useState('');
  const [chargeConfirmed, setChargeConfirmed] = useState(false);
  const [command, setCommand] = useState(''); const [commandMessage, setCommandMessage] = useState('');
  const avatarMode = shot.avatarMode || (shot.transparent ? 'overlay' : 'presenter');
  const selectedPresenter = defaults.presenters.find(item => item.id === shot.presenterId);
  const adoptedCandidate = shot.candidates.find(item => item.id === shot.adoptedId);
  const adoptedCandidateMatches = Boolean(adoptedCandidate && adoptedCandidate.fingerprint === shotFingerprint(shot, props.context));
  const presenterPreview: Asset | undefined = selectedPresenter?.videoUrl
    ? { id: selectedPresenter.id, name: `${selectedPresenter.name} · 人物资产预览`, type: 'video', url: selectedPresenter.videoUrl }
    : selectedPresenter?.imageUrl
      ? { id: selectedPresenter.id, name: `${selectedPresenter.name} · 人物资产预览`, type: 'image', url: selectedPresenter.imageUrl }
      : undefined;
  const previewAsset = shot.source === 'avatar' && !adoptedCandidateMatches && presenterPreview ? presenterPreview : props.preview;
  const estimatedDuration = Math.max(0, Number(props.duration) || 0);
  const estimatedCost = props.costPerSecond ? estimatedDuration * props.costPerSecond : null;
  const cinematicDurationValid = estimatedDuration >= 4 && estimatedDuration <= 15;
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
    }} className="h-full w-full max-w-[560px] overflow-y-auto bg-[#f8faf9] p-5 shadow-2xl">
      <div className="flex justify-between border-b pb-4"><div><p className="text-[10px] font-black uppercase tracking-wider text-accent">数字人分镜</p><h2 className="mt-1 font-black">{props.title}</h2></div><button type="button" onClick={props.onClose}>关闭</button></div>
      <p className="my-2 text-xs text-text-muted">{props.reason}</p>
      <form className="my-3 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); const patch = parseShotCommand(command); if (!patch) { setCommandMessage('暂未识别。可说：改成分屏、使用数字人、安排拍摄、使用原声、台词改为…、锁定镜头。'); return; } if (shot.locked && patch.locked !== false) { setCommandMessage('请先解锁镜头'); return; } props.onChange(patch); setCommandMessage(patch.narration ? '台词已填入，请应用到脚本；不会自动生成付费视频。' : '已更新当前镜头设置，未发起付费生成。'); setCommand(''); }}>
        <input aria-label="用一句话编辑当前镜头" value={command} onChange={event => setCommand(event.target.value)} placeholder="例如：改成画中画" className="min-w-0 flex-1 rounded-lg border p-2 text-xs" />
        <button disabled={props.busy || !command.trim()} type="submit" className="rounded-lg border px-3 text-xs disabled:opacity-40">应用指令</button>
        {commandMessage && <p role="status" className="w-full text-xs text-text-muted">{commandMessage}</p>}
      </form>
      <div className="relative mb-3 h-48 overflow-hidden rounded-xl bg-slate-900">
        {shot.layout === 'full' ? <>{renderMedia(background, 'absolute inset-0 h-full w-full object-cover')}{renderMedia(previewAsset, 'relative h-full w-full object-contain')}</> : shot.layout === 'split' ? <div className="flex h-full">{renderMedia(previewAsset, 'h-full w-1/2 object-cover')}{renderMedia(selectedProduct, 'h-full w-1/2 object-contain')}</div> : <>{renderMedia(selectedProduct, 'h-full w-full object-contain')}{renderMedia(previewAsset, 'absolute bottom-2 right-2 h-2/5 w-2/5 object-contain')}</>}
      </div>
      <p className="mb-3 text-[10px] text-text-muted">{previewAsset === presenterPreview ? `当前显示“${selectedPresenter?.name}”人物资产预览，用于先确认人物、原场景与光线；尚未生成当前台词口型。` : '布局示意预览；最终声音与字幕请使用成片预览验收。'}</p>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={shot.locked} onChange={e => props.onChange({ locked: e.target.checked })} />锁定镜头（禁止替换和自动推荐）</label>
      <fieldset disabled={shot.locked || props.busy} className="mt-4 space-y-4 disabled:opacity-60">
        <label className="block text-xs">制作来源<select value={shot.source} onChange={e => props.onChange({ source: e.target.value as ShotProduction['source'] })} className="mt-1 w-full rounded-lg border p-2"><option value="material">已有素材</option><option value="avatar">数字人口播</option><option value="ai">AI创意画面</option><option value="shoot">安排真人拍摄</option></select></label>
        <h3 className="text-sm font-black">1. 选择数字人</h3>
        <label className="block text-xs">声音方式<select value={shot.sound} onChange={e => props.onChange({ sound: e.target.value as ShotProduction['sound'] })} className="mt-1 w-full rounded-lg border p-2"><option value="voiceover">连续旁白</option><option value="source">使用镜头原声 / 人物说话</option><option value="silent">此镜无声</option></select></label>
        {shot.source === 'avatar' && <>
          <label className="block text-xs">数字人制作模式<select aria-label="数字人制作模式" value={avatarMode} onChange={e => {
            const avatarMode = e.target.value as ShotProduction['avatarMode'];
            props.onChange({ avatarMode, transparent: avatarMode === 'overlay' });
          }} className="mt-1 w-full rounded-lg border p-2"><option value="presenter">精准口播 · 台词与口型优先</option><option value="cinematic">运镜口播 · 4–15秒</option><option value="overlay">透明人物层 · 灵枢合成</option></select></label>
          <p className="rounded-lg bg-emerald-50 p-2 text-[10px] leading-4 text-emerald-800">{avatarMode === 'presenter' ? 'HeyGen 生成人物口型和表演。镜头运动可先保存为制作意图；当前合成器尚未应用该参数。' : avatarMode === 'cinematic' ? '真实摄影机运动需使用 Cinematic / Avatar Shots；普通 Motion Prompt 不能控制推拉摇移。' : '生成独立人物层，再与产品或背景素材合成。仅支持已核验透明能力的人物。'}</p>
          <div className="grid grid-cols-3 gap-2">{defaults.presenters.map(item => <button key={item.id} type="button" onClick={() => props.onChange({ presenterId: item.id })} className={`rounded-xl border p-3 text-xs font-bold ${shot.presenterId === item.id ? 'border-accent bg-accent/10 text-accent' : 'bg-white'}`}><span className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-base">{item.name.slice(0, 1)}</span>{item.name}<span className="mt-1 block text-[9px] font-normal text-text-muted">{item.creationMode === 'expert' ? '视频分身' : '照片形象'}</span></button>)}</div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="rounded-xl border bg-white p-3 text-left text-xs" onClick={() => { setManagerMode('quick'); setManagerOpen(true); }}><strong className="block text-sm">创建照片形象</strong><span className="mt-1 block text-text-muted">上传照片或从视频抽帧</span></button>
            <button type="button" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-left text-xs text-emerald-900" onClick={() => { setManagerMode('expert'); setManagerOpen(true); }}><strong className="block text-sm">创建视频分身（专家）</strong><span className="mt-1 block">上传完整真人视频训练 Digital Twin</span></button>
          </div>
          {avatarMode !== 'cinematic' && <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">表演风格<select aria-label="表演风格" value={shot.performancePreset || 'natural'} onChange={e => props.onChange({ performancePreset: e.target.value as ShotProduction['performancePreset'], motionPrompt: '' })} className="mt-1 w-full rounded-lg border p-2"><option value="natural">自然可信</option><option value="professional">专业笃定</option><option value="warm">温暖亲和</option><option value="surprise_marketing">惊喜营销</option></select></label>
            <label className="block text-xs">表现强度 · {Math.round((shot.emotionIntensity ?? 0.5) * 100)}%<input aria-label="表现强度" type="range" min="0.2" max="0.9" step="0.1" value={shot.emotionIntensity ?? 0.5} onChange={e => props.onChange({ emotionIntensity: Number(e.target.value), motionPrompt: '' })} className="mt-2 w-full accent-emerald-600" /></label>
            <label className="block text-xs sm:col-span-2">动作提示<textarea aria-label="动作提示" rows={2} value={shot.motionPrompt || avatarMotionPrompt(shot)} onChange={e => props.onChange({ motionPrompt: e.target.value })} className="mt-1 w-full rounded-lg border p-2" /></label>
            <p className={`rounded-lg p-2 text-[10px] sm:col-span-2 ${props.motionPromptEnabled ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{props.motionPromptEnabled ? `已接入 Avatar IV 动作控制${selectedPresenter?.creationMode === 'expert' ? '；当前为视频分身，可保留更多本人动作习惯。' : '；照片形象也可生成动作，但不会学习本人动作习惯。'}` : '动作提示已保存为创作意图，但当前账户尚未启用 Motion Prompt，生成时不会静默假装生效。'}</p>
            <label className="block text-xs">后期镜头运动（待合成接入）<select value={shot.cameraMovement || 'fixed'} onChange={e => props.onChange({ cameraMovement: e.target.value as ShotProduction['cameraMovement'] })} className="mt-1 w-full rounded-lg border p-2"><option value="fixed">固定镜头</option><option value="push_in">缓慢推近</option><option value="pull_out">缓慢拉远</option><option value="pan_left">向左平移</option><option value="pan_right">向右平移</option><option value="handheld">轻微手持</option></select></label>
          </div>}
          {avatarMode === 'cinematic' && <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <label className="block text-xs">摄影机运动<select value={shot.cameraMovement || 'push_in'} onChange={e => props.onChange({ cameraMovement: e.target.value as ShotProduction['cameraMovement'] })} className="mt-1 w-full rounded-lg border p-2"><option value="push_in">缓慢推近</option><option value="pull_out">缓慢拉远</option><option value="pan_left">向左横移</option><option value="pan_right">向右横移</option><option value="tracking">跟随人物</option><option value="orbit">环绕人物</option><option value="crane">升降镜头</option></select></label>
            <label className="block text-xs">场景与人物动作<textarea rows={3} value={shot.sceneDescription || ''} onChange={e => props.onChange({ sceneDescription: e.target.value })} placeholder="例如：人物站在明亮展厅，面向镜头介绍产品，镜头缓慢推近。" className="mt-1 w-full rounded-lg border p-2" /></label>
            <p className={`text-xs ${cinematicDurationValid ? 'text-amber-800' : 'font-bold text-red-700'}`}>当前镜头 {estimatedDuration.toFixed(1)} 秒；运镜口播要求 4–15 秒。</p>
          </div>}
        </>}
        <h3 className="text-sm font-black">2. 确认台词</h3>
        <label className="block text-xs"><textarea aria-label="台词" rows={3} value={shot.narration} onChange={e => props.onChange({ narration: e.target.value })} className="w-full rounded-xl border bg-white p-3" /><button type="button" onClick={props.onNarration} className="mt-1 font-bold text-accent">同步到分镜脚本</button></label>
        <h3 className="text-sm font-black">3. 选择画面形式</h3>
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
          <p className="text-xs">{estimatedCost != null ? `镜头 ${estimatedDuration.toFixed(1)} 秒，配置估价约 ¥${estimatedCost.toFixed(2)}；按实际时长计费，重试可能产生额外成本。` : '未配置单价，费用以供应商账单为准。'}</p>
          {props.singleTestCapCny ? <p className="text-xs font-bold text-emerald-800">单次口播测试预算准入上限 ¥{props.singleTestCapCny.toFixed(2)}；按当前配置单价估算，超过时会在调用供应商前停止，最终费用以供应商账单为准。</p> : null}
          {avatarMode === 'cinematic' && <p role="status" className="text-xs font-bold text-amber-700">Cinematic / Avatar Shots API 尚未接入当前账户，现阶段不会提交或扣费。</p>}
          <p className="text-[10px] text-text-muted">新数字人文件入库前检查实际画幅、分辨率、音轨和透明区域。技术通过不代表口型、人物边缘与观感已人工验收。</p>
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={chargeConfirmed} onChange={e => setChargeConfirmed(e.target.checked)} />确认本次镜头生成及供应商计费</label>
          <button type="button" disabled={!props.configured || avatarMode === 'cinematic' || !chargeConfirmed || !shot.presenterId || !shot.narration.trim()} onClick={() => { setChargeConfirmed(false); props.onGenerate(); }} className="rounded-lg bg-accent px-4 py-2 text-xs text-white disabled:opacity-40">{props.busy ? '提交中…' : avatarMode === 'cinematic' ? '等待接入运镜接口' : '生成新候选'}</button>
        </div>}
      </fieldset>
      {[props.error, ...shotBlockers(shot, props.context)].filter(Boolean).map((message, index) => <p role="alert" key={`${index}:${message}`} className="mt-2 text-xs text-red-600">{message}</p>)}
      {(props.jobs.length > 0 || shot.candidates.length > 0) && <div className="mt-4 space-y-2"><h3 className="text-sm font-bold">生成版本</h3>
        {props.jobs.map(job => <div key={job.id} className="rounded-lg border p-2 text-xs">{job.error?.startsWith('供应商已生成') ? '已生成 · 待入库核验' : ({ submitting: '正在提交', pending: '生成处理中', completed: '候选已就绪', failed: '生成失败', uncertain: '提交结果待核对' }[job.status])} {job.error}
          {job.status === 'pending' && job.error && <p className="mt-1 text-text-muted">已暂停自动重查。处理问题后可手动刷新原任务，不会重新付费生成。</p>}
          <button type="button" disabled={props.refreshingJobIds?.includes(job.id)} onClick={() => props.onRefresh(job.id)} className="ml-2 text-accent disabled:opacity-40">{props.refreshingJobIds?.includes(job.id) ? '正在核验…' : '刷新原任务'}</button></div>)}
        {shot.candidates.map((candidate, index) => <div key={candidate.id} className="flex justify-between rounded-lg border p-2 text-xs"><span>V{index + 1} · {candidate.source} {candidate.fingerprint !== shotFingerprint(shot, props.context) ? '· 要求已变化' : ''} {!avatarCandidateReady(candidate, props.jobs) ? '· 任务未完成或待核验' : ''}</span><button type="button" disabled={shot.locked || candidate.fingerprint !== shotFingerprint(shot, props.context) || !avatarCandidateReady(candidate, props.jobs)} onClick={() => props.onAdopt(candidate.id)} className="text-accent disabled:opacity-40">{shot.adoptedId === candidate.id ? '当前采用' : '采用 / 恢复'}</button></div>)}
      </div>}
      <details data-presenter-assets className="mt-5 rounded-xl border bg-white p-3"><summary className="cursor-pointer text-xs font-bold">人物资产与高级设置</summary>
        <select aria-label="企业默认出镜偏好" value={defaults.preference} onChange={async e => { try { await props.onDefaults({ ...defaults, preference: e.target.value as ProductionDefaults['preference'] }); } catch (error) { setDefaultsError(String(error)); } }} className="my-2 w-full rounded-lg border p-2 text-xs"><option value="auto">AI推荐</option><option value="avatar">优先数字人</option><option value="real">优先真人实拍</option><option value="none">不出镜</option></select>
        {defaults.presenters.map(item => <div key={item.id} className="my-2 flex justify-between text-xs"><span>{item.name}</span><button type="button" onClick={async () => { try { await props.onDefaults({ ...defaults, defaultPresenterId: item.id }); } catch (error) { setDefaultsError(String(error)); } }}>{defaults.defaultPresenterId === item.id ? '默认人物' : '设为默认'}</button></div>)}
        <p className="my-2 text-xs text-text-muted">与企业知识库共用人物资产，可在当前页面创建或导入。</p>
        <button type="button" disabled={props.busy} onClick={() => { setManagerMode('quick'); setManagerOpen(true); }} className="rounded-lg border px-3 py-2 text-xs">管理企业人物</button>
        {defaultsError && <p role="alert" className="mt-2 text-xs text-red-600">{defaultsError}</p>}
      </details>
    </section>
    {managerOpen && <PresenterManager initialMode={managerMode} onClose={() => setManagerOpen(false)} onSaved={props.onDefaults} />}
  </div>;
}
