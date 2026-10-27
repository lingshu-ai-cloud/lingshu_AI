import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, InputNumber, Select } from 'antd';
import { authHeader } from '../../lib/auth';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import { platformAdsApi, type PlatformAdTask } from '../../lib/platformAds';
import { PLATFORM_AD_GOALS } from '../../../shared/platformAdCapabilities';
import type { AdMaterialSelection } from '../../../shared/platformAdCreatives';
import AdSourceCatalog from '../AdSourceCatalog';

/** A conversational front end to the existing draft API; saving never launches an ad. */
export default function AssistantAdPlanConversation() {
  const [step, setStep] = useState(0), [goal, setGoal] = useState<string>(), [market, setMarket] = useState('');
  const [channels, setChannels] = useState<string[]>([]), [budget, setBudget] = useState<number | null>(null);
  const [currency, setCurrency] = useState<'USD' | 'CNY'>('USD'), [material, setMaterial] = useState<AdMaterialSelection>();
  const [name, setName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<PlatformAdTask>(), [unknown, setUnknown] = useState(false);
  const identity = useRef(productionNavigationIdentity()), saving = useRef(false);
  const validScope = () => identity.current === productionNavigationIdentity();
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/overseas/enterprise/profile', { headers: authHeader(), signal: controller.signal }).then(async response => {
      if (!response.ok) throw Error('企业资料暂未读到，可以在这里补充目标市场。');
      return response.json();
    }).then(value => { if (validScope() && !controller.signal.aborted) {
      const profile = value.profile || value;
      setMarket(profile.strategy?.focusMarkets || profile.company?.mainMarkets || '');
      const names = ['Facebook', 'Instagram', 'TikTok', 'YouTube'];
      setChannels((profile.socialStrategy?.primaryPlatforms || []).flatMap((value: string) => names.find(name => name.toLowerCase() === value.toLowerCase()) || []));
    } }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, []);
  const save = async () => {
    if (!goal || !material || !budget || !market || !channels.length || saving.current || unknown || !validScope()) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const task = await platformAdsApi.createTask({ name: name.trim() || `${goal} · ${market}`.slice(0, 80), video: material.name.slice(0, 120),
        goal, market, channels, budget, currency, configuration: { startsAt: '', endsAt: '', dailyBudget: null, audience: '', placements: '', materialSource: material } });
      if (validScope()) setSaved(task);
    } catch (reason) {
      if (validScope()) { const status = (reason as { status?: number }).status;
        setUnknown(!status || status >= 500); setError(status && status < 500 ? (reason as Error).message : '保存结果暂未确认，请到投流计划列表核对后继续，避免重复创建。'); }
    } finally { saving.current = false; setBusy(false); }
  };
  const navigate = () => { const url = new URL(window.location.href); url.searchParams.set('page', 'adsPlans'); if (saved) url.searchParams.set('adsTaskId', saved.id); window.location.assign(url); };
  if (saved) return <section className="mt-3 space-y-2"><p>已创建「{saved.name}」草稿，预算 {saved.budget} {saved.currency}。可以继续完善账户、定向和投放时间。</p><Button onClick={navigate}>查看新计划</Button></section>;
  const canNext = step === 0 ? !!goal : step === 1 ? !!market.trim() && !!channels.length : step === 2 ? !!material : !!budget;
  return <section className="mt-3 space-y-3" aria-label="对话创建投流计划">
    {error && <Alert type="warning" title={error}/>}
    {step === 0 && <><p>这条计划最想达成什么目标？</p><Select className="w-full max-w-md" aria-label="投流目标" value={goal} placeholder="选择目标" options={PLATFORM_AD_GOALS.map(value => ({ value, label: value }))} onChange={setGoal}/></>}
    {step === 1 && <><p>准备面向这些市场和渠道，可以直接采用或修改。</p><Input aria-label="投流目标市场" value={market} maxLength={80} placeholder="目标市场" onChange={event => setMarket(event.target.value)}/><Select aria-label="投流渠道" className="w-full" mode="multiple" value={channels} options={['Facebook', 'Instagram', 'TikTok', 'YouTube'].map(value => ({ value, label: value }))} onChange={setChannels}/></>}
    {step === 2 && <><p>这次准备用哪条已有成片？{material && ` 已选：${material.name}`}</p><AdSourceCatalog onSelect={setMaterial}/></>}
    {step === 3 && <><p>这条计划的总预算是多少？</p><InputNumber aria-label="投流总预算" min={1} max={1000000} value={budget} onChange={setBudget}/><Select aria-label="预算币种" value={currency} options={[{value:'USD',label:'USD 美元'},{value:'CNY',label:'CNY 人民币'}]} onChange={setCurrency}/></>}
    {step === 4 && <><p>确认创建：{goal}；{market}；{channels.join('、')}；{budget} {currency}；素材「{material?.name}」。保存后为草稿，尚未启动投放。</p><Input aria-label="投流计划名称" placeholder={`${goal} · ${market}`} maxLength={80} value={name} onChange={event => setName(event.target.value)}/></>}
    <div className="flex flex-wrap gap-2">{step > 0 && <Button disabled={busy || unknown} onClick={() => setStep(value => value - 1)}>修改上一项</Button>}
      {step < 4 ? <Button type="primary" disabled={!canNext} onClick={() => { setError(''); setStep(value => value + 1); }}>继续</Button> : <Button type="primary" loading={busy} disabled={unknown} onClick={() => void save()}>确认创建计划草稿</Button>}
      {unknown && <Button onClick={navigate}>到计划列表核对</Button>}</div>
  </section>;
}
