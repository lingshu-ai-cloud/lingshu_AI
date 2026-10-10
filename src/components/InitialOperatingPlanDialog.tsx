import { useMemo, useState } from 'react';
import { Button } from 'antd';
import type { DigitalEmployeeConfig, PublishingTarget } from '../lib/digitalEmployees';
import { initialPlanVideoPlans, validateInitialPlan, type InitialOperatingPlan } from '../lib/initialOperatingPlan';
import { authHeader } from '../lib/auth';
import { socialProgramApi } from '../lib/socialProgramApi';
import { LsBrandAction, LsFlowDialog } from './ui/LsExperiencePrimitives';

const platforms: PublishingTarget['platform'][] = ['youtube', 'tiktok', 'instagram', 'facebook'];

export function initialHistoryAccountDefinitions(
  raw: string,
  allowedPlatforms: PublishingTarget['platform'][],
): Array<{ url: string; platform: PublishingTarget['platform'] }> {
  const definitions = raw.split(/\n/).map(value => value.trim()).filter(Boolean).map(url => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`历史账号链接无效：${url}`);
    }
    const platform = platforms.find(item => parsed.hostname === `${item}.com` || parsed.hostname.endsWith(`.${item}.com`));
    if (!platform || parsed.protocol !== 'https:') throw new Error(`请使用支持平台的 HTTPS 账号链接：${url}`);
    if (!allowedPlatforms.includes(platform)) throw new Error(`历史账号平台必须包含在本周已选平台中：${url}`);
    return { url: parsed.href, platform };
  });
  return [...new Map(definitions.map(item => [item.url, item])).values()];
}

export default function InitialOperatingPlanDialog({
  initial,
  config,
  busy,
  error,
  onConfirm,
  onBack,
}: {
  initial: InitialOperatingPlan;
  config: DigitalEmployeeConfig;
  busy: boolean;
  error: string;
  onConfirm: (plan: InitialOperatingPlan) => void;
  onBack: () => void;
}) {
  const [plan, setPlan] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyMessage, setHistoryMessage] = useState('');
  const [historyCollectionRequestId] = useState(() => crypto.randomUUID());
  const plans = useMemo(() => initialPlanVideoPlans(plan, config), [plan, config]);
  const cost = plans.filter(item => item.productionRole !== 'platform_adaptation')
    .reduce((sum, item) => sum + Number(item.estimatedCost || 0), 0);
  const historyValidation = useMemo(() => {
    if (plan.stage !== 'b2b_growth' || !history.trim()) return { items: [] as ReturnType<typeof initialHistoryAccountDefinitions>, error: '' };
    try {
      return { items: initialHistoryAccountDefinitions(history, plan.platforms), error: '' };
    } catch (historyError) {
      return { items: [] as ReturnType<typeof initialHistoryAccountDefinitions>, error: historyError instanceof Error ? historyError.message : '历史账号链接无效' };
    }
  }, [history, plan.platforms, plan.stage]);
  const errors = [...validateInitialPlan(plan), ...(historyValidation.error ? [historyValidation.error] : [])];
  const set = <K extends keyof InitialOperatingPlan>(key: K, value: InitialOperatingPlan[K]) => {
    setPlan(current => ({ ...current, [key]: value }));
  };

  async function collect() {
    if (historyBusy) return;
    setHistoryBusy(true);
    setHistoryMessage('');
    try {
      const definitions = initialHistoryAccountDefinitions(history, plan.platforms);
      if (!definitions.length) throw new Error('请填写历史账号链接，一行一个。');
      const existing = await socialProgramApi.list();
      const program = existing[0] || await socialProgramApi.create({
        brandName: config.companyName,
        market: plan.market,
        targetAudience: '企业目标买家',
        candidatePlatforms: plan.platforms,
        route: 'account_repair',
      });
      const accounts = await socialProgramApi.listAccounts(program.programId);
      const results: string[] = [];
      for (const { url, platform } of definitions) {
        if (!accounts.some(account => account.handle === url)) {
          const saved = await socialProgramApi.createAccount(program.programId, {
            platform,
            displayName: url,
            handle: url,
            businessRole: '企业自有历史账号',
            audiencePromise: '目标买家',
            contentPromise: '保留企业历史调性',
            status: 'planned',
          });
          accounts.push(saved);
        }
        const response = await fetch('/api/overseas/digital-employees/onboarding/history-collection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({ platform, accountUrl: url, requestId: historyCollectionRequestId }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || body.error || '采集失败');
        results.push(url);
      }
      setHistoryMessage(`已入库并发起 ${results.length} 个自有账号的历史采集；未授权发布。`);
    } catch (collectionError) {
      setHistoryMessage(collectionError instanceof Error ? collectionError.message : '历史账号采集失败');
    } finally {
      setHistoryBusy(false);
    }
  }

  return <LsFlowDialog
    open
    title="推荐经营计划"
    width={920}
    current={0}
    steps={[{ title: '核对经营计划' }, { title: '准备制作' }]}
    onCancel={onBack}
    getContainer={false}
    keyboard={!busy}
    closable={!busy}
    mask={{ closable: false }}
    styles={{ body: { maxHeight: '72dvh', overflowY: 'auto' } }}
    footer={[
      <Button key="back" disabled={busy} onClick={onBack}>返回配置</Button>,
      <Button key="edit" disabled={busy} onClick={() => setEditing(value => !value)}>{editing ? '完成调整' : '调整计划'}</Button>,
      <LsBrandAction key="confirm" disabled={busy || Boolean(errors.length)} loading={busy} onClick={() => onConfirm({ ...plan, historyAccounts: historyValidation.items.map(item => item.url), historyCollectionRequestId })}>{busy ? '正在确认并准备制作…' : '确认计划并开始制作'}</LsBrandAction>,
    ]}
  >
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold text-accent">准备完成 · 推荐计划</p>
        <h2 className="ls-type-title-large mt-1 text-text-primary">让数字员工开始本周制作</h2>
        <p className="mt-1 text-xs text-text-secondary">制作无需先绑定发布账号；待发布时再处理账号绑定。</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>用户画像<select value={plan.stage} onChange={event => set('stage', event.target.value as InitialOperatingPlan['stage'])} className="block w-full rounded-lg border border-border p-2"><option value="b2b_launch">B2B 零基础</option><option value="b2b_growth">B2B 有基础</option><option value="d2c_brand">B2C</option></select></label>
        <label>主推产品<input disabled={!editing} value={plan.products.join('、')} onChange={event => set('products', event.target.value.split(/[、，,]/).map(value => value.trim()).filter(Boolean))} className="block w-full rounded-lg border border-border p-2"/></label>
        <label>目标市场<input disabled={!editing} value={plan.market} onChange={event => set('market', event.target.value)} className="block w-full rounded-lg border border-border p-2"/></label>
        <label>语言<input disabled={!editing} value={plan.language} onChange={event => set('language', event.target.value)} className="block w-full rounded-lg border border-border p-2"/></label>
        <label>本周母版数<input disabled={!editing} type="number" min={1} max={30} value={plan.count} onChange={event => set('count', Number(event.target.value))} className="block w-full rounded-lg border border-border p-2"/></label>
        <label>预算上限（元）<input type="number" min={1} value={plan.budgetCapCny} onChange={event => set('budgetCapCny', Number(event.target.value))} className="block w-full rounded-lg border border-border p-2"/></label>
        <label>预计成片交付<input disabled={!editing} type="date" value={plan.deliveryDate} onChange={event => set('deliveryDate', event.target.value)} className="block w-full rounded-lg border border-border p-2"/></label>
        <p className="rounded-lg bg-surface-2 p-3 text-sm text-text-secondary">预计费用：{cost > 0 ? `约 ¥${Math.floor(cost)}–${Math.ceil(cost * 1.3)}` : '待根据真实参考与逐镜路线核算'}<br/>超出预算停止新生成并显示原因。</p>
      </div>
      <section>
        <h3 className="font-bold text-text-primary">平台、账号与本周发布量</h3>
        {platforms.map(platform => <label key={platform} className="flex flex-wrap items-center gap-2 border-b border-border py-2 last:border-0">
          <input type="checkbox" disabled={!editing} checked={plan.platforms.includes(platform)} onChange={event => set('platforms', event.target.checked ? [...plan.platforms, platform] : plan.platforms.filter(value => value !== platform))}/>
          {platform} · {config.publishingTargets.find(account => account.platform === platform && (!plan.accountIds?.[platform] || account.accountId === plan.accountIds[platform]))?.accountLabel || '待绑定账号'} · {plan.platforms.includes(platform) ? `${plan.count} 条（母版适配）` : '未选'}
          {editing && config.publishingTargets.some(account => account.platform === platform) && <select aria-label={`${platform}发布账号`} value={plan.accountIds?.[platform] || config.publishingTargets.find(account => account.platform === platform)?.accountId || ''} onChange={event => set('accountIds', { ...plan.accountIds, [platform]: event.target.value })}>{config.publishingTargets.filter(account => account.platform === platform).map(account => <option key={account.accountId} value={account.accountId}>{account.accountLabel}</option>)}</select>}
        </label>)}
      </section>
      <section className="rounded-lg border border-border p-4">
        <h3 className="font-bold text-text-primary">Agent 工作排期</h3>
        <p className="mt-2 text-sm text-text-secondary">经营 Agent 确认目标 → 编导 Agent 分析参考和分镜 → 内容 Agent 完成数字人与关键镜头生成 → 自动质检及编导验收 → {plan.deliveryDate} 交付 {plan.count} 条母版</p>
        <p className="mt-1 text-xs text-text-muted">具体倒排节点位于每条产出卡详情；发布安排在成片交付至少一天后。</p>
      </section>
      {plan.stage === 'b2b_growth' && <section className="rounded-lg border border-border p-3">
        <h3 className="font-bold text-text-primary">历史平台账号（可选）</h3>
        <textarea aria-label="历史平台账号链接" value={history} onChange={event => setHistory(event.target.value)} placeholder="一行一个账号主页 HTTPS 链接" className="mt-2 w-full rounded-lg border border-border p-2"/>
        <button type="button" disabled={historyBusy || Boolean(historyValidation.error)} onClick={() => void collect()} className="mt-2 rounded-lg border border-border px-3 py-2 disabled:opacity-50">{historyBusy ? '正在采集…' : '账号入库并发起采集'}</button>
        {historyMessage && <p role="status" className="mt-2 text-xs text-text-secondary">{historyMessage}</p>}
        <p className="mt-2 text-xs text-text-muted">采集公开历史内容及可获取的播放、赞、转、评；未知指标保持未知。账号入库不会授权真实发布。</p>
      </section>}
      {(error || errors.length > 0) && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error || errors.join('；')}</p>}
    </div>
  </LsFlowDialog>;
}
