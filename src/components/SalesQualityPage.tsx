import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import { authHeader } from '../lib/auth';

interface QualityResult {
  benchmarkVersion: string;
  runAt: string;
  totalCases: number;
  metrics: { intentAccuracy: number; evidenceExtractionAccuracy: number; nextActionAcceptance: number; handoffAccuracy: number; directAnswerRate: number; unauthorizedCommitments: number };
  hardGate: { passed: boolean; rule: string };
  layers: Record<string, { cases: number; passed: number }>;
  failures: Array<{ caseId: string; issues: string[] }>;
}
const METRIC_LABEL: Record<string, string> = {
  intentAccuracy: '意图识别', evidenceExtractionAccuracy: '证据提取', nextActionAcceptance: '下一动作', handoffAccuracy: '转人工判断', directAnswerRate: '直接回答', unauthorizedCommitments: '未授权承诺',
};
const LAYER_LABEL: Record<string, string> = {
  public_expression: '公开自然表达', simulated_enterprise_fact: '模拟企业事实', expert_gold: '销售专家金标准', multi_turn_branch: '多轮分支',
};

export default function SalesQualityPage() {
  const [result, setResult] = useState<QualityResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const load = async (run = false) => {
    setRunning(true); setError('');
    try {
      const response = await fetch(`/api/overseas/sales-operations/quality${run ? '/run' : ''}`, { method: run ? 'POST' : 'GET', headers: authHeader() });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || '评测运行失败');
      setResult(value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '评测运行失败'); }
    finally { setRunning(false); }
  };
  useEffect(() => { void load(); }, []);

  return <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70">
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex items-start justify-between gap-5">
        <div><div className="flex items-center gap-2 text-cyan-700"><ShieldCheck size={18}/><span className="text-xs font-bold">销售回复质量</span></div><h1 className="mt-2 text-xl font-black text-slate-950">离线评测中心</h1><p className="mt-1 text-sm text-slate-500">在没有真实销售对话时，使用隐私安全的公开表达模式、模拟企业事实和专家金标准建立可重复基线。</p></div>
        <button type="button" disabled={running} onClick={() => void load(true)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">{running ? <RefreshCw size={14} className="animate-spin"/> : <Play size={14}/>}运行全部评测</button>
      </div>
      {error && <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {result && <>
        <section className={`mt-6 rounded-2xl border p-5 ${result.hardGate.passed ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
          <div className="flex items-start gap-3">{result.hardGate.passed ? <CheckCircle2 className="mt-0.5 text-emerald-600" size={20}/> : <AlertTriangle className="mt-0.5 text-red-600" size={20}/>}<div><p className={`text-sm font-black ${result.hardGate.passed ? 'text-emerald-800' : 'text-red-800'}`}>{result.hardGate.passed ? '安全硬门槛通过' : '安全硬门槛未通过'}</p><p className="mt-1 text-xs text-slate-600">{result.hardGate.rule}</p><p className="mt-1 text-[11px] text-slate-500">{result.benchmarkVersion} · {result.totalCases} 个用例 · {new Date(result.runAt).toLocaleString()}</p></div></div>
        </section>
        <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(result.metrics).map(([key, value]) => <div key={key} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-[11px] font-bold text-slate-500">{METRIC_LABEL[key] || key}</p><p className={`mt-2 text-2xl font-black ${key === 'unauthorizedCommitments' ? value === 0 ? 'text-emerald-600' : 'text-red-600' : 'text-slate-950'}`}>{key === 'unauthorizedCommitments' ? value : `${value}%`}</p><p className="mt-1 text-[10px] text-slate-400">{key === 'unauthorizedCommitments' ? '必须始终为 0' : '确定性基线得分'}</p></div>)}</section>
        <section className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-sm font-black text-slate-950">数据分层覆盖</h2><div className="mt-4 space-y-3">{Object.entries(result.layers).map(([key, layer]) => { const rate = layer.cases ? Math.round(layer.passed / layer.cases * 100) : 0; return <div key={key}><div className="flex items-center justify-between text-xs"><span className="font-bold text-slate-700">{LAYER_LABEL[key] || key}</span><span className="text-slate-500">{layer.passed}/{layer.cases} 通过</span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-cyan-600" style={{ width: `${rate}%` }}/></div></div>; })}</div></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-sm font-black text-slate-950">待改进用例</h2>{result.failures.length ? <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{result.failures.map(failure => <div key={failure.caseId} className="rounded-xl bg-amber-50 px-3 py-2"><p className="text-xs font-bold text-amber-800">{failure.caseId}</p><p className="mt-1 text-[10px] text-amber-700">{failure.issues.join(' · ')}</p></div>)}</div> : <div className="mt-8 text-center"><CheckCircle2 size={24} className="mx-auto text-emerald-500"/><p className="mt-2 text-xs font-bold text-slate-700">全部用例通过</p></div>}</div>
        </section>
        <p className="mt-4 rounded-xl bg-white px-4 py-3 text-[11px] leading-5 text-slate-500">边界：公开表达只补充自然语言分布，不作为企业事实；离线通过也不能证明提升成交率，真实效果必须进入小规模试点后观察。</p>
      </>}
    </div>
  </main>;
}
