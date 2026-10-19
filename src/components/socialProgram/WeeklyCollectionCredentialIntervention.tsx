import { useEffect, useState } from 'react';
import { Alert, Button, Form, InputNumber } from 'antd';
import { authHeader } from '../../lib/auth';

type Scope = { programId: string; packageId: string; packageVersion: number };
type Runtime = { status: 'configuration_present' | 'needs_intervention'; blockers: string[]; guidance: string; requiredCostEvidence: readonly string[] | null; operationallyVerified: false;publishedCostScenario:null|{basis:'public_price_scenario_not_a_quote';knownNonActorScenarioCny:number;modeledCeilingCny:number;maximumRunChargeUsd:number;observedCnyPerUsd:number;checkedAt:string;validUntil:string;permitsPaidCollection:false};authenticatedProviderEvidence:null|{basis:'authenticated_provider_read_only_not_a_permit';accountTier:string;pricingModel:'PAY_PER_EVENT';eventPriceCount:number;minimalMaxTotalChargeUsd:number|null;actorPermissionLevel:string;observedHeadroomUsd:number;observedAt:string;permitsPaidCollection:false} };
type Budget = { accountUrl: string; targetCount: 5; contextHash: string;
  authorization: null | { authorizationId: string; totalLimitCny: number; perRunLimitCny: number; expiresAt: string };
  paidBlocker: string; permitsPaidCollection: false };

export default function WeeklyCollectionCredentialIntervention({ scope }: { scope: Scope }) {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [weeklyLimit, setWeeklyLimit] = useState<number | null>(null);
  const [singleLimit, setSingleLimit] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true); setError('');
    try {
      const root = `/api/overseas/social-programs/${encodeURIComponent(scope.programId)}/operating-packages/${encodeURIComponent(scope.packageId)}`;
      const [response, budgetResponse] = await Promise.all([
        fetch(`${root}/collection-runtime?version=${scope.packageVersion}`, { headers: authHeader(), cache: 'no-store' }),
        fetch(`${root}/collection-budget?version=${scope.packageVersion}`, { headers: authHeader(), cache: 'no-store' }),
      ]);
      if (!response.ok || !budgetResponse.ok) throw new Error('采集预算状态暂时无法读取，按待核验处理。');
      const body = await response.json() as { item?: Runtime };
      const budgetBody = await budgetResponse.json() as { item?: Budget };
      if (!body.item || !['configuration_present', 'needs_intervention'].includes(body.item.status)
        || !budgetBody.item || budgetBody.item.targetCount !== 5 || budgetBody.item.permitsPaidCollection !== false)
        throw new Error('采集预算状态无效，按待核验处理。');
      setRuntime(body.item); setBudget(budgetBody.item);
    } catch (cause) { setRuntime(null); setBudget(null); setError(cause instanceof Error ? cause.message : '采集预算状态暂时无法读取。'); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!budget || budget.authorization || budget.paidBlocker !== 'weekly_preproduction_collection_budget_authorization_required'
      || weeklyLimit === null || singleLimit === null || weeklyLimit <= 0 || singleLimit <= 0 || singleLimit > weeklyLimit) return;
    setBusy(true); setError('');
    try {
      const root = `/api/overseas/social-programs/${encodeURIComponent(scope.programId)}/operating-packages/${encodeURIComponent(scope.packageId)}`;
      const response = await fetch(`${root}/collection-budget`, { method: 'POST', cache: 'no-store',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedPackageVersion: scope.packageVersion, expectedContextHash: budget.contextHash,
          totalLimitCny: weeklyLimit, perRunLimitCny: singleLimit }) });
      if (!response.ok) throw new Error(response.status === 409
        ? '预算状态或采集范围已变化，请重新读取后核对；如签发结果未知，请先核对原回执，不要重复提交。'
        : '费用上限未保存，请核对金额与当前账号权限。');
      setWeeklyLimit(null); setSingleLimit(null);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '费用上限未保存。'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void refresh(); }, [scope.programId, scope.packageId, scope.packageVersion]);
  return <section aria-label="采集任务待干预" className="rounded-lg border border-amber-200 p-4">
    <h2 className="mb-3 text-lg font-semibold">对标采集 · {runtime?.status === 'configuration_present' ? '配置项已存在 · 待核验' : '受阻／待干预'}</h2>
    {error && <Alert type="warning" showIcon title={error} />}
    {runtime?.status === 'needs_intervention' && <Alert type="warning" showIcon title="采集暂不能启动" description={runtime.blockers.join('；')} />}
    {runtime?.status === 'configuration_present' && <Alert type="info" showIcon title="仅检测到本机配置" description="尚未核验采集额度、账号范围和外部服务，也尚未启动采集。" />}
    {budget && <p className="my-3 break-words text-sm text-slate-600">当前账号：{budget.accountUrl} · 目标 {budget.targetCount} 条</p>}
    {budget?.authorization && <Alert type="warning" showIcon title="人民币上限已记录，付费采集仍受阻" description={`本周 ¥${budget.authorization.totalLimitCny}，单次 ¥${budget.authorization.perRunLimitCny}；签发有效期至 ${budget.authorization.expiresAt}。全费用上界尚未核验，未启动采集。`} />}
    {budget?.paidBlocker === 'weekly_preproduction_collection_cost_ceiling_unverified' && runtime?.authenticatedProviderEvidence && <Alert className="mt-3" type="info" showIcon title="已读取当前采集账户与 Actor 计费证据" description={`当前账户档位 ${runtime.authenticatedProviderEvidence.accountTier}，Actor 为 ${runtime.authenticatedProviderEvidence.pricingModel}，共 ${runtime.authenticatedProviderEvidence.eventPriceCount} 类收费事件，最低运行上限 $${runtime.authenticatedProviderEvidence.minimalMaxTotalChargeUsd ?? '未返回'}，当前月度余量约 $${runtime.authenticatedProviderEvidence.observedHeadroomUsd.toFixed(4)}。这证明凭据、账户和 Actor 实时计费可读；仍须将该读取与原 job、人民币授权及 Dataset／KV 后续费用耐久绑定，账户余量不是本周付费许可。`} />}
    {budget?.paidBlocker === 'weekly_preproduction_collection_cost_ceiling_unverified' && runtime?.publishedCostScenario && <Alert className="mt-3" type="info" showIcon title="公开价格场景范围（不是报价或付费许可）" description={`当前公开价与 ECB 即期汇率可算出 Dataset／KV／存储／传输等非 Actor 场景费用约 ¥${runtime.publishedCostScenario.knownNonActorScenarioCny.toFixed(4)}；${runtime.authenticatedProviderEvidence ? '当前 Actor 实时计费已可读，但尚未与原操作持久绑定' : 'Actor 当前账户价格尚未读取'}，因此仍不能给出已授权的单点报价。按当前授权倒推，Actor 单次硬上限候选为 $${runtime.publishedCostScenario.maximumRunChargeUsd.toFixed(6)}，连同上述场景费用的总上界不超过 ¥${runtime.publishedCostScenario.modeledCeilingCny.toFixed(4)}。证据读取于 ${runtime.publishedCostScenario.checkedAt}，最迟 ${runtime.publishedCostScenario.validUntil} 失效。`} />}
    {budget?.paidBlocker === 'weekly_preproduction_collection_cost_ceiling_unverified' && runtime?.requiredCostEvidence && <div className="my-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
      <p className="font-medium">待提交给独立成本核验方的原始证据（本卡不接收密钥，也不签发付费许可）：</p>
      <ul className="mb-0 list-disc pl-5">{runtime.requiredCostEvidence.map(item => <li key={item}>{item}</li>)}</ul>
    </div>}
    {budget?.paidBlocker === 'weekly_preproduction_collection_budget_authorization_required' && !budget.authorization && <Form layout="vertical" onFinish={() => void submit()} className="max-w-xl">
      <Alert type="warning" showIcon title="填写金额不会启动付费采集" description="两项是人民币最高授权额，不是报价。提交后仍须独立核验 Actor、平台、数据读取与传输、汇率及全周共享费用上界。回执有效期为 24 小时。" />
      <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
        <Form.Item label="本周采集总上限（人民币）" required validateStatus={weeklyLimit !== null && weeklyLimit <= 0 ? 'error' : undefined} help={weeklyLimit !== null && weeklyLimit <= 0 ? '请输入大于 0 的金额。' : undefined}>
          <InputNumber className="w-full" min={0.01} precision={2} step={0.01} value={weeklyLimit} onChange={setWeeklyLimit} aria-label="本周采集总上限，人民币" />
        </Form.Item>
        <Form.Item label="单次采集上限（人民币）" required validateStatus={singleLimit !== null && weeklyLimit !== null && singleLimit > weeklyLimit ? 'error' : undefined} help={singleLimit !== null && weeklyLimit !== null && singleLimit > weeklyLimit ? '不得高于本周总上限。' : undefined}>
          <InputNumber className="w-full" min={0.01} precision={2} step={0.01} value={singleLimit} onChange={setSingleLimit} aria-label="单次采集上限，人民币" />
        </Form.Item>
      </div>
      <Button htmlType="submit" disabled={busy || weeklyLimit === null || singleLimit === null || weeklyLimit <= 0 || singleLimit <= 0 || singleLimit > weeklyLimit} loading={busy}>记录人民币费用上限（不启动采集）</Button>
    </Form>}
    <p className="my-3 text-sm text-slate-600">{runtime?.guidance || '请由本机服务管理员核对采集服务配置。任务卡不接收 API Key。'}</p>
    <Button disabled={busy} onClick={() => void refresh()}>重新读取采集状态</Button>
  </section>;
}
