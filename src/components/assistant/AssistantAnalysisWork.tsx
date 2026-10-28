import { useState } from 'react';
import { Alert, Button } from 'antd';
import { CheckCircle2, Download, Loader2, CircleAlert } from 'lucide-react';
import type { AssistantWork } from '../../../shared/contracts/assistantWork';
import { createAssistantFile, downloadAssistantFile } from '../../lib/assistantFilesApi';
import { productionNavigationIdentity } from '../../lib/productionNavigation';

export function AssistantAnalysisWork({ events, complete, active = false }: { events: AssistantWork[]; complete?: boolean; active?: boolean }) {
  const visible = active && !complete ? events : events.filter(e => e.status !== 'running');
  return <details className="mb-4" open={complete ? undefined : true}>
    <summary className="cursor-pointer text-sm text-text-secondary">{complete ? '分析已完成' : !active || events.some(e => e.status === 'failed') ? '分析未完成' : '正在分析业务资料'}</summary>
    <ol className="mt-3 space-y-2" aria-label="实际分析过程" aria-live="polite">{visible.map(e => <li key={e.id} className="flex items-start gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm">
      {e.status === 'running' ? <Loader2 size={16} className="mt-0.5 shrink-0 motion-safe:animate-spin"/> : e.status === 'failed' ? <CircleAlert size={16} className="mt-0.5 shrink-0 text-danger"/> : <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success"/>}
      <strong className="shrink-0">{e.label}</strong><span className="text-text-secondary">{e.detail}</span>
    </li>)}</ol>
  </details>;
}

export function AssistantReportExport({ content, events, period }: { content: string; events: AssistantWork[]; period: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <div className="mt-4 border-t border-border pt-3">
    <div className="flex justify-end"><Button color="blue" variant="solid" icon={<Download size={14}/>} loading={busy} onClick={async () => {
      if (busy) return;
      const identity = productionNavigationIdentity(); setBusy(true); setError('');
      try {
        const report = `# 投放分析报告\n\n统计范围：${period}（Asia/Shanghai）\n\n${content}\n\n## 分析依据与执行摘要\n${events.map(e => `- ${e.label}：${e.detail}（${e.status === 'completed' ? '完成' : '未完成'}）`).join('\n')}`;
        const file = await createAssistantFile({ title: '投放分析报告', content: report, format: 'pdf', diagram: false });
        if (identity === productionNavigationIdentity()) await downloadAssistantFile(file);
      } catch (reason) { if (identity === productionNavigationIdentity()) setError(reason instanceof Error ? reason.message : '报告导出失败'); }
      finally { setBusy(false); }
    }}>导出报告（PDF）</Button></div>{error && <Alert type="error" title={error} className="mt-2"/>}
  </div>;
}
