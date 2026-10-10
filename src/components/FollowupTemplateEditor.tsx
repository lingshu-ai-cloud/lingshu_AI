import { useEffect, useState } from 'react';
import { authHeader } from '../lib/auth';

export interface FollowupTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  body: string;
  variableCount: number;
}
export const needsFollowupTemplate = (item: { send_mode?: string; template_status?: string }) => item.send_mode === 'template_required' || item.template_status === 'not_configured';
export const templatePreview = (template: FollowupTemplate, variables: string[]) => template.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => variables[Number(n) - 1]?.trim() || `【内容 ${n}】`);
const errorLabels: Record<string, string> = {
  tenant_whatsapp_templates_not_configured: '请先在账号设置中连接 WhatsApp 商业账号，再加载已获批模板。',
  whatsapp_template_catalog_unavailable: '暂时无法读取模板目录，请稍后重试。',
  approved_whatsapp_template_required: '所选模板已不可用或尚未获批，请刷新目录后重新选择。',
  whatsapp_template_variables_invalid: '请完整填写模板中的所有内容。',
};
async function templateRequest(route: string, init: RequestInit = {}, request: typeof fetch = fetch) {
  const response = await request(`/api/overseas/digital-employees/followup/${route}`, { ...init, headers: { ...authHeader(), ...(init.body ? { 'Content-Type': 'application/json' } : {}) } }).catch(() => { throw Error('暂时无法连接服务，请稍后重试。'); });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(errorLabels[data.error] || '模板操作未完成，请刷新后重试。');
  return data;
}
export async function saveFollowupTemplate(batchId: string, itemId: string, template: FollowupTemplate, variables: string[], request: typeof fetch = fetch) {
  if (template.status !== 'APPROVED' || variables.length !== template.variableCount || variables.some(value => !value.trim())) throw Error('请选择已获批模板，并完整填写所需内容。');
  return templateRequest(`batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/template`, { method: 'PUT', body: JSON.stringify({ templateName: template.name, language: template.language, variables: variables.map(value => value.trim()) }) }, request);
}

interface FormProps {
  templates: FollowupTemplate[]; loading: boolean; busy: boolean; error: string; selected: string; variables: string[];
  onSelect: (id: string) => void; onVariables: (values: string[]) => void; onRetry: () => void; onSave: () => void;
}
export function FollowupTemplateForm({ templates, loading, busy, error, selected, variables, onSelect, onVariables, onRetry, onSave }: FormProps) {
  const approved = templates.filter(template => template.status === 'APPROVED');
  const template = approved.find(item => item.id === selected);
  const ready = template && variables.length === template.variableCount && variables.every(value => value.trim());
  return <div className="mt-3 space-y-3 border-l-2 border-amber bg-amber-dim px-4 py-3 text-sm text-text-primary">
    <p className="font-semibold">配置 WhatsApp 获批模板</p>
    <p className="text-xs leading-5 text-text-secondary">已超过 24 小时会话窗口。选择模板并补全内容后，需要重新审批才能发送。</p>
    {loading ? <p role="status" className="text-xs text-text-muted">正在加载模板…</p> : <>
      {error && <p role="alert" className="border-l-2 border-red bg-white/70 px-3 py-2 text-red">{error}</p>}
      {!approved.length && !error && <p className="text-xs leading-5 text-text-secondary">暂无可用的获批模板，请先在 WhatsApp 商业账号中提交模板并等待获批。</p>}
      <button type="button" className="inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-white px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-border-bright hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:opacity-50" disabled={busy} onClick={onRetry}>刷新模板目录</button>
      {!!approved.length && <>
        <label className="block text-xs font-semibold text-text-secondary">消息模板<select aria-label="选择消息模板" className="ui-field mt-1.5 !min-h-10 !rounded-md !px-3 !py-2 !text-sm" disabled={busy} value={selected} onChange={event => onSelect(event.target.value)}><option value="">请选择模板</option>{approved.map(item => <option key={item.id} value={item.id}>{item.name} · {item.language}</option>)}</select></label>
        {template && <>{Array.from({ length: template.variableCount }, (_, index) => <label key={index} className="block text-xs font-semibold text-text-secondary">内容 {index + 1}<input aria-label={`模板内容 ${index + 1}`} className="ui-field mt-1.5 !min-h-10 !rounded-md !px-3 !py-2 !text-sm" disabled={busy} value={variables[index] || ''} onChange={event => onVariables(variables.map((value, at) => at === index ? event.target.value : value))} /></label>)}
          <div className="border-y border-[#e7cfba] bg-white/60 px-3 py-3"><p className="text-xs font-semibold text-[#805c47]">客户将收到的内容</p><p className="mt-1 whitespace-pre-wrap break-words leading-6 text-text-primary">{templatePreview(template, variables)}</p></div>
          <button type="button" disabled={busy || !ready} onClick={onSave} className="inline-flex min-h-10 items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 disabled:opacity-50">{busy ? '正在保存…' : '保存模板，等待重新审批'}</button>
        </>}
      </>}
    </>}
  </div>;
}

export default function FollowupTemplateEditor({ batchId, itemId, onSaved }: { batchId: string; itemId: string; onSaved: () => Promise<void> | void }) {
  const [templates, setTemplates] = useState<FollowupTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [variables, setVariables] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError(''); setSelected(''); setVariables([]); setTemplates([]);
    void templateRequest('templates', { signal: abort.signal }).then(data => {
      if (!abort.signal.aborted) setTemplates(Array.isArray(data.items) ? data.items : []);
    }).catch(error => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : '模板目录加载失败'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [batchId, itemId, refresh]);
  const save = async () => {
    const template = templates.find(item => item.id === selected);
    if (!template || busy) return;
    setBusy(true); setError('');
    try { await saveFollowupTemplate(batchId, itemId, template, variables); await onSaved(); }
    catch (error) { setError(error instanceof Error ? error.message : '模板保存失败'); }
    finally { setBusy(false); }
  };
  return <FollowupTemplateForm templates={templates} loading={loading} busy={busy} error={error} selected={selected} variables={variables} onSelect={id => { setSelected(id); setVariables(Array(templates.find(item => item.id === id)?.variableCount || 0).fill('')); }} onVariables={setVariables} onRetry={() => setRefresh(value => value + 1)} onSave={() => void save()} />;
}
