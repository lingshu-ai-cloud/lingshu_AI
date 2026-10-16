import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Select, Space, Spin } from 'antd';
import { ChevronDown, Zap } from 'lucide-react';
import { assistantWeeklyActionsApi, weeklyActionScopeTokens, type WeeklyAssistantAction, type WeeklyActionContext, type WeeklyActionReceipt, type WeeklyCapacityProposal } from '../../lib/assistantWeeklyActionsApi';
import type { WeeklyScheduleCapacityInput, WeeklyScheduleProposal } from '../../../shared/contracts/socialWeeklyScheduleRevision';

export const WEEKLY_ACTION_LABELS: Record<WeeklyAssistantAction, string> = {
  create: '新建一条内容', revise: '修改已有内容', publish: '发布指定成片',
};
export function weeklyCapacityLimitLabel(reason: string): string {
  const labels: Record<string, string> = { materials: '可用素材不足', deadline: '剩余制作时间不足', accounts: '账号发布容量不足', interaction: '互动承接容量不足', sales: '销售承接容量不足', budget: '可用预算不足' };
  return labels[reason] || '存在容量限制，请查看周任务说明';
}
export function weeklyActionsForPage(page: string): WeeklyAssistantAction[] {
  if (page === 'digitalEmployees' || page === 'socialWorkspace') return ['create', 'revise', 'publish'];
  if (page === 'smartAssets' || page === 'scriptLibrary') return ['create', 'revise'];
  if (page === 'socialInspiration') return ['create'];
  if (page === 'traffic') return ['publish'];
  return [];
}

type Props = { page: string; scopeKey: string; disabled: boolean; onReceipt: (receipt: WeeklyActionReceipt) => void; onBusyChange?: (busy: boolean) => void };
type Answers = { packageKey: string; productId: string; goal: string; accountId: string; platform: string; dueAt: string; targetId: string; note: string; publishingAccountId: string; publishAt: string };
const emptyAnswers = (): Answers => ({ packageKey: '', productId: '', goal: '', accountId: '', platform: '', dueAt: '', targetId: '', note: '', publishingAccountId: '', publishAt: '' });

/** Explicit intake is deliberately separate from free-form chat and model output. */
export default function AssistantWeeklyActions({ page, scopeKey, disabled, onReceipt, onBusyChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [action, setAction] = useState<WeeklyAssistantAction | null>(null);
  const [context, setContext] = useState<WeeklyActionContext | null>(null);
  const [answers, setAnswers] = useState<Answers>(emptyAnswers);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<WeeklyActionReceipt | null>(null);
  const [requestId, setRequestId] = useState('');
  const [createInput, setCreateInput] = useState<Record<string, unknown> | null>(null);
  const [capacityProposal, setCapacityProposal] = useState<WeeklyCapacityProposal | null>(null);
  const [budgetText, setBudgetText] = useState('');
  const [scheduleInput, setScheduleInput] = useState<{ capacity: WeeklyScheduleCapacityInput; summary: string[] } | null>(null);
  const [scheduleProposal, setScheduleProposal] = useState<WeeklyScheduleProposal | null>(null);
  const [legacyBudgetText, setLegacyBudgetText] = useState('');
  const fence = useRef(0);
  const locked = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const actions = weeklyActionsForPage(page);
  useEffect(() => {
    fence.current += 1; controller.current?.abort(); locked.current = false;
    setAction(null); setContext(null); setExpanded(false); setAnswers(emptyAnswers()); setError(''); setReceipt(null); setBusy(false);
    setCreateInput(null); setCapacityProposal(null); setBudgetText(''); setScheduleInput(null); setScheduleProposal(null);
    setLegacyBudgetText('');
    onBusyChange?.(false);
    return () => { fence.current += 1; controller.current?.abort(); };
  }, [page, scopeKey]);

  const begin = async (next: WeeklyAssistantAction) => {
    if (locked.current || disabled) return;
    locked.current = true; const generation = ++fence.current;
    controller.current?.abort(); controller.current = new AbortController();
    setAction(next); setContext(null); setAnswers(emptyAnswers()); setStep(0); setError(''); setReceipt(null); setBusy(true); onBusyChange?.(true);
    setRequestId(crypto.randomUUID());
    setCreateInput(null); setCapacityProposal(null); setBudgetText(''); setScheduleInput(null); setScheduleProposal(null);
    setLegacyBudgetText('');
    try {
      const loaded = await assistantWeeklyActionsApi.context(controller.current.signal);
      if (fence.current !== generation) return;
      setContext(loaded);
      if (loaded.packages.length === 1) setAnswers(current => ({ ...current, packageKey: loaded.packages[0].packageId }));
    } catch (e) { if (fence.current === generation) setError(e instanceof Error ? e.message : '无法读取周任务。'); }
    finally { if (fence.current === generation) { setBusy(false); locked.current = false; onBusyChange?.(false); } }
  };
  const update = <K extends keyof Answers>(key: K, value: Answers[K]) => { setAnswers(current => ({ ...current, [key]: value })); setError(''); };
  const selectedPackage = context?.packages.find(item => item.packageId === answers.packageKey);
  const legacyCreate = selectedPackage?.model === 'legacy';
  const configuredPlatforms = selectedPackage?.platforms;
  const legacyPlatforms = Array.isArray(configuredPlatforms) ? configuredPlatforms.filter((value): value is string => typeof value === 'string') : [];
  const selectableProducts = context?.products.filter(item => !selectedPackage?.allowedProductIds || selectedPackage.allowedProductIds.includes(item.id)) ?? [];
  const accounts = selectedPackage ? context?.accounts.filter(item => item.programId === selectedPackage.programId && (!item.packageIds || item.packageIds.includes(selectedPackage.packageId))) ?? [] : [];
  const selectedAccount = accounts.find(item => item.id === answers.accountId);
  const targets = (action === 'revise' ? context?.revisionTargets : context?.publishTargets) ?? [];
  const target = targets.find(item => item.id === answers.targetId);
  const needsPublishingConfiguration = action === 'publish' && target?.model === 'legacy' && target.needsPublishingConfiguration === true;
  const publishingAccounts = context?.publishingAccounts?.filter(account => account.status === 'connected' && account.platform === target?.platform) ?? [];
  const publishingAccount = publishingAccounts.find(account => account.accountId === answers.publishingAccountId);
  const steps = action === 'create' ? ['package', 'product', 'goal', 'account', 'deadline', 'confirm'] : action === 'revise' && target?.model !== 'legacy' ? ['target', 'note', 'confirm'] : needsPublishingConfiguration ? ['target', 'publishing-account', 'publishing-time', 'confirm'] : ['target', 'confirm'];
  const current = steps[step];
  const question = current === 'package' ? '这条内容要加入哪一个周任务包？'
    : current === 'product' ? '要为企业知识库中的哪个产品制作？'
    : current === 'goal' ? '这条内容主要想表达什么、达成什么目标？'
    : current === 'account' ? legacyCreate ? '准备制作哪个平台的内容？' : '准备给哪个账号制作？'
    : current === 'deadline' ? legacyCreate ? '希望这条内容什么时候交付？（北京时间）' : '计划什么时候发布？内容需要在此前完成。（北京时间）'
    : current === 'note' ? '这条内容具体要改哪里？'
    : current === 'publishing-account' ? '请选择这条成片要发布的已连接账号。'
    : current === 'publishing-time' ? '计划在什么时候发布？（北京时间）'
    : current === 'target' ? action === 'revise' ? '请选择要修改的原内容和版本。' : '请选择要进入发布流程的成片。'
    : '确认这些信息后，再提交到周任务。';
  const next = () => {
    const valid = current === 'package' ? Boolean(selectedPackage) : current === 'product' ? selectableProducts.some(item => item.id === answers.productId)
      : current === 'goal' ? Boolean(answers.goal.trim()) : current === 'account' ? legacyCreate ? legacyPlatforms.includes(answers.platform) : Boolean(selectedAccount)
      : current === 'deadline' ? Number.isFinite(Date.parse(`${answers.dueAt}+08:00`)) && Date.parse(`${answers.dueAt}+08:00`) > Date.now()
      : current === 'note' ? Boolean(answers.note.trim()) : Boolean(target);
    if (current === 'publishing-account' && !publishingAccount) { setError('请选择与成片平台一致的已连接账号。'); return; }
    if (current === 'publishing-time' && (!Number.isFinite(Date.parse(`${answers.publishAt}+08:00`)) || Date.parse(`${answers.publishAt}+08:00`) <= Date.now())) { setError('请选择未来的明确发布时间。'); return; }
    if (!valid) { setError(current === 'deadline' ? legacyCreate ? '请选择未来的期望交付时间。' : '请选择未来的计划发布时间。' : '请先回答这一项。'); return; }
    setError(''); setStep(value => value + 1);
  };
  const submit = async () => {
    if (locked.current || disabled || !action) return;
    const generation = fence.current;
    let input: Record<string, unknown>;
    if (action === 'create') {
      if (!selectedPackage || (!legacyCreate && !selectedAccount) || !selectableProducts.some(p => p.id === answers.productId)) return;
      if (legacyCreate && (!legacyBudgetText.trim() || !Number.isFinite(Number(legacyBudgetText)) || Number(legacyBudgetText) < 0 || Number(legacyBudgetText) > 10000)) { setError('请填写费用上限（0–10000 元）；创建任务不会启动付费生成。'); return; }
      input = { ...weeklyActionScopeTokens(selectedPackage), requestId, programId: selectedPackage.programId, packageId: selectedPackage.packageId, expectedVersion: selectedPackage.packageVersion,
        ...(selectedAccount ? { accountId: selectedAccount.id } : {}), productId: answers.productId, goal: answers.goal.trim(), platform: legacyCreate ? answers.platform : selectedAccount!.platform, dueAt: new Date(`${answers.dueAt}+08:00`).toISOString(),
        ...(legacyCreate ? { maximumAdditionalCostCny: Number(legacyBudgetText), confirmAdditionalBudget: true, publishMode: 'draft_only' } : {}) };
    } else {
      if (!target) return;
      if (needsPublishingConfiguration && (!publishingAccount || !Number.isFinite(Date.parse(`${answers.publishAt}+08:00`)) || Date.parse(`${answers.publishAt}+08:00`) <= Date.now())) { setError('请重新确认已连接账号及未来的发布时间。'); return; }
      input = { ...weeklyActionScopeTokens(target), requestId, programId: target.programId, packageId: target.packageId, packageVersion: target.packageVersion,
        publicationTaskId: target.publicationTaskId, taskId: target.taskId, artifactId: target.artifactId,
        expectedArtifactVersion: target.expectedArtifactVersion, ...(action === 'revise' && target.model !== 'legacy' ? { note: answers.note.trim() } : {}),
        ...(needsPublishingConfiguration ? { accountId: publishingAccount?.accountId, publishAt: new Date(`${answers.publishAt}+08:00`).toISOString(), confirmPublishingIntent: true } : {}) };
    }
    locked.current = true; setBusy(true); onBusyChange?.(true); setError('');
    controller.current = new AbortController();
    try {
      if (action === 'create' && !legacyCreate) {
        const proposal = await assistantWeeklyActionsApi.previewCapacity(input, controller.current.signal);
        if (generation !== fence.current) return;
        setCreateInput(input); setCapacityProposal(proposal); return;
      }
      const result = await assistantWeeklyActionsApi.submit(action, input, controller.current.signal);
      if (generation !== fence.current) return;
      setReceipt(result); onReceipt(result);
    } catch (e) { if (generation === fence.current) setError(e instanceof Error ? e.message : '操作未完成，请查看周任务状态。'); }
    finally { if (generation === fence.current) { locked.current = false; setBusy(false); onBusyChange?.(false); } }
  };
  const continueCreate = async () => {
    if (locked.current || disabled || !createInput || !capacityProposal) return;
    const budget = Number(budgetText);
    if (!scheduleInput && (!budgetText.trim() || !Number.isFinite(budget) || budget < capacityProposal.estimatedCostCny || budget > capacityProposal.weeklyBudgetCny)) {
      setError('请明确填写允许的费用上限，且不低于预计费用、不超过周预算。零元也需要填写 0。'); return;
    }
    locked.current = true; const generation = fence.current;
    controller.current = new AbortController(); setBusy(true); onBusyChange?.(true); setError('');
    try {
      if (!scheduleInput) {
        const confirmation = await assistantWeeklyActionsApi.confirmCapacity(createInput, capacityProposal, budget, controller.current.signal);
        const input = { ...createInput, capacityPlanRef: confirmation.capacityPlanRef, operatingDecisionSnapshotRef: confirmation.operatingDecisionSnapshotRef, capacityAuthorization: confirmation.capacityAuthorization };
        const resourceInput = await assistantWeeklyActionsApi.scheduleInput(input, controller.current.signal);
        if (generation !== fence.current) return;
        setCreateInput(input); setScheduleInput(resourceInput);
      } else if (!scheduleProposal) {
        const preview = await assistantWeeklyActionsApi.previewSchedule(createInput, scheduleInput.capacity, controller.current.signal);
        if (generation !== fence.current) return;
        setScheduleProposal(preview.proposal);
      } else {
        const result = await assistantWeeklyActionsApi.confirmSchedule(createInput, scheduleProposal, controller.current.signal);
        if (generation !== fence.current) return;
        setReceipt(result); onReceipt(result);
      }
    } catch (e) { if (generation === fence.current) setError(e instanceof Error ? e.message : '排期操作未完成，请查看周任务状态。'); }
    finally { if (generation === fence.current) { locked.current = false; setBusy(false); onBusyChange?.(false); } }
  };
  if (!actions.length) return null;
  return <section className="shrink-0 bg-surface px-3 py-2" aria-label="周任务行动入口">
    <div className="flex items-center justify-between gap-2">
      <Button type="text" icon={<Zap size={14} />} disabled={disabled || busy} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>执行任务</Button>
      {expanded && <Button type="text" aria-label="收起执行任务" title="收起执行任务" icon={<ChevronDown size={16} />} onClick={() => setExpanded(false)} />}
    </div>
    {expanded && <div className="max-h-[45dvh] space-y-3 overflow-y-auto py-2">
      {!action ? <Space wrap>{actions.map(item => <Button key={item} disabled={disabled} onClick={() => void begin(item)}>{WEEKLY_ACTION_LABELS[item]}</Button>)}</Space>
        : <>
          <div className="flex items-center justify-between gap-2"><strong>{WEEKLY_ACTION_LABELS[action]}</strong><Button type="text" disabled={busy} onClick={() => { setAction(null); setError(''); }}>取消</Button></div>
          {busy && !context ? <Spin tip="正在读取真实周任务" /> : receipt ? <Alert type={receipt.state.includes('fail') ? 'error' : 'info'} title={receipt.message} /> : capacityProposal ? <>
            {!scheduleInput ? <>
              <p>新增后，本周共排期 {capacityProposal.publicationQuota} 条发布、{capacityProposal.originalContentQuota} 条原创内容。</p>
              <p>预计费用 ¥{capacityProposal.estimatedCostCny.toFixed(2)}；周预算 ¥{capacityProposal.weeklyBudgetCny.toFixed(2)}。</p>
              {capacityProposal.limitingFactors.length > 0 && <ul className="list-disc pl-4">{[...new Set(capacityProposal.limitingFactors.map(weeklyCapacityLimitLabel))].map(reason => <li key={reason}>{reason}</li>)}</ul>}
              <label htmlFor="weekly-action-budget">本次允许费用上限（元）</label><Input id="weekly-action-budget" inputMode="decimal" value={budgetText} onChange={event => setBudgetText(event.target.value)} disabled={busy || !capacityProposal.canAdd} />
              {!capacityProposal.canAdd && <Alert type="warning" title="现有资源或预算不能承接新增内容，请先调整生产容量。原任务不受影响。" />}
            </> : !scheduleProposal ? <>
              <p>请核对本次排期使用的真实资源和估时：</p><ul className="list-disc space-y-1 pl-4">{scheduleInput.summary.map(line => <li key={line}>{line}</li>)}</ul>
              <p>确认这些条件后，系统才计算新增任务对现有排期的影响。</p>
            </> : <>
              <p>排期核验：{scheduleProposal.plan.conditionallyReachableCount} / {scheduleProposal.plan.targetPublicationCount} 条可按当前条件交付。</p>
              <p>本次排期预留费用 ¥{scheduleProposal.plan.reservedCostCny.toFixed(2)}。</p>
              {(scheduleProposal.templateCarryovers?.length ?? 0) > 0 && <p>沿用 {scheduleProposal.templateCarryovers!.length} 项已有内容模板；模板来源和版本随本次确认一同冻结。</p>}
              {!scheduleProposal.plan.fullGraphConditionallyReachable && <Alert type="warning" title="当前仍有任务无法排入交付窗口，请调整资源或交付时间，不能直接确认。" />}
              <p>确认后保存新的周计划版本，保留已有任务成果；后续仍按编导审核和生产授权执行，不会自动批准发布。</p>
            </>}
            <Button type="primary" loading={busy} disabled={disabled || !capacityProposal.canAdd || Boolean(scheduleProposal && !scheduleProposal.plan.fullGraphConditionallyReachable)} onClick={() => void continueCreate()}>{!scheduleInput ? '确认容量与费用上限' : !scheduleProposal ? '确认资源并计算排期' : '确认加入本周排期'}</Button>
          </> : context && <>
            {context.packages.length === 0 && <Alert type="warning" title="当前账号尚未建立可执行周任务包" description="尚不能创建、修订或发布周任务；这里不会用历史看板或示例计划替代。" />}
            <p id="weekly-action-question">{question}</p>
            {current === 'package' && <Select className="w-full" aria-labelledby="weekly-action-question" value={answers.packageKey || undefined} options={context.packages.map(p => ({ value: p.packageId, label: p.title }))} onChange={value => { update('packageKey', value); update('accountId', ''); update('productId', ''); update('platform', ''); setLegacyBudgetText(''); }} notFoundContent="当前账号尚未建立可执行周任务包" />}
            {current === 'product' && <><Select className="w-full" showSearch optionFilterProp="label" aria-labelledby="weekly-action-question" value={answers.productId || undefined} options={selectableProducts.map(p => ({ value: p.id, label: p.name }))} onChange={value => update('productId', value)} notFoundContent="当前周计划暂无可选的知识库产品" /><Button type="link" onClick={() => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } }))}>到企业知识库新建产品</Button></>}
            {(current === 'goal' || current === 'note') && <Input.TextArea autoFocus aria-labelledby="weekly-action-question" rows={3} maxLength={current === 'goal' ? 1000 : 2000} value={current === 'goal' ? answers.goal : answers.note} onChange={event => update(current === 'goal' ? 'goal' : 'note', event.target.value)} />}
            {current === 'account' && (legacyCreate ? <Select className="w-full" aria-labelledby="weekly-action-question" value={answers.platform || undefined} options={legacyPlatforms.map(platform => ({ value: platform, label: platform }))} onChange={value => update('platform', value)} notFoundContent="当前周计划没有已确认的内容平台" /> : <Select className="w-full" aria-labelledby="weekly-action-question" value={answers.accountId || undefined} options={accounts.map(p => ({ value: p.id, label: `${p.name} · ${p.platform}` }))} onChange={value => update('accountId', value)} notFoundContent="本周暂无可用账号，请先配置账号排期。" />)}
            {current === 'deadline' && <Input type="datetime-local" aria-labelledby="weekly-action-question" value={answers.dueAt} onChange={event => update('dueAt', event.target.value)} />}
            {current === 'target' && <Select className="w-full" showSearch optionFilterProp="label" aria-labelledby="weekly-action-question" value={answers.targetId || undefined} options={targets.map(p => ({ value: p.id, label: p.name }))} onChange={value => { update('targetId', value); update('publishingAccountId', ''); update('publishAt', ''); }} notFoundContent={action === 'revise' ? '暂无符合条件的原内容。' : '暂无可进入发布流程的成片，请先完成成片验收。'} />}
            {current === 'publishing-account' && <><Select className="w-full" aria-labelledby="weekly-action-question" value={answers.publishingAccountId || undefined} options={publishingAccounts.map(account => ({ value: account.accountId, label: `${account.accountLabel} · ${account.platform}` }))} onChange={value => update('publishingAccountId', value)} notFoundContent="该平台暂无已连接账号" />{publishingAccounts.length === 0 && <Alert type="warning" title="请先在集成中心连接该平台账号，再重新读取本次操作。这里不会使用示例账号。" />}</>}
            {current === 'publishing-time' && <Input type="datetime-local" aria-labelledby="weekly-action-question" value={answers.publishAt} onChange={event => update('publishAt', event.target.value)} />}
            {current === 'confirm' && <div className="space-y-2 text-text-secondary">
              {action === 'create' ? <><details className="rounded-lg border border-border p-3"><summary className="cursor-pointer">查看任务详情</summary><div className="space-y-2 pt-2"><p>{context.products.find(p => p.id === answers.productId)?.name} · {legacyCreate ? answers.platform : selectedAccount?.name}</p><p>{answers.goal}</p><p>{legacyCreate ? '期望交付' : '计划发布'}：{answers.dueAt.replace('T', ' ')}（北京时间）{legacyCreate ? '' : '；内容需在此前完成。'}</p></div></details>{legacyCreate && <><label htmlFor="legacy-weekly-action-budget">本条任务允许的额外费用上限（元）</label><Input id="legacy-weekly-action-budget" inputMode="decimal" value={legacyBudgetText} onChange={event => setLegacyBudgetText(event.target.value)} /></>}</> : <><p>{target?.name}</p>{action === 'revise' && target?.model !== 'legacy' && <p>{answers.note}</p>}</>}
              {action === 'publish' && <p>加入原成片的发布流程，仍须通过真实授权和发布审批；本操作不会跳过审批直接发送。</p>}
              {action === 'revise' && target?.model === 'legacy' && <p>继续使用原周任务。下一步进入已有制作页面确认具体修改项；此时尚不会修改作品或启动付费生产。</p>}
              {needsPublishingConfiguration && <><p>发布账号：{publishingAccount?.accountLabel} · {publishingAccount?.platform}</p><p>发布时间：{answers.publishAt.replace('T', ' ')}（北京时间）</p><p>我确认将此条“仅制作”内容转为发布待审批配置；原有授权需要重新核验，本次不会直接发送。</p></>}
            </div>}
            <Space><Button disabled={busy || step === 0} onClick={() => { setStep(value => value - 1); setError(''); }}>上一步</Button><Button type="primary" loading={busy} disabled={disabled || context.packages.length === 0} onClick={() => current === 'confirm' ? void submit() : next()}>{current === 'confirm' ? action === 'revise' && target?.model === 'legacy' ? '进入原制作页面修改' : needsPublishingConfiguration ? '确认账号与发布时间' : action === 'publish' ? '确认进入发布流程' : '确认提交周任务' : '下一步'}</Button></Space>
          </>}
          {error && <Alert type="error" title={error} action={!context ? <Button disabled={busy} onClick={() => void begin(action)}>重新读取</Button> : undefined} />}
        </>}
    </div>}
  </section>;
}
