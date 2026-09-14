import { useEffect, useRef, useState } from 'react';
import { managedSummary, type ManagedSnapshot as Snapshot } from '../lib/adManagedSummary';
import { platformAdsRequest, type PlatformAdTask } from '../lib/platformAds';
import { managementModeLabels } from '../lib/platformAdsDomain';
import { AdTaskControls } from './PlatformAdsOperations';
import './adManagedWorkspace.css';

type Row = Record<string, unknown>;
const actionNames: Record<string, string> = { create: '创建广告', activate: '启用广告', resume: '恢复广告', pause: '暂停广告', adjust_budget: '调整预算' };
const statuses: Record<string, string> = { PENDING: '等待批准', APPROVING: '审批执行中', VERIFIED: '平台已核验', EXECUTED: '已执行', FAILED: '失败', UNKNOWN: '结果待核验', REJECTED: '已拒绝', EXPIRED: '已过期', INVALIDATED: '已失效', SKIPPED: '保持观察', BLOCKED: '需要处理' };
const label = (value: unknown) => statuses[String(value)] || String(value || '状态未返回');
const time = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN') : '时间未返回';
export default function AdManagedWorkspace({ tasks, loading, onUpdate, onPlans, selectedTaskId }: { tasks: PlatformAdTask[]; loading: boolean; onUpdate: (task: PlatformAdTask) => void; onPlans: () => void; selectedTaskId?: string }) {
  const [selected, setSelected] = useState('');
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState('all');
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLElement>(null);
  useEffect(() => { if (selectedTaskId) setSelected(selectedTaskId); }, [selectedTaskId]);
  useEffect(() => { if (showSettings) { settingsRef.current?.scrollIntoView({ block: 'start' }); settingsRef.current?.focus(); } }, [showSettings]);
  const [policy, setPolicy] = useState<string>('');
  const task = tasks.find(t => t.id === selected) || tasks[0];
  // Reading this workbench never starts a worker or performs a platform action.
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setSnapshots({}); setPolicy('正在读取执行条件…');
    platformAdsRequest<{ releasePolicy?: { mode: string; reason: string } }>('/connections', { signal: controller.signal }).then(r => { if (!controller.signal.aborted) setPolicy(r.releasePolicy?.reason || '执行能力以平台校验与授权边界为准。'); }).catch(() => { if (!controller.signal.aborted) setPolicy('执行条件读取失败，请先核对账户与权限。'); });
    void (async () => {
      for (let i = 0; i < tasks.length; i += 3) {
        await Promise.all(tasks.slice(i, i + 3).map(async t => {
          const state: Snapshot = { approvals: [], executions: [], runs: [], errors: [] };
          await Promise.all((['approvals', 'executions', 'automation'] as const).map(async endpoint => {
            try {
              const r = await platformAdsRequest<{ items?: Row[]; runs?: Row[] }>(`/tasks/${encodeURIComponent(t.id)}/${endpoint}`, { signal: controller.signal });
              if (endpoint === 'automation') state.runs = r.runs || []; else state[endpoint] = r.items || [];
            } catch { state.errors.push(`${endpoint === 'automation' ? '观察' : endpoint === 'approvals' ? '审批' : '执行'}记录读取失败`); }
          }));
          if (!controller.signal.aborted) setSnapshots(old => ({ ...old, [t.id]: state }));
        }));
        if (controller.signal.aborted) return;
      }
      if (!controller.signal.aborted) setBusy(false);
    })();
    return () => controller.abort();
  }, [tasks, refresh]);
  const all = Object.values(snapshots);
  const { pending, verified, issues, authorized } = managedSummary(tasks, all);
  const current = task ? snapshots[task.id] : undefined;
  const events = current ? [...current.approvals.map(r => ({ ...r, kind: '审批' })), ...current.executions.map(r => ({ ...r, kind: '平台执行' })), ...current.runs.map(r => ({ ...r, kind: '优化观察' }))].sort((a: Row, b: Row) => (Date.parse(String(b.createdAt)) || 0) - (Date.parse(String(a.createdAt)) || 0)) : [];
  const visible = events.filter((r: Row) => filter === 'all' || (filter === 'pending' ? r.status === 'PENDING' : ['FAILED', 'UNKNOWN', 'BLOCKED'].includes(String(r.status))));
  return <div className="managed-workspace">
    <section className="ads-card managed-intro"><div className="ads-section-title"><div><p className="ads-muted">YOUR AI MEDIA BUYER</p><h2>让每一次托管操作都有依据</h2><p>先看待办，再看执行；授权不会被当作运行成功。</p></div><button className="ads-button" disabled={busy || loading} onClick={() => setRefresh(n => n + 1)}>{busy || loading ? '读取中…' : '刷新工作台'}</button></div><p role="status" className="managed-policy">{policy}</p><div className="managed-stats">{[['有效托管授权', authorized, '已授权计划，不代表正在运行'], ['待我批准', pending, '已返回的待审批动作'], ['平台已核验', verified, '已返回的成功核验记录'], ['需要关注', issues, '含失败、未知或读取异常的计划']].map(([name, count, note]) => <article key={String(name)}><span>{name}</span><strong>{busy || loading ? '—' : count}</strong><small>{note}</small></article>)}</div>{all.some(s => s.errors.length) && <p role="alert">部分记录读取失败，以上为已返回记录小计，不代表完整账户状态。</p>}</section>
    {!tasks.length ? <section className="ads-card managed-empty"><h2>{loading ? '正在加载计划…' : '从一个计划开始托管'}</h2><p>选择计划 → 确认目标 → 设置授权边界 → 检查条件。不会自动启用广告。</p><button className="ads-button primary" onClick={onPlans}>前往投放计划</button></section> : task && <>
      <div className="managed-layout"><section className="ads-card"><div className="ads-section-title"><h2>决策与执行动态</h2><label>当前计划 <select aria-label="当前托管计划" value={task.id} onChange={e => { setSelected(e.target.value); setShowSettings(false); }}>{tasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div><p className="ads-muted">目标：{task.goal} · {task.currency} · {managementModeLabels[task.managementMode]}</p>
      <div className="managed-filters" role="group" aria-label="动态筛选">{[['all', '全部记录'], ['pending', '待批准'], ['issues', '需关注']].map(([value, name]) => <button className={`ads-button ${filter === value ? 'primary' : ''}`} aria-pressed={filter === value} key={value} onClick={() => setFilter(value)}>{name}</button>)}</div>
      {current?.errors.map(error => <p role="alert" key={error}>{error}，请刷新重试。</p>)}
      <ol className="managed-timeline">{visible.map((r: Row, i) => <li key={`${r.kind}-${String(r.id || i)}`}><div className="ads-section-title"><strong>{actionNames[String(r.action)] || String(r.kind)}</strong><span className="managed-badge">{label(r.status)}</span></div><small>{String(r.kind)} · {time(r.createdAt)}</small><p>{String(r.reason || r.error || '请查看记录中的动作参数与平台回执。')}</p><details><summary>查看依据与影响范围</summary><pre>{JSON.stringify(r, null, 2)}</pre></details>{r.status === 'PENDING' && <button className="ads-button" onClick={() => setShowSettings(true)}>查看并处理审批</button>}</li>)}</ol>
      {!visible.length && <div className="managed-empty"><h3>{busy ? '正在核对服务记录' : filter === 'all' ? '暂无决策或执行记录' : '当前筛选下暂无记录'}</h3><p>没有记录不代表正在优化。数据与样本不足时，保持观察，不生成虚构建议。</p></div>}
      {task.proposal && <details className="managed-proposal"><summary>查看已保存的投放方案（不是执行回执）</summary><p>{task.proposal.rationale}</p><p>预期：{task.proposal.expectedOutcome}</p><p>风险：{task.proposal.risks.join('；')}</p></details>}
      </section><aside className="ads-card managed-boundary"><h2>托管边界</h2><p className="managed-mode">{managementModeLabels[task.managementMode]}</p><p>{({ manual: '由你管理，AI 不取得操作授权。', suggest: '仅给出建议，不修改平台。', approval: '操作需经过审批，批准可能触发真实执行。', managed: '仅可在有效授权范围内执行，仍受平台与发布保护限制。' })[task.managementMode]}</p><dl><dt>授权有效期</dt><dd>{task.authorization ? `${time(task.authorization.expiresAt)}${Date.parse(task.authorization.expiresAt) <= Date.now() ? '（已过期）' : ''}` : '未授权'}</dd><dt>允许动作</dt><dd>{task.authorization?.allowedActions.map(a => actionNames[a]).join('、') || '无'}</dd><dt>预算边界</dt><dd>{task.authorization ? `${task.currency} ${task.authorization.maxDailyBudget} / 日；总额 ${task.authorization.maxTotalBudget}` : '未设置'}</dd><dt>单次调整上限</dt><dd>{task.authorization ? `${task.authorization.maxAdjustmentPercent}%` : '未设置'}</dd></dl><button className="ads-button primary" onClick={() => setShowSettings(v => !v)}>{showSettings ? '收起设置' : '设置托管 / 人工接管'}</button><p className="ads-muted">撤销托管仅停止后续授权操作，不会自动暂停已经运行的平台广告。</p><button className="ads-text-button" onClick={onPlans}>管理投放计划 →</button></aside></div>
      {showSettings && <section ref={settingsRef} tabIndex={-1} aria-label="计划设置与审批处理" className="managed-settings"><div className="ads-section-title"><h2>计划设置与审批处理</h2><button className="ads-button" onClick={() => { setShowSettings(false); setRefresh(n => n + 1); }}>关闭并刷新动态</button></div><p>先核对动作、金额和账户，再保存或批准。以下操作沿用现有服务校验。</p><AdTaskControls key={`${task.id}-${task.version}`} task={task} onUpdate={onUpdate} /></section>}
    </>}
  </div>;
}
