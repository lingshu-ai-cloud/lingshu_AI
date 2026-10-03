import { useState, type ReactNode } from 'react';
import { cueFirstFrameTime, newDigitalHumanRequirements, referenceCues, type DigitalHumanReferenceCue, type DigitalHumanRequirements, type DigitalHumanPlan } from '../../lib/digitalHumanPlan';

export default function DigitalHumanRequirementsEditor({ value, plan, compact = false, children, referenceMaterials = [], toolCapabilities = [], onChange }: {
  children?: ReactNode; compact?: boolean; value?: DigitalHumanRequirements; plan: DigitalHumanPlan; referenceMaterials?: Array<{ id: string; name: string; url?: string }>;
  toolCapabilities?: Array<{ id: string; execution: boolean; reason: string }>;
  onChange: (value: DigitalHumanRequirements) => void;
}) {
  const [splitTimes, setSplitTimes] = useState<Record<string, string>>({});
  const current = value || newDigitalHumanRequirements();
  const reference = current.reference || { videoUrl: '', start: 0, end: 0, originalText: '', derivativeAuthorized: false };
  const patch = (change: Partial<DigitalHumanRequirements>) => onChange({ ...current, ...change, contentConfirmed: false });
  const patchReference = (change: Partial<typeof reference>) => patch({ reference: { ...reference, ...change } });
  const cues = referenceCues(current);
  const patchCue = (id: string, change: Partial<DigitalHumanReferenceCue>) => {
    const next = cues.map(cue => cue.id === id ? { ...cue, ...change } : cue);
    patchReference({ cues: next, start: Math.min(...next.map(cue => cue.start)), end: Math.max(...next.map(cue => cue.end)), originalText: next.map(cue => cue.originalText).filter(Boolean).join('\n') });
  };
  const splitCue = (cue: DigitalHumanReferenceCue) => {
    const at = Number(splitTimes[cue.id]);
    if (!Number.isFinite(at) || at <= cue.start + 0.05 || at >= cue.end - 0.05) return;
    const id = `${cue.id}-shot-${Date.now()}`;
    const clearOutput = { sourceFirstFrame: undefined, targetFirstFrame: undefined, draftFirstFrame: undefined, generatedClip: undefined, nonPersonMaterialId: undefined, compositionClusterId: undefined, composition: undefined };
    const parts: DigitalHumanReferenceCue[] = [
      { ...cue, ...clearOutput, end: at, originalText: '', targetText: '', personShot: undefined, classificationSource: 'manual', splitFromCueId: cue.splitFromCueId || cue.id },
      { ...cue, ...clearOutput, id, start: at, originalText: '', targetText: '', personShot: undefined, classificationSource: 'manual', splitFromCueId: cue.splitFromCueId || cue.id },
    ];
    const next = cues.flatMap(item => item.id === cue.id ? parts : [item]);
    patchReference({ cues: next, originalText: next.map(item => item.originalText).filter(Boolean).join('\n') });
    setSplitTimes(previous => ({ ...previous, [cue.id]: '' }));
  };
  if (compact) return <section className="space-y-4" aria-label="数字人镜头效果">
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="镜头效果">
      {([
        ['face_only', '人脸替换'],
        ['person_keep_scene', '人物替换'],
        ['person_and_scene', '人物与场景重构'],
      ] as const).map(([scope, label]) => <button key={scope} type="button" aria-pressed={current.replacementScope === scope}
        className={`min-h-12 rounded-lg border px-2 py-3 text-xs font-bold ${current.replacementScope === scope ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white'}`}
        onClick={() => patch({ workflow: 'viral_replication', replacementScope: scope, method: scope === 'person_keep_scene' ? 'replace' : 'reenact', preferredProvider: scope === 'face_only' ? 'auto' : 'sd', targetEffect: scope === 'person_and_scene' ? 'flexible_scene' : 'reference_motion', ...(scope !== 'person_and_scene' ? { scene: '' } : {}) })}>{label}</button>)}
    </div>
    {current.replacementScope && <div className="space-y-3 border-t pt-4" aria-label="效果配置">
      <p className="text-xs text-text-muted">{current.replacementScope === 'face_only'
        ? 'HeyGen · 原分镜 + 企业人脸 → 人脸替换'
        : current.replacementScope === 'person_keep_scene'
          ? 'Seedream → Seedance · 保留原场景，重建人物首帧并生成视频'
          : 'Seedream → Seedance · 重建人物与场景首帧，再生成视频'}</p>
      {children}
      {current.replacementScope === 'person_keep_scene' && <p className="text-xs text-text-muted">沿用原镜头场景与构图；生成后需检查背景一致性。</p>}
      {current.replacementScope === 'person_and_scene' && <label className="block text-xs">场景要求<textarea aria-label="场景要求" placeholder="例如：企业展厅，人物站在产品陈列柜前" rows={2} className="mt-2 w-full rounded-lg border p-2" value={current.scene} onChange={event => patch({ scene: event.target.value })} /></label>}
      {current.replacementScope === 'face_only' && <p role="status" className="text-xs text-amber-700">换脸接口尚待验证，可保存配置，暂不可生成。</p>}
      <label className="flex gap-2 text-xs"><input type="checkbox" checked={current.contentConfirmed} onChange={event => onChange({ ...current, contentConfirmed: event.target.checked })} />确认应用此人物和效果</label>
    </div>}
  </section>;
  return <section className="space-y-3 rounded-xl border border-violet-200 bg-white p-3" aria-label="数字人镜头要求">
    <p className="text-xs text-text-muted">根据人物、口播及参考画面安排制作，生成结果将作为当前分镜的候选素材。</p>
    <label className="block text-xs">内容来源<select className="mt-1 w-full rounded-lg border p-2" value={current.workflow} onChange={e => patch({ workflow: e.target.value as DigitalHumanRequirements['workflow'] })}>
      <option value="material_processing">素材加工 · 人物与口播驱动</option><option value="viral_replication">爆款裂变 · 原片逐句与人物驱动</option>
    </select></label>
    {current.workflow === 'viral_replication' && <>
      <label className="block text-xs">替换范围<select aria-label="替换范围" className="mt-1 w-full rounded-lg border p-2" value={current.replacementScope || ''} onChange={event => patch({ replacementScope: event.target.value as DigitalHumanRequirements['replacementScope'], method: event.target.value === 'person_keep_scene' ? 'replace' : 'reenact', targetEffect: undefined })}><option value="">请选择替换范围</option><option value="face_only" disabled>仅替换脸部（尚未接入）</option><option value="person_keep_scene" disabled={!toolCapabilities.some(tool => tool.id === 'local_head_pipeline' && tool.execution)}>整个人物替换，保留场景</option><option value="person_and_scene">重建人物与场景</option></select></label>
      <label className="block text-xs">目标效果<select aria-label="目标效果" className="mt-1 w-full rounded-lg border p-2" value={current.targetEffect || ''} onChange={event => { const targetEffect = event.target.value as DigitalHumanRequirements['targetEffect']; patch({ targetEffect, method: targetEffect === 'natural_talking' ? 'talking' : current.replacementScope === 'person_keep_scene' ? 'replace' : 'reenact' }); }}><option value="">请选择目标效果</option><option value="natural_talking" disabled={current.replacementScope === 'person_and_scene'}>自然口播</option><option value="reference_motion">尽量还原动作与构图</option><option value="flexible_scene">自由调整场景与产品</option></select></label>
    </>}
    {current.workflow !== 'viral_replication' && <label className="block text-xs">目标效果<select className="mt-1 w-full rounded-lg border p-2" value={current.method} onChange={e => patch({ method: e.target.value as DigitalHumanRequirements['method'] })}><option value="talking">自然口播</option><option value="replace">替换人物</option><option value="reenact">重新演绎</option></select></label>}
    {current.method !== 'talking' && <details><summary className="cursor-pointer text-xs">高级设置 · 模型</summary><label className="block text-xs">生成模型<select aria-label="数字人生成模型" className="mt-1 w-full rounded-lg border p-2" value={current.preferredProvider || 'auto'} onChange={e => patch({ preferredProvider: e.target.value as DigitalHumanRequirements['preferredProvider'] })}>
      <option value="auto">自动选择可用模型</option><option value="kling" disabled={!toolCapabilities.some(tool => tool.id === 'runway_kling_motion' && tool.execution)}>Kling</option><option value="sd" disabled={!toolCapabilities.some(tool => tool.id === 'runway_seedance' && tool.execution)}>Seedance（SD）</option><option value="runway" disabled={!toolCapabilities.some(tool => tool.id === 'runway_act_two' && tool.execution)}>Runway</option><option value="self_hosted" disabled={!toolCapabilities.some(tool => ['local_head_pipeline', 'self_hosted_video'].includes(tool.id) && tool.execution)}>自有模型</option>
    </select></label></details>}
    {current.method !== 'talking' && current.preferredProvider !== 'auto' && (() => {
      const ids = current.preferredProvider === 'kling' ? ['runway_kling_motion'] : current.preferredProvider === 'sd' ? ['runway_seedance'] : current.preferredProvider === 'runway' ? ['runway_act_two'] : ['local_head_pipeline', 'self_hosted_video'];
      const matches = toolCapabilities.filter(item => ids.includes(item.id)); const ready = matches.some(item => item.execution);
      return <p className={`text-xs ${ready ? 'text-emerald-700' : 'text-amber-700'}`}>{ready ? '该模型已注册执行能力；保存方案后仍需通过镜头约束和预算校验。' : matches.map(item => item.reason).filter(Boolean).join('；') || '该模型尚未注册真实执行适配器，仅可保存选择与制作要求。'}</p>;
    })()}
    {current.method === 'talking' && <p className="text-xs text-text-muted">HeyGen 侧重自然口播，沿用人物资产的场景。需要调整背景或产品时选择重新演绎；切换到此方式会清除自定义动作、场景和保留要求，需要重新确认内容。</p>}
    {current.workflow === 'viral_replication' && current.method === 'reenact' && <label className="block text-xs">复刻生成方式<select aria-label="爆款复刻生成方式" className="mt-1 w-full rounded-lg border p-2" value={current.replicationMode || 'sentence_first_frame'} onChange={e => patch({ replicationMode: e.target.value as DigitalHumanRequirements['replicationMode'] })}>
      <option value="sentence_first_frame">逐句首帧重建 · 默认</option><option value="direct_reference">整段原片动作参考 · 需授权</option>
    </select></label>}
    {current.workflow === 'viral_replication' && current.method === 'reenact' && (current.replicationMode || 'sentence_first_frame') === 'sentence_first_frame' && <p className="rounded-lg bg-violet-50 p-2 text-xs text-violet-800">系统按口播逐句提取原片首帧，只在企业内部分析构图与节奏；随后将首帧重建为目标人物，再按本片口播逐句生成视频。爆款原视频不会直接提交给视频生成模型。</p>}
    {(current.workflow === 'viral_replication' || current.method !== 'talking') && <div className="space-y-2 border-t pt-3">
      <h4 className="text-xs font-bold">原片对照</h4>
      <label className="block text-xs">素材库参考视频<select className="mt-1 w-full rounded-lg border p-2" value={reference.materialId || ''} onChange={e => { const selected = referenceMaterials.find(item => item.id === e.target.value); patchReference({ materialId: e.target.value || undefined, ...(selected?.url ? { videoUrl: selected.url } : {}) }); }}><option value="">未绑定素材（仅用于对照）</option>{referenceMaterials.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="block text-xs">参考视频地址<input className="mt-1 w-full rounded-lg border p-2" value={reference.videoUrl} onChange={e => patchReference({ videoUrl: e.target.value })} /></label>
      <div className="grid grid-cols-2 gap-2">{(['start', 'end'] as const).map(key => <label key={key} className="text-xs">{key === 'start' ? '原片开始（秒）' : '原片结束（秒）'}<input type="number" min="0" step="0.1" className="mt-1 w-full rounded-lg border p-2" value={reference[key]} onChange={e => patchReference({ [key]: Number(e.target.value) })} /></label>)}</div>
      <label className="block text-xs">原片对应语句<textarea rows={3} className="mt-1 w-full rounded-lg border p-2" value={reference.originalText} onChange={e => patchReference({ originalText: e.target.value })} /></label>
      {cues.length > 0 && <div className="space-y-2 rounded-lg bg-surface-2 p-2" aria-label="原片逐句与分镜映射">
        <p className="text-xs font-bold">逐句与分镜映射</p>
        {cues.map((cue, index) => <article key={cue.id} className="rounded-lg border bg-white p-2">
          <p className="text-[10px] font-bold text-text-muted">句 {index + 1} · {cue.start.toFixed(1)}–{cue.end.toFixed(1)} 秒 · 关联 {cue.shotIds.length || 1} 个分镜</p>
          <label className="mt-1 block text-xs">原片对应语句<textarea rows={2} className="mt-1 w-full rounded-lg border p-2" value={cue.originalText} onChange={e => patchCue(cue.id, { originalText: e.target.value })} placeholder="填写当前物理镜头中的原片语句" /></label>
          <div className="mt-2 flex items-end gap-2"><label className="text-xs">物理镜头切点（秒）<input type="number" min={cue.start + 0.05} max={cue.end - 0.05} step="0.01" aria-label={`句 ${index + 1} 物理镜头切点`} className="mt-1 w-28 rounded-lg border p-2" value={splitTimes[cue.id] || ''} onChange={e => setSplitTimes(previous => ({ ...previous, [cue.id]: e.target.value }))} /></label><button type="button" className="rounded-lg border px-3 py-2 text-xs" disabled={!Number.isFinite(Number(splitTimes[cue.id])) || Number(splitTimes[cue.id]) <= cue.start + 0.05 || Number(splitTimes[cue.id]) >= cue.end - 0.05} onClick={() => splitCue(cue)}>按物理镜头拆分</button></div>
          {cue.splitFromCueId && <p className="mt-1 text-xs text-amber-700">拆分后请分别填写原片语句、选择人物或非人物镜头；人物镜头必须填写本片对应语句，避免整段口播重复。</p>}
          {current.method === 'reenact' && current.presenterMode !== 'photo_talking' && cue.personShot === true && (cue.end - cue.start < 4 || cue.end - cue.start > 15) && <p role="alert" className="mt-1 text-xs text-amber-700">当前 Seedance 人物逐句镜头仅支持 4–15 秒；本段 {Math.max(0, cue.end - cue.start).toFixed(2)} 秒不会提交付费生成，请调整制作路径。</p>}
          <div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs">镜头类型<select aria-label={`句 ${index + 1} 镜头类型`} value={cue.personShot === true ? 'person' : cue.personShot === false ? 'non_person' : 'unknown'} onChange={e => patchCue(cue.id, { personShot:e.target.value==='person'?true:e.target.value==='non_person'?false:undefined, classificationSource:'manual', ...(e.target.value==='person'?{nonPersonMaterialId:undefined}:{compositionClusterId:undefined,composition:undefined}) })} className="mt-1 w-full rounded-lg border p-2"><option value="unknown">待确认</option><option value="person">人物镜头 · 需要换人首帧</option><option value="non_person">产品／工厂／B-roll · 不生人物首帧</option></select></label>
          {cue.personShot===true?<label className="text-xs">构图簇<select aria-label={`句 ${index + 1} 构图簇`} value={cue.compositionClusterId || ''} onChange={e=>patchCue(cue.id,{compositionClusterId:e.target.value})} className="mt-1 w-full rounded-lg border p-2"><option value="">请选择</option><option value="front-close">正面近景</option><option value="front-medium">正面中景</option><option value="side-medium">侧面中景</option></select></label>:cue.personShot===false?<label className="text-xs">替换视频素材<select aria-label={`句 ${index + 1} 非人物替换素材`} value={cue.nonPersonMaterialId || ''} onChange={e=>patchCue(cue.id,{nonPersonMaterialId:e.target.value})} className="mt-1 w-full rounded-lg border p-2"><option value="">请选择本企业视频</option>{referenceMaterials.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>:null}</div>
          {current.method === 'reenact' && (current.replicationMode || 'sentence_first_frame') === 'sentence_first_frame' && <div className="mt-1 flex items-center gap-2 text-[10px] text-violet-700">
            {cue.sourceFirstFrame?.imageUrl && <img src={cue.sourceFirstFrame.imageUrl} alt={`句 ${index + 1} 原片首帧`} className="h-12 w-9 rounded object-cover" />}
            {cue.draftFirstFrame?.imageUrl && <img src={cue.draftFirstFrame.imageUrl} alt={`句 ${index + 1} 千问构图草稿`} className="h-12 w-9 rounded object-cover" />}
            <span>首帧 {cueFirstFrameTime(cue).toFixed(2)} 秒 · {cue.sourceFirstFrame?.materialId ? '源首帧已提取 · ' : ''}{cue.targetFirstFrame?.state === 'ready' ? '目标人物首帧已就绪' : cue.targetFirstFrame?.state === 'failed' ? '目标人物首帧生成失败' : '待重建目标人物首帧'}</span>
          </div>}
          {cue.draftFirstFrame&&<p className="mt-1 text-[10px] text-sky-700">千问草稿已生成 · 预计 ¥{cue.draftFirstFrame.estimatedCostCny.toFixed(2)} · 仅供构图比较，最终 Seedance 输入仍由 Seedream 生成</p>}
          <label className="mt-2 block text-xs">本片对应语句<textarea rows={2} className="mt-1 w-full rounded-lg border p-2" value={cue.targetText} onChange={e => patchCue(cue.id, { targetText: e.target.value })} placeholder="默认沿用本镜头口播，可在此记录逐句改写" /></label>
        </article>)}
      </div>}
      <p className="text-xs text-text-muted">本片口播在下方「确认台词」中编辑；原片语句保留用于对照。</p>
      {current.method !== 'talking' && (['action', 'scene', 'preserve'] as const).map(key => <label key={key} className="block text-xs">{{ action: '人物动作', scene: '场景要求', preserve: '必须保留的内容' }[key]}<textarea rows={2} className="mt-1 w-full rounded-lg border p-2" value={current[key]} onChange={e => patch({ [key]: e.target.value })} /></label>)}
      {current.method === 'replace' && <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={reference.derivativeAuthorized} onChange={e => patchReference({ derivativeAuthorized: e.target.checked, ...(!e.target.checked ? { derivativeAuthorizationEvidence: '' } : {}) })} />确认源视频允许作为生成模型输入，并具有派生制作与商业使用授权</label>
        {reference.derivativeAuthorized && <label className="block text-xs">授权依据<textarea aria-label="源视频派生授权依据" maxLength={500} rows={2} className="mt-1 w-full rounded-lg border p-2" value={reference.derivativeAuthorizationEvidence || ''} onChange={e => patchReference({ derivativeAuthorizationEvidence: e.target.value })} placeholder="例如：企业自有拍摄，素材合同/授权单编号 AUTH-2026-001" /></label>}
      </div>}
      {current.method === 'reenact' && current.replicationMode === 'direct_reference' && <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={reference.modelInputAuthorized === true} onChange={e => patchReference({ modelInputAuthorized: e.target.checked, ...(!e.target.checked ? { modelInputAuthorizationEvidence: '' } : {}) })} />允许将源视频直接提交给生成模型</label>
        {reference.modelInputAuthorized && <label className="block text-xs">模型输入授权依据<textarea aria-label="源视频模型输入授权依据" maxLength={500} rows={2} className="mt-1 w-full rounded-lg border p-2" value={reference.modelInputAuthorizationEvidence || ''} onChange={e => patchReference({ modelInputAuthorizationEvidence: e.target.value })} placeholder="未获授权时保持关闭，系统只保留结构分析与方案预览" /></label>}
        {!reference.modelInputAuthorized && <p className="text-[10px] text-amber-800">当前仅用于结构分析与方案预览，不会把源视频提交给 Runway、Kling、Seedance 或其他生成供应商。</p>}
      </div>}
      <p className="text-xs text-amber-700">人物替换与重新演绎不会自动互换。{plan.state === 'preview_only' ? '当前参考人物制作仅支持方案预览。' : plan.state === 'ready' ? '执行前仍需保存方案并确认供应商计费。' : '请先补齐资料并确认当前镜头要求。'}</p>
    </div>}
    <label className="flex gap-2 text-xs"><input type="checkbox" checked={current.contentConfirmed} onChange={e => onChange({ ...current, contentConfirmed: e.target.checked })} />已确认本镜头人物、口播和画面要求</label>
    <div className="rounded-lg bg-surface-2 p-2" role="status">
      <p className="text-xs font-bold">{{ needs_input: '待补资料', needs_confirmation: '待确认内容', preview_only: '仅支持方案预览', ready: '可制作' }[plan.state]}</p>
      {plan.reasons.map(reason => <p key={reason} className="mt-1 text-xs">{reason}</p>)}
      <ol className="mt-2 list-inside list-decimal text-xs text-text-muted">{plan.steps.map(step => <li key={step}>{step}</li>)}</ol>
    </div>
  </section>;
}
