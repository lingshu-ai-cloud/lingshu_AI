import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Modal } from 'antd';
import { socialProgramApi } from '../../lib/socialProgramApi';
import { getToken } from '../../lib/auth';
import { assistantWeeklyNavigationHref, type AssistantWeeklyNavigation } from '../../lib/assistantWeeklyNavigation';
import { activateAssistantWeeklyPackage } from '../../lib/assistantWeeklyActivation';
import type { OwnedSocialAccount, SocialProgram, WeeklyOperatingPackage } from '../../../shared/contracts/socialProgram';
import WeeklyOperatingWorkbench from '../socialProgram/WeeklyOperatingWorkbench';

/** The existing production/repair workbench, scoped to the actual weekly receipt. */
export default function AssistantWeeklyProductionView({ target }: { target: AssistantWeeklyNavigation }) {
  const [pkg, setPackage] = useState<WeeklyOperatingPackage | null>(null);
  const [program, setProgram] = useState<SocialProgram | null>(null);
  const [accounts, setAccounts] = useState<OwnedSocialAccount[]>([]);
  const [authorizePublishing, setAuthorizePublishing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activationOpen, setActivationOpen] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activationError, setActivationError] = useState('');
  const [activationResult, setActivationResult] = useState('');
  const activationLock = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current, token = getToken();
    setLoading(true); setError('');
    try {
      const [item, source, actualAccounts] = await Promise.all([socialProgramApi.getOperatingPackage(target.programId, target.packageId), socialProgramApi.get(target.programId), socialProgramApi.listAccounts(target.programId).catch(() => [])]);
      if (generation.current !== current || getToken() !== token) return;
      if (item.programId !== target.programId || item.packageId !== target.packageId || item.version !== target.packageVersion) throw new Error('指定周任务版本已变化，请从灵小枢重新读取，不会打开其他版本替代。');
      setPackage(item); setProgram(source); setAccounts(actualAccounts);
    } catch (cause) { if (generation.current === current) { setPackage(null); setError(cause instanceof Error ? cause.message : '周任务读取失败。'); } }
    finally { if (generation.current === current) setLoading(false); }
  }, [target.programId, target.packageId, target.packageVersion]);
  useEffect(() => { void refresh(); return () => { generation.current += 1; }; }, [refresh]);
  const activate = async () => {
    if (activationLock.current || !pkg || !activationOpen) return;
    if (authorizePublishing && !authorizationAccountsReady) { setActivationError('账号身份已变化，请重新读取并确认发布范围。'); return; }
    activationLock.current = true; setActivating(true); setActivationError('');
    const current = generation.current;
    try {
      const result = await activateAssistantWeeklyPackage(target, () => generation.current === current, authorizePublishing);
      if (generation.current !== current) return;
      setPackage(result.pkg); setActivationOpen(false);
      setActivationResult(result.alreadyActive ? '本周任务已经激活，已读取当前状态。' : '本周任务已激活，执行节点已登记。请以下方实际状态为准；排队或阻塞不等于正在生产。');
      window.dispatchEvent(new CustomEvent('lingshu:weekly-tasks-updated', { detail: { programId: target.programId, packageId: target.packageId, packageVersion: target.packageVersion } }));
    } catch (cause) { if (generation.current === current) setActivationError(cause instanceof Error ? cause.message : '未能确认启动结果，请刷新周任务查看。'); }
    finally { activationLock.current = false; setActivating(false); }
  };
  const publicationAccounts = [...new Set(pkg?.socialContentPackage.publicationTasks.map(item => item.accountId) ?? [])];
  const authorizationAccountsReady = publicationAccounts.length > 0 && publicationAccounts.every(id => accounts.some(account => account.accountId === id && Boolean(account.displayName)));
  return <div className="h-full overflow-y-auto bg-surface p-4 sm:p-6">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">周任务生产与交付</h2><Button onClick={() => window.location.assign('/?page=digitalEmployees')}>返回经营总览</Button></div>
    {error && <Alert type="error" title={error} action={<Button onClick={() => void refresh()}>重新读取</Button>} />}
    {activationResult && <Alert type="success" title={activationResult} />}
    {pkg?.status === 'draft' && <section className="mb-4 space-y-3 rounded-lg border border-border bg-surface p-4" aria-label="周任务启动确认">
      <p>{pkg.agentPlanning?.status === 'dispatched' ? '详细计划已确认并完成经营派单，可以确认启动真实周任务。' : '本周仍是草稿，请在下方完成编导分析、计划确认和经营派单。'}</p>
      <Button type="primary" disabled={pkg.agentPlanning?.status !== 'dispatched' || loading || activating} onClick={() => { setActivationError(''); setAuthorizePublishing(false); setActivationOpen(true); }}>确认启动周任务</Button>
    </section>}
    <Modal title="确认启动周任务" open={activationOpen} onCancel={() => { if (!activating) setActivationOpen(false); }} maskClosable={false} closable={!activating} keyboard={!activating} footer={<><Button disabled={activating} onClick={() => setActivationOpen(false)}>暂不启动</Button><Button type="primary" loading={activating} onClick={() => void activate()}>确认启动</Button></>}>
      <div className="space-y-3"><p>将激活当前周计划的真实执行节点，可能按已确认预算调用生产服务；排队、等待和阻塞均以下方真实状态为准。</p>
        <p>发布授权默认不勾选。仅启动生产，不会自动取得新的发布许可。</p>
        <div className="space-y-2 rounded-lg border border-border p-3"><p>可选发布范围：本周 {pkg?.weekStart} 至 {pkg?.weekEnd}，最多 {pkg?.socialContentPackage.publicationTaskTarget ?? 0} 条。</p>
          <ul className="list-disc pl-4">{publicationAccounts.map(id => { const account = accounts.find(item => item.accountId === id); const count = pkg?.socialContentPackage.publicationTasks.filter(item => item.accountId === id).length ?? 0; return <li key={id}>{account?.displayName || '账号身份暂未读取'} · {account?.platform || ''} · {count} 条</li>; })}</ul>
          <Checkbox checked={authorizePublishing} disabled={activating || !authorizationAccountsReady} onChange={event => setAuthorizePublishing(event.target.checked)}>我明确授权以上账号在本周计划范围内发布；仍须逐条通过成片验收和平台权限核验。</Checkbox>
          {!authorizationAccountsReady && <p className="text-text-secondary">账号身份未完整读取，暂不能授予发布许可；可以仅激活生产。</p>}
        </div>
        <p>资料或生成服务缺失时，对应任务会显示真实阻塞原因，不会标记完成。</p>{activationError && <Alert type="error" title={activationError} />}</div>
    </Modal>
    {pkg?.status === 'active' && !pkg.socialContentPackage.authorization.allowRealPublishing && <Alert type="warning" title="本周未获发布授权。可以继续制作与验收，但不能正式发布；如需发布，请由负责人确认授权修订，当前入口不会自动追加权限。" />}
    <WeeklyOperatingWorkbench pkg={pkg} loading={loading} error={error} selectedTaskId={target.taskId} selectedPublicationId={target.publicationTaskId} onRefresh={() => void refresh()} programRoute={program?.route} onRevision={next => {
      setPackage(next);
      window.location.assign(assistantWeeklyNavigationHref({ ...target, packageVersion: next.version }));
    }} />
  </div>;
}
