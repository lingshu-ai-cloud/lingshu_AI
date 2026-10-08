import { useState } from 'react';
import type { DigitalHumanRequirements } from '../../lib/digitalHumanPlan';

export default function StudioReviewIssueActions({ digital, requirements, presenterId, presenters, products, productIds, busy, submitted = false,
  onSaveDigital, onSaveProducts, onUpload, onChangeType, onAction }: {
  digital: boolean; requirements?: DigitalHumanRequirements; presenterId: string;
  presenters: Array<{ id: string; name: string; authorized?: boolean }>;
  products: Array<{ id: string; label: string; imageUrls?: string[] }>; productIds: string[]; busy: boolean; submitted?: boolean;
  onSaveDigital: (value: DigitalHumanRequirements, presenterId: string) => Promise<void>;
  onSaveProducts: (ids: string[]) => Promise<void>; onUpload: (productId: string, file: File) => Promise<void>;
  onChangeType: (type: 'factory' | 'product' | 'consumer_demo') => Promise<void>;
  onAction: (action: string) => void | Promise<void>;
}) {
  const [person, setPerson] = useState(presenterId);
  const [route, setRoute] = useState<'replicate' | 'talking'>(requirements?.method === 'talking' ? 'talking' : 'replicate');
  const [acceptTalking, setAcceptTalking] = useState(false);
  const [ids, setIds] = useState(productIds);
  const [sceneType, setSceneType] = useState<'factory' | 'product' | 'consumer_demo'>('factory');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const run = async (action: () => Promise<void>, success: string) => {
    setWorking(true); setMessage(''); setError('');
    try { await action(); setMessage(success); } catch (e) { setError(e instanceof Error ? e.message : '处理失败，请重试'); }
    finally { setWorking(false); }
  };
  const disabled = busy || working;
  const button = 'w-full rounded-lg border border-border bg-white px-3 py-2 text-left text-xs font-bold disabled:opacity-50';
  return <div className="space-y-3">
    {digital && requirements ? <>
      <label className="block text-xs font-bold">制作方案<select className="mt-2 w-full rounded-lg border p-2" value={route} disabled={disabled} onChange={e => setRoute(e.target.value as typeof route)}><option value="replicate">照片人物复刻 · 保留动作与构图</option><option value="talking">普通口播 · 修改画面要求</option></select></label>
      <label className="block text-xs font-bold">企业人物<select className="mt-2 w-full rounded-lg border p-2" value={person} disabled={disabled} onChange={e => setPerson(e.target.value)}><option value="">请选择已授权人物</option>{presenters.filter(p => p.authorized).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      {route === 'replicate' ? <p className="text-xs leading-5 text-text-muted">保留当前动作和场景要求。保存后需核对人物照片、原片逐句参考和目标首帧；服务预检通过后才能生成。</p> : <label className="flex gap-2 text-xs leading-5"><input type="checkbox" checked={acceptTalking} disabled={disabled} onChange={e => setAcceptTalking(e.target.checked)} />我确认取消原镜头动作、场景和画面保留要求，改为普通口播。</label>}
      <button type="button" className={button} disabled={disabled || !person || route === 'talking' && !acceptTalking} onClick={() => void run(() => onSaveDigital({ ...requirements, method: route === 'replicate' ? 'reenact' : 'talking', presenterMode: route === 'replicate' ? 'photo_talking' : 'video_twin', workflow: route === 'replicate' ? 'viral_replication' : 'material_processing', replicationMode: 'sentence_first_frame', preferredProvider: route === 'replicate' ? 'sd' : 'auto', presenterSelected: true, contentConfirmed: true, ...(route === 'talking' ? { action: '', scene: '', preserve: '' } : {}) }, person), '制作方案已确认，请生成素材并验收以完成此卡片。')}>确认并保存制作方案</button>
      <button type="button" className={button} disabled={disabled || submitted || !requirements.contentConfirmed || requirements.method !== (route === 'replicate' ? 'reenact' : 'talking') || person !== presenterId} onClick={() => void run(async () => { await onAction('generate-digital'); }, '任务已提交，等待生成完成后验收素材。')}>{working ? '正在提交生成任务…' : submitted ? '任务已提交，等待生成' : '生成本镜素材'}</button>
      <details className="rounded-lg border border-border bg-white p-3 text-xs"><summary className="cursor-pointer font-bold text-text-secondary">更多配置</summary><div className="mt-3 space-y-3">
      <button type="button" className={button} disabled={disabled} onClick={() => onAction('configure')}>核对人物照片、参考与首帧</button>
      <details className="text-xs"><summary className="cursor-pointer font-bold">这不是数字人分镜？修正素材类型</summary><select aria-label="修正分镜素材类型" className="my-2 w-full rounded-lg border p-2" value={sceneType} disabled={disabled} onChange={e => setSceneType(e.target.value as typeof sceneType)}><option value="factory">工厂 / 实验室场景</option><option value="product">产品展示</option><option value="consumer_demo">使用 / 操作展示</option></select><button type="button" className={button} disabled={disabled} onClick={() => void run(() => onChangeType(sceneType), '素材类型已修正，原生成候选已失效，请重新匹配素材。')}>确认修改素材类型</button></details>
      </div></details>
    </> : <>
      <p className="text-xs font-bold">本镜头产品</p>
      {!ids.length && <p className="text-xs text-amber-700">请展开“调整产品对应关系”选择产品。</p>}
      {products.filter(product => ids.includes(product.id)).map(product => <div key={product.id} className="space-y-2 rounded-lg border bg-white p-2">
        <p className="text-xs font-bold">{product.label}</p>
        <p className="text-[11px] text-text-muted">{product.imageUrls?.length ? `已有 ${product.imageUrls.length} 张图片（生成前仍需检查可读取性）` : '尚无产品图片'}</p>
        <details open={!product.imageUrls?.length} className="text-xs"><summary className="cursor-pointer text-text-secondary">补充产品图片</summary><label className="mt-2 block text-xs">选择图片<input aria-label={`上传${product.label}图片`} type="file" accept="image/*" disabled={disabled} className="mt-1 w-full text-[10px]" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(() => onUpload(product.id, file), '产品图片已保存，请核对对应关系后重新生成首帧。'); }} /></label></details>
      </div>)}
      <details className="rounded-lg border border-border bg-white p-3 text-xs"><summary className="cursor-pointer font-bold text-text-secondary">调整产品对应关系</summary><div className="mt-3 space-y-3">
        {products.map(product => <label key={product.id} className="flex gap-2 text-xs"><input type="checkbox" disabled={disabled} checked={ids.includes(product.id)} onChange={e => setIds(current => e.target.checked ? [...current, product.id] : current.filter(id => id !== product.id))} />{product.label}</label>)}
      <button type="button" className={button} disabled={disabled || !ids.length} onClick={() => void run(() => onSaveProducts(ids), '产品对应关系已保存，请重新生成首帧。')}>保存产品对应关系</button>
      </div></details>
      <button type="button" className={button} disabled={disabled || ids.slice().sort().join('|') !== productIds.slice().sort().join('|') || !ids.length || ids.some(id => !products.find(p => p.id === id)?.imageUrls?.length)} onClick={() => onAction('retry')}>重新生成首帧</button>
    </>}
    <details className="rounded-lg border border-border bg-white p-3 text-xs"><summary className="cursor-pointer font-bold text-text-secondary">其他处理方式</summary><div className="mt-3 space-y-2">
    <button type="button" className={button} disabled={disabled} onClick={() => onAction('select-material')}>选择企业素材</button>
    <button type="button" className={button} disabled={disabled} onClick={() => void run(async () => { await onAction('shoot'); }, '补拍任务已创建；上传并验收素材后才可进入成片。')}>列入待拍</button>
    </div></details>
    {working && <p role="status" className="text-xs text-sky-700">正在处理，请稍候…</p>}
    {message && <p role="status" className="text-xs text-emerald-700">{message}</p>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </div>;
}
