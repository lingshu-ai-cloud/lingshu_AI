import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Alert, Button, Descriptions, Input, InputNumber, Select } from 'antd';
import { platformAdsApi, platformAdsRequest, type PlatformAdTask } from '../lib/platformAds';
import type { AdPlanConfiguration } from '../lib/platformAdsDomain';
import { productionNavigationIdentity } from '../lib/productionNavigation';
import { adMarketSummary } from '../../shared/metaMessageChoice';
import { metaNeedsWebsite } from '../../shared/metaAdJourney';
import { META_AD_GOALS } from '../../shared/metaAdObjectives';
import type { PlatformAdCreative } from '../../shared/platformAdCreatives';
import AdPlanAccountPicker from './AdPlanAccountPicker';
import AdMaterialPicker from './AdMaterialPicker';
import AdCountrySelect from './AdCountrySelect';
import MetaTargetingFields from './MetaTargetingFields';
import { MetaPageSelect } from './MetaPlanAuditPanel';
import MetaLeadFields, { emptyMetaLeadFields } from './MetaLeadFields';
import AdCreativePanel from './AdCreativePanel';

export type AdConversationForm = { name: string; video: string; goal: string; market: string; budget: string; currency: 'USD' | 'CNY'; channels: string[]; configuration: AdPlanConfiguration };
type Connection = { id: string; name: string; provider: string; currency: string; status: string };
const questions = ['这次使用哪个广告账户？', '推广哪条视频，希望达成什么目标？', '面向哪些市场和人群？', '客户看见什么文案，点击后去哪里？', '预算和投放时间怎么安排？', '请核对这份方案，是否保存并继续准备执行？', '请确认已上传素材和承接资产。', '最后确认执行方式和授权范围，是否加入队列？'];
export default function AdPlanConversationCreate({ value: form, onChange, onSaved, onBusy, onManual, onDone, saveOnly = false }: {
  value: AdConversationForm; onChange: Dispatch<SetStateAction<AdConversationForm>>;
  onSaved: (task: PlatformAdTask) => void; onBusy: (busy: boolean) => void; onManual: () => void; onDone: (task: PlatformAdTask, queued: boolean) => void;
  saveOnly?: boolean;
}) {
  const [step, setStep] = useState(0), [answers, setAnswers] = useState<string[]>([]);
  const [task, setTask] = useState<PlatformAdTask>(), [creative, setCreative] = useState<PlatformAdCreative>();
  const [connections, setConnections] = useState<Connection[]>([]), [allowed, setAllowed] = useState<string[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false);
  const [pageId, setPageId] = useState(''), [lead, setLead] = useState({ ...emptyMetaLeadFields });
  const [leadReady, setLeadReady] = useState(false), [launchMode, setLaunchMode] = useState<'create_paused' | 'create_and_activate'>('create_paused');
  const [expiresAt, setExpiresAt] = useState(() => new Date(Date.now() + 86400000).toISOString());
  const identity = useRef(productionNavigationIdentity()), saving = useRef(false);
  const valid = () => identity.current === productionNavigationIdentity();
  const adoptTask = (updated: PlatformAdTask) => {
    setTask(updated);
    onChange(old => ({ ...old, name: updated.name, video: updated.video, goal: updated.goal, market: updated.market, budget: String(updated.budget), currency: updated.currency, channels: updated.channels, configuration: { ...updated.configuration } }));
    onSaved(updated);
  };
  useEffect(() => {
    const c = new AbortController();
    platformAdsRequest<{ items: Connection[]; releasePolicy?: { allowedActions: string[]; executionProviders: string[] } }>('/connections', { signal: c.signal }).then(result => {
      if (!c.signal.aborted && valid()) { setConnections(result.items); setAllowed(result.releasePolicy?.executionProviders.includes('meta') ? result.releasePolicy.allowedActions : []); }
    }).catch(reason => { if (!c.signal.aborted) setError(reason.message); });
    return () => c.abort();
  }, [form.configuration.accountConnectionId]);
  const update = (patch: Partial<AdPlanConfiguration>) => onChange(old => ({ ...old, configuration: { ...old.configuration, ...patch } }));
  const account = connections.find(c => c.id === form.configuration.accountConnectionId);
  const displayTime = (value: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN') : '未设置';
  const summary = [account?.name || '已选账户', `${form.video} · ${form.goal}`, `${adMarketSummary(form.configuration.countries || [])} · ${form.channels.join('、')}`, form.configuration.adMessage || '', `${form.currency} ${form.budget}，日预算 ${form.configuration.dailyBudget}；${displayTime(form.configuration.startsAt)} 至 ${form.configuration.endsAt ? displayTime(form.configuration.endsAt) : '持续投放'}`];
  const canContinue = step === 0 ? !!form.configuration.accountConnectionId
    : step === 1 ? !!form.configuration.materialSource && !!form.goal
    : step === 2 ? !!form.configuration.countries?.length && form.channels.length > 0
    : step === 3 ? !!form.configuration.adMessage?.trim() && (!metaNeedsWebsite(form.goal) || /^https:\/\//.test(form.configuration.landingPageUrl || ''))
    : step === 4 ? Number(form.budget) >= 1 && Number(form.configuration.dailyBudget) >= 1 && Number(form.configuration.dailyBudget) <= Number(form.budget) && !!form.configuration.startsAt && (!form.configuration.endsAt || Date.parse(form.configuration.endsAt) > Date.parse(form.configuration.startsAt))
    : step === 6 ? !!creative && creative.taskVersion === task?.version && !!pageId && (!['获取消息会话', '获取Meta表单线索', '获取独立站询盘'].includes(form.goal) || leadReady) : true;
  const begin = () => { if (saving.current || !valid()) return false; saving.current = true; setBusy(true); onBusy(true); setError(''); return true; };
  const finish = () => { saving.current = false; setBusy(false); onBusy(false); };
  const savePlan = async () => {
    if (!begin()) return;
    try {
      const config = form.configuration;
      const saved = await platformAdsApi.generatePlan({ ...form, name: form.name.trim() || `${form.goal} · ${adMarketSummary(config.countries || [])}`.slice(0, 80), market: adMarketSummary(config.countries || []), entry: 'ai_assisted',
        configuration: { ...config, startsAt: new Date(config.startsAt).toISOString(), endsAt: config.endsAt ? new Date(config.endsAt).toISOString() : '', landingPageUrl: metaNeedsWebsite(form.goal) ? config.landingPageUrl : '' } });
      if (valid()) { adoptTask(saved); if (saveOnly) onDone(saved, false); else setStep(6); }
    } catch (reason) {
      if (valid()) { const status = (reason as { status?: number }).status; setUnknown(!status || status >= 500); setError('计划尚未确认保存成功：' + (reason as Error).message + '。结果不明时请到计划管理核对，避免重复创建。'); }
    } finally { finish(); }
  };
  const enqueue = async () => {
    if (!task || !creative || !begin()) return;
    try {
      const result = await platformAdsRequest<{ task: PlatformAdTask; launch: { id: string; status: string } }>(`/tasks/${encodeURIComponent(task.id)}/conversation-launch`, { method: 'POST', body: JSON.stringify({ expectedVersion: task.version, creativeId: creative.id, pageId, lead, launchMode, expiresAt }) });
      if (valid()) { onSaved(result.task); onDone(result.task, true); }
    } catch (reason) {
      if (valid()) { setUnknown(true); setError(`计划「${task.name}」已保存，入队结果尚未确认：${(reason as Error).message}。请在计划管理核对原记录，不要重新创建。`); }
    } finally { finish(); }
  };
  const next = () => { setAnswers(old => [...old.slice(0, step), summary[step] || '素材与承接资产已确认']); setStep(step + 1); setError(''); };
  const config = form.configuration;
  return <section className="space-y-4 min-w-0" aria-label="对话创编投放计划">
    {!saveOnly && <div className="flex items-center justify-between gap-3"><p>逐项确认，最后由你决定保存草稿或加入执行队列。</p><Button type="link" disabled={busy || !!task || unknown} onClick={onManual}>改为手动填写</Button></div>}
    {answers.length > 0 && <details open={step < 5 ? true : undefined}><summary className="cursor-pointer text-sm text-text-secondary">已确认内容（可展开查看）</summary><div className="mt-3 space-y-3">{answers.slice(0, Math.min(step, 5)).map((answer, index) => <div key={index} className="space-y-2"><p className="text-sm text-text-secondary">{questions[index]}</p><button type="button" disabled={!!task || busy || unknown} className="rounded-xl bg-surface-2 px-4 py-3 text-left text-sm" onClick={() => setStep(index)} aria-label={`修改：${questions[index]}`}>{answer || '已确认'}</button></div>)}</div></details>}
    <p className="rounded-xl bg-surface-2 px-4 py-3 font-medium" aria-live="polite">{saveOnly && step === 5 ? '请核对以上信息，确认无误后创建这条计划。' : questions[step]}</p>
    {error && <Alert type="warning" showIcon title={error}/>}
    <fieldset disabled={busy || unknown} className="space-y-4 min-w-0">
      {step === 0 && <AdPlanAccountPicker currency={form.currency} value={config.accountConnectionId} onCurrencyChange={currency => onChange(old => ({ ...old, currency }))} onChange={accountConnectionId => { setPageId(''); setLead({ ...emptyMetaLeadFields }); onChange(old => ({ ...old, configuration: { ...old.configuration, accountConnectionId, metaMessage: undefined, ...(old.configuration.metaTargeting ? { metaTargeting: { ...old.configuration.metaTargeting, customAudiences: [] } } : {}) } })); }}/>}
      {step === 1 && <><AdMaterialPicker value={config.materialSource} onChange={materialSource => onChange(old => ({ ...old, video: materialSource?.name || '', configuration: { ...old.configuration, materialSource } }))}/><label className="flex flex-col gap-2">推广目标<Select className="w-full" value={form.goal} options={META_AD_GOALS.map(goal => ({ value: goal, label: goal }))} onChange={goal => onChange(old => ({ ...old, goal, configuration: { ...old.configuration, ...(goal !== '获取消息会话' ? { metaMessage: undefined } : {}), landingPageUrl: metaNeedsWebsite(goal) ? old.configuration.landingPageUrl : '' } }))}/></label><Input aria-label="计划名称" value={form.name} maxLength={80} placeholder="计划名称（可选）" onChange={e => onChange(old => ({ ...old, name: e.target.value }))}/></>}
      {step === 2 && <><AdCountrySelect value={config.countries || []} onChange={countries => update({ countries })}/><label className="flex flex-col gap-2">投放渠道<Select mode="multiple" className="w-full" value={form.channels} options={['Facebook', 'Instagram'].map(value => ({ value, label: value }))} onChange={channels => onChange(old => ({ ...old, channels }))}/></label><MetaTargetingFields value={config.metaTargeting} connectionId={config.accountConnectionId} channels={form.channels} onChange={metaTargeting => update({ metaTargeting })}/></>}
      {step === 3 && <><Input.TextArea aria-label="广告文案" rows={4} maxLength={2000} value={config.adMessage} placeholder="确认客户看到的广告文案" onChange={e => update({ adMessage: e.target.value })}/>{metaNeedsWebsite(form.goal) && <Input aria-label="落地页地址" value={config.landingPageUrl} placeholder="https://" onChange={e => update({ landingPageUrl: e.target.value })}/>}<p className="text-sm text-text-secondary">消息渠道、表单或数据源将在素材准备后从当前账户真实资产中确认。</p></>}
      {step === 4 && <><label className="flex flex-col gap-2">总预算（{form.currency}）<InputNumber min={1} max={1000000} value={form.budget ? Number(form.budget) : null} onChange={budget => onChange(old => ({ ...old, budget: budget == null ? '' : String(budget) }))}/></label><label className="flex flex-col gap-2">日预算（{form.currency}）<InputNumber min={1} max={Number(form.budget) || undefined} value={config.dailyBudget} onChange={dailyBudget => update({ dailyBudget })}/></label><label className="flex flex-col gap-2">开始时间（本机时区）<Input type="datetime-local" value={config.startsAt} onChange={e => update({ startsAt: e.target.value })}/></label><label className="flex flex-col gap-2">结束时间（本机时区，可选）<Input type="datetime-local" value={config.endsAt} onChange={e => update({ endsAt: e.target.value })}/></label></>}
      {(step === 5 || step === 7) && <Descriptions column={1} size="small" items={summary.map((children, index) => ({ key: index, label: ['账户', '素材与目标', '市场与渠道', '广告文案', '预算与排期'][index], children }))}/>}
      {step === 6 && task && <><Alert type="info" title="方案已保存，尚未入队" description="使用现有素材绑定与上传流程；上传仅准备素材，最终确认后才提交广告创建任务。"/><AdCreativePanel task={task} connections={connections} onUpdate={updated => { adoptTask(updated); setCreative(undefined); }} onUse={setCreative} uploadAllowed={allowed.includes('create')}/>{creative && <p>已确认素材：{creative.name}</p>}<MetaPageSelect connectionId={config.accountConnectionId || ''} value={pageId} onChange={setPageId}/><MetaLeadFields key={`${pageId}:${form.goal}`} goal={form.goal} value={lead} onChange={setLead} onAvailability={setLeadReady} connectionId={config.accountConnectionId} pageId={pageId}/><Button onClick={() => { if (task) onDone(task, false); }}>保存草稿，稍后在计划管理执行</Button></>}
      {step === 7 && <><label className="flex flex-col gap-2">执行方式<Select className="w-full" value={launchMode} onChange={setLaunchMode} options={[{ value: 'create_paused', label: '创建为暂停，不自动启用' }, { value: 'create_and_activate', label: '创建并启动投放，可能产生真实消耗', disabled: !allowed.includes('activate') }]}/></label><label className="flex flex-col gap-2">本次创建授权截止时间<Input type="datetime-local" value={new Date(Date.parse(expiresAt) - new Date(expiresAt).getTimezoneOffset() * 60000).toISOString().slice(0,16)} onChange={e => { if (e.target.value) setExpiresAt(new Date(e.target.value).toISOString()); }}/></label><p>仅授权当前账户按已确认日预算与总预算创建{launchMode === 'create_and_activate' ? '并启动' : '暂停'}广告，不授权自动调价。额度：{form.currency} {config.dailyBudget}/日，总额 {form.budget}。</p></>}
    </fieldset>
    <div className={`flex flex-wrap gap-2${saveOnly ? ' justify-end' : ''}`}>
      {step > 0 && step < 6 && <Button disabled={busy || unknown} onClick={() => setStep(step - 1)}>修改上一项</Button>}
      {step < 5 ? <Button color="blue" variant="solid" disabled={!canContinue || unknown} onClick={next}>确认，继续</Button> : step === 5 ? <Button color="blue" variant="solid" loading={busy} disabled={unknown} onClick={() => void savePlan()}>{saveOnly ? '创建一条新计划' : '确认方案并准备执行'}</Button> : step === 6 ? <Button type="primary" disabled={!canContinue || unknown} onClick={next}>确认素材与承接资产</Button> : <><Button disabled={busy || unknown} onClick={() => setStep(6)}>修改承接资产</Button><Button type="primary" loading={busy} disabled={unknown || !allowed.includes('create') || launchMode === 'create_and_activate' && !allowed.includes('activate') || Date.parse(expiresAt) <= Date.now()} onClick={() => void enqueue()}>确认创编并加入队列</Button></>}
      {unknown && <Button onClick={() => { const url = new URL(window.location.href); url.searchParams.delete('create'); url.searchParams.set('page', 'adsPlans'); if (task) url.searchParams.set('adsTaskId', task.id); window.location.assign(url); }}>到计划管理核对原记录</Button>}
    </div>
  </section>;
}
