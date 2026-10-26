import { openScriptLibrary } from '../../lib/contentActionNavigation';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Select, Spin } from 'antd';
import { LsFlowDialog } from '../ui/LsExperiencePrimitives';
import { authHeader, AUTH_TOKEN_CHANGED_EVENT } from '../../lib/auth';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import { BUSINESS_SCENES, REWRITE_PLATFORMS, defaultBusinessPeriod, sceneSelectionSchema, rewriteSaveSchema,
  type BusinessSceneId, type BusinessSceneOptions, type BusinessSceneSelection } from '../../../shared/contracts/assistantBusinessScene';
import type { z } from 'zod';
type RewriteDraft = Omit<z.infer<typeof rewriteSaveSchema>, 'requestId'>;
async function readJson(response: Response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || '资料读取未完成，请稍后重试。');
  return result;
}
export default function AssistantBusinessSceneDialog({ sceneId, onClose, onConfirm }: {
  sceneId: BusinessSceneId; onClose: () => void; onConfirm: (selection: BusinessSceneSelection) => void;
}) {
  const [options, setOptions] = useState<BusinessSceneOptions | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const [from, setFrom] = useState(() => defaultBusinessPeriod(sceneId).from), [to, setTo] = useState(() => defaultBusinessPeriod(sceneId).to);
  const [customerId, setCustomerId] = useState<string>(), [adTaskId, setAdTaskId] = useState<string>();
  const [sourceScriptId, setSourceScriptId] = useState<string>(), [platforms, setPlatforms] = useState<string[]>([]), [language, setLanguage] = useState('');
  const [draft, setDraft] = useState<RewriteDraft | null>(null), [savedIds, setSavedIds] = useState<string[]>([]), [unconfirmed, setUnconfirmed] = useState(false);
  const authority = useRef(productionNavigationIdentity()), active = useRef(true), saveRequest = useRef<z.infer<typeof rewriteSaveSchema> | null>(null);
  const current = () => active.current && authority.current === productionNavigationIdentity();
  useEffect(() => {
    active.current = true; const controller = new AbortController(); setBusy(true); setError('');
    void fetch(`/api/overseas/strategy/business-scene-options?sceneId=${encodeURIComponent(sceneId)}`, { headers: authHeader(), cache: 'no-store', signal: controller.signal })
      .then(readJson).then(value => { if (current()) setOptions(value); }).catch(e => { if (current() && !controller.signal.aborted) setError(e.message); })
      .finally(() => { if (current()) setBusy(false); });
    const reset = () => { active.current = false; controller.abort(); onClose(); };
    const storage = (event: StorageEvent) => { if (!event.key || event.key === 'overseas_token') reset(); };
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, reset); window.addEventListener('storage', storage);
    return () => { active.current = false; controller.abort(); window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, reset); window.removeEventListener('storage', storage); };
  }, [sceneId, revision]);
  const confirm = () => {
    const result = sceneSelectionSchema.safeParse({ sceneId, from, to, ...(customerId ? { customerId } : {}), ...(adTaskId ? { adTaskId } : {}) });
    if (!result.success) { setError(result.error.issues[0]?.message || '请补齐查询条件。'); return; }
    onConfirm(result.data);
  };
  const generate = async () => {
    if (busy) return;
    if (!sourceScriptId || !platforms.length || !language.trim()) { setError('请选择源脚本、目标平台并填写输出语言。'); return; }
    setBusy(true); setError('');
    try {
      const result = await readJson(await fetch('/api/overseas/strategy/platform-rewrite', { method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceScriptId, platforms, language }) }));
      const checked = rewriteSaveSchema.parse({ ...result, requestId: crypto.randomUUID() });
      if (current()) { const { requestId: _id, ...value } = checked; setDraft(value); saveRequest.current = null; setUnconfirmed(false); }
    } catch (e) { if (current()) setError(e instanceof Error ? e.message : '改写未完成'); }
    finally { if (current()) setBusy(false); }
  };
  const save = async () => {
    if (!draft || busy) return;
    const checked = rewriteSaveSchema.safeParse(saveRequest.current || { ...draft, requestId: crypto.randomUUID() });
    if (!checked.success) { setError('请补齐每个平台的标题和口播正文。'); return; }
    saveRequest.current = checked.data;
    setBusy(true); setError('');
    try {
      const result = await readJson(await fetch('/api/overseas/strategy/platform-rewrite/save', { method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify(saveRequest.current) }));
      if (!current()) return;
      if (result.status === 'saved' && result.pending?.length === 0 && result.saved?.length === draft.variants.length) { setSavedIds(result.saved.map((v: { id: string }) => v.id)); setUnconfirmed(false); }
      else { setUnconfirmed(true); setError('部分版本尚未核对保存结果；再次核对会沿用同一请求，不重复创建。'); }
    } catch (e) { if (current()) { setUnconfirmed(true); setError(e instanceof Error ? e.message : '保存结果尚未确认'); } }
    finally { if (current()) setBusy(false); }
  };
  const rewrite = sceneId === 'CO-07';
  return <LsFlowDialog open title={BUSINESS_SCENES[sceneId]} width={rewrite ? 760 : 600} current={savedIds.length ? 2 : draft ? 1 : 0}
    steps={rewrite ? [{ title: '选择源稿与平台' }, { title: '编辑确认' }, { title: '保存草稿' }] : [{ title: '确认对象与日期' }, { title: '对话分析' }]}
    onCancel={onClose} closable={!busy} keyboard={!busy} maskClosable={!busy} footer={<>
      <Button disabled={busy} onClick={onClose}>{savedIds.length ? '完成' : '取消'}</Button>
      {!savedIds.length && <Button type="primary" disabled={!options} loading={busy} onClick={() => void (rewrite ? draft ? save() : generate() : confirm())}>{rewrite ? draft ? unconfirmed ? '核对保存结果' : '确认保存到脚本库' : '生成平台版本' : '开始分析'}</Button>}
      {savedIds.length > 0 && <Button onClick={() => { onClose(); openScriptLibrary({ tab: 'studio', projectId: savedIds[0], openDetail: true }); }}>查看脚本库</Button>}
    </>}>
    {error && <Alert className="mb-3" type="error" showIcon title={error} action={!options ? <Button onClick={() => setRevision(v => v + 1)}>重新读取</Button> : undefined}/>}
    {!options ? <Spin/> : savedIds.length ? <Alert type="success" showIcon title={`已保存${savedIds.length}个平台草稿`} description="各版本已写入并读回核对；原稿保留，尚未发布或启动制作。"/> : draft ? <div className="space-y-5">
      {draft.variants.map((variant, index) => <section key={variant.platform} className="space-y-2 rounded-lg border border-border p-3">
        <h3>{variant.platform}</h3><p className="text-sm text-text-secondary">{variant.rationale}</p>
        {(['title', 'script', 'caption'] as const).map(field => <label key={field} className="block">{{ title: '标题', script: '口播正文', caption: '发布配文' }[field]}
          <Input.TextArea aria-label={`${variant.platform}${field}`} value={variant[field]} disabled={busy || unconfirmed} maxLength={field === 'title' ? 200 : field === 'caption' ? 4000 : 12000} autoSize={{ minRows: field === 'title' ? 1 : 3, maxRows: 8 }} onChange={event => {
            setDraft({ ...draft, variants: draft.variants.map((v, i) => i === index ? { ...v, [field]: event.target.value } : v) }); saveRequest.current = null;
          }}/></label>)}
      </section>)}
    </div> : <div className="space-y-4">
      {rewrite ? <>
        <label className="block">源脚本<Select aria-label="源脚本" className="mt-2 w-full" showSearch optionFilterProp="label" value={sourceScriptId} options={options.scripts.map(x => ({ value: x.id, label: x.label }))} onChange={setSourceScriptId}/></label>
        <label className="block">目标平台<Select aria-label="目标平台" className="mt-2 w-full" mode="multiple" value={platforms} options={REWRITE_PLATFORMS.map(value => ({ value, label: value }))} onChange={setPlatforms}/></label>
        <label className="block">输出语言<Input aria-label="输出语言" className="mt-2" maxLength={50} placeholder="例如：英语" value={language} onChange={e => setLanguage(e.target.value)}/></label>
        {!options.scripts.length && <p>脚本库暂无可读取源稿，请先保存一份脚本。</p>}
      </> : <>
        <div className="grid grid-cols-2 gap-3"><label>开始日期<Input aria-label="开始日期" type="date" value={from} onChange={e => setFrom(e.target.value)}/></label><label>结束日期<Input aria-label="结束日期" type="date" value={to} onChange={e => setTo(e.target.value)}/></label></div>
        {sceneId.startsWith('CS-') && <label className="block">客户<Select aria-label="选择分析客户" className="mt-2 w-full" allowClear showSearch optionFilterProp="label" placeholder={['CS-01', 'CS-05'].includes(sceneId) ? '全部当前授权客户，或选择一位' : '请选择一位客户'} value={customerId} options={options.customers.map(x => ({ value: x.id, label: x.label }))} onChange={setCustomerId}/></label>}
        {sceneId.startsWith('AD-') && <label className="block">投放计划<Select aria-label="选择投放计划" placeholder={'[AD-01,AD-06]'.includes(sceneId) ? '请选择计划' : '可不选，准备新计划建议'} className="mt-2 w-full" allowClear showSearch optionFilterProp="label" value={adTaskId} options={options.ads.map(x => ({ value: x.id, label: x.label }))} onChange={setAdTaskId}/></label>}
        <p className="text-sm text-text-secondary">按北京时间查询所选期间。只读取资料并给出分析或草稿，执行动作仍需在原业务流程确认。</p>
      </>}
      {options.limitations.map((note, index) => <p key={index} className="text-sm text-text-secondary">{note}</p>)}
    </div>}
  </LsFlowDialog>;
}
