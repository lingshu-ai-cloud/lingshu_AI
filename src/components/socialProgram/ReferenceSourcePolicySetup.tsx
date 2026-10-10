import { useRef, useState } from 'react';
import type { SocialProgramRoute, WeeklyOperatingPackage } from '../../../shared/contracts/socialProgram';
import { socialProgramApi } from '../../lib/socialProgramApi';

export default function ReferenceSourcePolicySetup({ pkg, route, onRevision }: {
  pkg: WeeklyOperatingPackage; route: SocialProgramRoute | null; onRevision(next: WeeklyOperatingPackage): void;
}) {
  const identity = JSON.stringify([pkg.programId, pkg.packageId, pkg.version]);
  const current = useRef(identity); current.current = identity;
  const [selection, setSelection] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const policy = pkg.referenceSourcePolicy;
  async function save() {
    if (busy || route !== 'account_repair' || !['40', '20'].includes(selection)) return;
    setBusy(true); setError('');
    try {
      const ownedPercent = Number(selection);
      const next = await socialProgramApi.reviseOperatingPackage(pkg.programId, pkg.packageId, {
        expectedVersion: pkg.version,
        referenceSourcePolicy: { profile: 'b2b_established', ownedPercent, externalPercent: 100 - ownedPercent, allocationUnit: 'mother_content' },
        changeReason: `确认有基础用户本周复刻来源：自有 ${ownedPercent}% / 外部 ${100 - ownedPercent}%`,
      });
      if (next.programId !== pkg.programId || next.packageId !== pkg.packageId || next.version !== pkg.version + 1 || next.status !== 'draft') throw Error('修订身份或版本异常，请重新读取周包。');
      if (current.current === identity) onRevision(next);
    } catch (cause) { if (current.current === identity) setError(cause instanceof Error ? cause.message : '来源配额保存失败。'); }
    finally { if (current.current === identity) setBusy(false); }
  }
  return <div className="mt-3 space-y-3 text-xs">
    <p>{policy ? `当前冻结配额：自有 ${policy.ownedPercent}% / 外部 ${policy.externalPercent}%` : '当前周包尚未确认来源配额'} · 按母版计数</p>
    {pkg.agentPlanning?.directorAnalyses.filter(analysis => analysis.ownedReferenceDiagnosis).map(analysis => {
      const diagnosis = analysis.ownedReferenceDiagnosis!;
      return <div key={analysis.analysisId} className="rounded-lg bg-stone-50 p-3"><p>自有参考：{analysis.benchmarkVideoRefs.map(ref => ref.id).join('、')}</p><p className="mt-1">播放 {diagnosis.observedMetrics.views ?? '未观测'} · 赞 {diagnosis.observedMetrics.likes ?? '未观测'} · 转 {diagnosis.observedMetrics.shares ?? '未观测'} · 评 {diagnosis.observedMetrics.comments ?? '未观测'}</p><p className="mt-1 text-stone-600">调性{diagnosis.toneStatus === 'verified' ? '已核验' : '待核验'} · 获客效果未测量{diagnosis.missingMetrics.length ? ` · 缺少 ${diagnosis.missingMetrics.join('、')}` : ''}</p></div>;
    })}
    {route === 'cold_start' ? <p className="text-stone-600">B to B 零基础首周使用 100% 外部参考。</p> : route === 'account_repair' ? <>
      <label className="block">选择本周经营情况<select aria-label="复刻来源配额" value={selection} disabled={busy} onChange={event => setSelection(event.target.value)} className="mt-2 block w-full rounded-lg border border-stone-200 p-2">
        <option value="">请选择，不自动推断经营情况</option>
        <option value="40">自有 40% / 外部 60% · 调性清晰，获客一般或增长停滞</option>
        <option value="20">自有 20% / 外部 80% · 历史素材不足，播放和赞转评表现较弱</option>
      </select></label>
      <p className="text-stone-500">保留自有账号调性，同时探索外部创作方向。保存后生成新草稿，重新确认本周参考、素材消费者和发布承接。</p>
      <button type="button" disabled={busy || !selection} onClick={() => void save()} className="btn-primary disabled:opacity-40">{busy ? '正在保存新版本…' : '确认配额并修订周包'}</button>
    </> : <p className="text-amber-700">请先确认经营项目的用户画像。</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </div>;
}
