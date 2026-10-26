import { useState } from 'react';
import { Alert, Button, Input, Modal, Space } from 'antd';
import { Field } from './EnterpriseFormControls';
import type { FaqPack, Profile } from './enterpriseProfileTypes';
import { saveTenantFaqPack } from './tenantFaqPackApi';

export default function EnterpriseFaqPackEditor({ pack, profile, identity, onClose, onSaved }: {
  pack: FaqPack; profile: Profile; identity: string; onClose: () => void;
  onSaved: (patch: Pick<Profile, 'faqPackOverrides' | 'factVersion'>) => void;
}) {
  const [rows, setRows] = useState(() => pack.items.map((item, index) => ({ id: `entry-${index}`, q: item.q, a: item.a })));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const patch = await saveTenantFaqPack(profile, pack.id, rows.map(({q, a}) => ({q, a})), identity);
      onSaved(patch); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(false); }
  };
  return <Modal open title={`编辑场景 · ${pack.industryLabel} · ${pack.scenarioLabel}`} width={720} centered
    closable={!busy} maskClosable={false} onCancel={onClose}
    footer={<Space><Button disabled={busy} onClick={onClose}>取消</Button><Button type="primary" loading={busy} onClick={() => void save()}>保存此租户场景</Button></Space>}>
    <Alert showIcon type="info" title="仅保存到当前租户" description="修改不会影响公共模板或其他租户，也不会自动导入或批准为客服答复。当前页面其他未保存资料仍保留为草稿。" />
    <div className="mt-4 max-h-[55vh] space-y-4 overflow-y-auto pr-2">
      {rows.map((row, index) => <section key={row.id} className="rounded-lg border border-border p-4">
        <div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold">问答 {index + 1}</span><Button size="small" disabled={busy || rows.length <= 1} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}>移除此条</Button></div>
        <Field label={`问题 ${index + 1}`}><Input disabled={busy} maxLength={300} value={row.q} onChange={e => setRows(current => current.map(item => item.id === row.id ? {...item, q: e.target.value} : item))} /></Field>
        <Field label={`答案 ${index + 1}`}><Input.TextArea disabled={busy} rows={3} maxLength={5000} value={row.a} onChange={e => setRows(current => current.map(item => item.id === row.id ? {...item, a: e.target.value} : item))} /></Field>
      </section>)}
      <Button disabled={busy || rows.length >= 50} onClick={() => setRows(current => [...current, { id: crypto.randomUUID(), q: '', a: '' }])}>添加问答</Button>
    </div>
    {error && <Alert className="mt-3" showIcon type="error" title={error} />}
  </Modal>;
}
