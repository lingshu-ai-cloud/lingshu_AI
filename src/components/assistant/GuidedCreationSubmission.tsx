import { useRef, useState } from 'react';
import { Alert, Button, Collapse, Tag } from 'antd';
import type { CreationReply } from '../../../shared/contracts/contentCreationDialogue';
import { MATERIAL_TYPE_LABELS } from '../../../shared/benchmarkAnalysis';
import { VIDEO_LANGUAGES } from '../../../shared/contracts/videoLanguages';
import { useAssistantStore } from '../../stores/assistantStore';
import { authHeader } from '../../lib/auth';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import GuidedCreationTask from './GuidedCreationTask';

export default function GuidedCreationSubmission({ reply, onRefresh, onBack }: { reply: CreationReply; onRefresh: () => void; onBack: () => void }) {
  const guided = reply.guided!;
  const missingClips = guided.blockers.filter(row => row.code === 'creation_material_required').length;
  const dependencyText = (row: typeof guided.blockers[number]) => {
    const index = guided.nodes.findIndex(node => node.id === row.nodeId), node = guided.nodes[index];
    return node && row.message.startsWith(`${node.id} `) ? `第 ${index + 1} 镜（${MATERIAL_TYPE_LABELS[node.type]}）：${row.message.slice(node.id.length + 1)}` : row.message;
  };
  const selection = useAssistantStore(state => state.threads.business.creationDraft);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  const submit = async () => {
    if (lock.current || !selection || guided.blockers.length) return;
    const identity = productionNavigationIdentity(), expected = selection;
    const current = () => identity === productionNavigationIdentity() && useAssistantStore.getState().threads.business.creationDraft === expected;
    lock.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/overseas/starter-198/social-content/guided-creation/submit', { method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json', 'Idempotency-Key': `guided:${guided.fingerprint}` }, body: JSON.stringify({ selection, fingerprint: guided.fingerprint }), signal: AbortSignal.timeout(45000) });
      const body = await response.json();
      if (!current()) return;
      if (!response.ok || typeof body.taskId !== 'string') throw new Error(body.message || body.code || body.error || '提交未完成，请核验状态后重试。');
      useAssistantStore.getState().hydrateThread('business', { creationDraft: { ...selection, guided: { ...selection.guided!, taskId: body.taskId } } });
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : '提交结果待查询，请保持当前方案重试，原请求不会重复创建任务。'); }
    finally { lock.current = false; setBusy(false); }
  };
  if (selection?.guided?.taskId) return <GuidedCreationTask taskId={selection.guided.taskId} fingerprint={guided.fingerprint}/>;
  return <div className="guided-creation__review">
    <h3>确认创作</h3>
    <p>{reply.products.filter(row => reply.selection.productIds.includes(row.id)).map(row => row.name).join('、')}</p>
    <p>{reply.selection.guided?.languages.map(lang => <Tag key={lang}>{VIDEO_LANGUAGES[lang as keyof typeof VIDEO_LANGUAGES]}</Tag>)}</p>
    <p>{guided.nodes.length} 个镜头 · 自动口播 · 默认字幕 · 后台选择配乐</p>
    {guided.blockers.length > 0 && <Alert type="warning" showIcon title="以下真实依赖尚需补齐" description={<><p>{missingClips > 0 ? `${missingClips} 个镜头暂无通过生产校验的素材；参考片不会替代企业实拍。` : '以下依赖尚未满足，补齐后可继续使用原生产链路。'}</p><Collapse ghost items={[{ key: 'dependencies', label: `查看待补明细（${guided.blockers.length}）`, children: <ul>{guided.blockers.map((row, index) => <li key={`${row.code}:${index}`}>{dependencyText(row)}</li>)}</ul> }]}/></>}/>}
    {error && <Alert type="warning" showIcon title={error}/>}
    <Button type="primary" loading={busy} disabled={guided.blockers.length > 0} onClick={() => void submit()}>确认生成</Button>
    <Button disabled={busy} onClick={onBack}>调整分镜制作方式</Button>
    <Button disabled={busy} onClick={onRefresh}>重新核验</Button>
  </div>;
}
