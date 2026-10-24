import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Empty, Radio, Select, Spin, Tag } from 'antd';
import { ArrowDown, ArrowUp, GripVertical, Plus, RotateCw, X } from 'lucide-react';
import { useAssistantStore } from '../../stores/assistantStore';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import { VIDEO_LANGUAGES } from '../../../shared/contracts/videoLanguages';
import { MATERIAL_TYPE_LABELS } from '../../../shared/benchmarkAnalysis';
import type { CreationReply, CreationTurn } from '../../../shared/contracts/contentCreationDialogue';
import type { GuideNode, GuidedSelection } from '../../../shared/contracts/guidedCreation';
import { requestCreationReply } from './contentCreationRequest';
import { AuthenticatedVideo } from '../inspiration/InspirationMedia';
import GuidedCreationSubmission from './GuidedCreationSubmission';

const types: GuideNode['type'][] = ['talking_head', 'factory', 'product', 'consumer_demo', 'general'];
export default function GuidedCreationChoices({ reply }: { reply?: CreationReply }) {
  const selection = useAssistantStore(state => state.threads.business.creationDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [activeNode, setActiveNode] = useState(0);
  const [dragging, setDragging] = useState<string | null>(null);
  const [tutorial, setTutorial] = useState(true);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const current = reply?.guided && reply.selection.referenceId === selection?.referenceId ? reply : undefined;
  const guide = selection?.guided;
  const run = async (action: CreationTurn['action'], answer?: string) => {
    if (lock.current || !selection || !guide) return;
    lock.current = true; setBusy(true); setError('');
    const identity = productionNavigationIdentity();
    const expected = selection;
    const abort = new AbortController(); controller.current = abort;
    const isCurrent = () => mounted.current && identity === productionNavigationIdentity() && useAssistantStore.getState().threads.business.creationDraft === expected;
    if (answer) {
      const store = useAssistantStore.getState();
      store.setMessages('business', [...store.threads.business.messages, { role: 'user', content: answer }]);
    }
    try { await requestCreationReply({ turn: { action, selection, instruction: answer || '读取所选参考的产品与语言选项' }, controller: abort, isCurrent, persist: () => {} }); }
    catch (cause) { if (isCurrent() && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : '读取失败，请重试。'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { if (guide && !current && !lock.current) void run('start'); }, [selection?.referenceId]); // Selection snapshot is fenced by run.
  if (!selection || !guide) return null;
  const change = (patch: Partial<GuidedSelection>, productIds = selection.productIds) => useAssistantStore.getState().hydrateThread('business', { creationDraft: { ...selection, productIds, guided: { ...guide, ...patch } } });
  const stage = current?.stage || 'guided_products';
  const data = current?.guided;
  const custom = guide.structureId === 'custom';
  const move = (id: string, offset: number) => {
    const nodes = [...guide.customNodes], from = nodes.findIndex(node => node.id === id), to = from + offset;
    if (from < 0 || to < 0 || to >= nodes.length) return;
    const [node] = nodes.splice(from, 1); nodes.splice(to, 0, node!); change({ customNodes: nodes, assignments: [] });
  };
  const refresh = () => void run('guided_products', '刷新当前产品、语言和结构证据');
  const answerNode = (nodeId: string, intent: 'match' | 'generate', candidateId?: string) => {
    change({ assignments: [...guide.assignments.filter(row => row.nodeId !== nodeId), { nodeId, intent, ...(candidateId ? { candidateId } : {}) }] });
    setActiveNode(index => Math.min(index + 1, Math.max(0, (data?.nodes.length || 1) - 1)));
  };
  return <section className="guided-creation" aria-label="自由创作当前问题" aria-busy={busy}>
    {busy && <Spin size="small" description="正在核验当前选择"/>}
    {error && <Alert type="error" showIcon title={error} action={<Button onClick={refresh} disabled={busy}>刷新证据</Button>}/>}
    {stage === 'guided_products' && <div className="guided-creation__answer-row">
      <label>产品<Select aria-label="选择创作产品" mode="multiple" showSearch={{ optionFilterProp: 'label' }} maxCount={12} disabled={busy} value={selection.productIds}
        options={current?.products.map(row => ({ label: row.name, value: row.id })) || []} placeholder="搜索并勾选产品"
        optionRender={option => <Checkbox checked={selection.productIds.includes(String(option.value))} style={{ pointerEvents: 'none' }}>{option.label}</Checkbox>}
        onChange={productIds => change({ structureId: undefined, assignments: [], taskId: undefined }, productIds)}/></label>
      <label>视频语言<Select aria-label="选择视频语言" mode="multiple" showSearch={{ optionFilterProp: 'label' }} disabled={busy} value={guide.languages} placeholder="搜索并勾选语言"
        options={Object.entries(VIDEO_LANGUAGES).map(([value, label]) => ({ value, label }))}
        optionRender={option => <Checkbox checked={guide.languages.includes(String(option.value))} style={{ pointerEvents: 'none' }}>{option.label}</Checkbox>}
        onChange={languages => change({ languages, taskId: undefined })}/></label>
      <Button type="primary" disabled={busy || !selection.productIds.length || !guide.languages.length} onClick={() => void run('guided_products', `产品：${current?.products.filter(row => selection.productIds.includes(row.id)).map(row => row.name).join('、')}；语言：${guide.languages.map(lang => VIDEO_LANGUAGES[lang as keyof typeof VIDEO_LANGUAGES]).join('、')}`)}>确认产品和语言</Button>
    </div>}
    {stage === 'guided_structure' && <>
      <Radio.Group aria-label="选择爆款结构" value={guide.structureId} disabled={busy} onChange={event => change({ structureId: event.target.value, assignments: [], taskId: undefined })} className="guided-creation__structures">
        {data?.structures.map(value => <Radio key={value.id} value={value.id} disabled={!value.available}>
          <strong>{value.source === 'reference' ? '沿用对标视频结构' : value.source === 'recommended' ? '推荐爆款结构' : value.title}</strong>
          <p>{value.nodes.length ? value.nodes.map(node => MATERIAL_TYPE_LABELS[node.type]).join(' → ') : value.source === 'custom' ? '自行添加素材类型，可重复组合' : '逐镜证据待补齐'}</p>
          {value.source === 'recommended' && <p>来源：{value.title} · {value.crawledAt ? `入库 ${value.crawledAt.slice(0, 10)}` : '入库时间未记录'} · {value.views !== undefined ? `${value.views.toLocaleString()} 次浏览` : '浏览量未记录'}</p>}
          <small>{value.reason}</small>
        </Radio>)}
      </Radio.Group>
      {custom && <div className="guided-creation__custom" aria-label="自定义爆款结构">
        <div className="guided-creation__type-actions">{types.map(type => <Button key={type} size="small" icon={<Plus size={14}/>} disabled={busy || guide.customNodes.length >= 24} onClick={() => change({ customNodes: [...guide.customNodes, { id: `custom:${crypto.randomUUID()}`, type }], assignments: [] })}>{MATERIAL_TYPE_LABELS[type]}</Button>)}</div>
        <ol>{guide.customNodes.map((node, index) => <li key={node.id} draggable={!busy} onDragStart={() => setDragging(node.id)} onDragOver={event => event.preventDefault()} onDrop={() => { if (dragging) move(dragging, index - guide.customNodes.findIndex(value => value.id === dragging)); setDragging(null); }} onDragEnd={() => setDragging(null)}>
          <GripVertical size={14}/><span>{index + 1}. {MATERIAL_TYPE_LABELS[node.type]}</span>
          <Button type="text" size="small" aria-label={`上移节点 ${index + 1}`} disabled={busy || index === 0} icon={<ArrowUp size={14}/>} onClick={() => move(node.id, -1)}/>
          <Button type="text" size="small" aria-label={`下移节点 ${index + 1}`} disabled={busy || index === guide.customNodes.length - 1} icon={<ArrowDown size={14}/>} onClick={() => move(node.id, 1)}/>
          <Button type="text" size="small" aria-label={`删除节点 ${index + 1}`} disabled={busy} icon={<X size={14}/>} onClick={() => change({ customNodes: guide.customNodes.filter(value => value.id !== node.id), assignments: [] })}/>
        </li>)}</ol>
        {tutorial && <div className="guided-creation__tutorial">拖住左侧手柄前后换顺序，也可用上下箭头；重复点击类型按钮可添加同类镜头。<Button type="text" size="small" onClick={() => setTutorial(false)}>知道了</Button></div>}
      </div>}
      {data?.notices.map(notice => <p role="status" className="guided-creation__notice" key={notice}>{notice}</p>)}
      <Button type="primary" disabled={busy || !guide.structureId || (custom && !guide.customNodes.length)} onClick={() => void run('guided_structure', `采用${custom ? '自定义' : data?.structures.find(value => value.id === guide.structureId)?.title}结构`)}>采用这个结构</Button>
    </>}
    {stage === 'guided_production' && <>
      <Radio.Group aria-label="选择分镜制作方式" value={guide.productionMode} disabled={busy} onChange={event => change({ productionMode: event.target.value, assignments: [], taskId: undefined })} options={[{ label: '逐个选择分镜', value: 'manual' }, { label: '智能一键匹配', value: 'auto' }]}/>
      <Radio.Group aria-label="选择出镜方式" value={guide.presenterMode} disabled={busy} onChange={event => change({ presenterMode: event.target.value, assignments: [], taskId: undefined })} options={[{ label: '需要数字人', value: 'digital' }, { label: '加入实拍任务', value: 'shoot' }, { label: '不需要', value: 'none' }]}/>
      {guide.presenterMode === 'none' && <p className="guided-creation__notice">真人口播节点保留表达功能，用本地产品／工厂画面加画外音替代。</p>}
      {guide.productionMode === 'auto' && <p>后台匹配本地画面，数字人节点使用已授权的人物、音色和产品资产；现在不调用付费生成。</p>}
      {guide.productionMode === 'manual' && <ol className="guided-creation__nodes">{data?.nodes.map((node, index) => <li key={node.id} data-active={activeNode === index}>
        <Button type={activeNode === index ? 'primary' : 'default'} onClick={() => setActiveNode(index)} disabled={busy}>{index + 1}. {MATERIAL_TYPE_LABELS[node.type]} {guide.assignments.some(row => row.nodeId === node.id) ? '✓' : ''}</Button>
        {activeNode === index && <div className="guided-creation__candidates" aria-label={`节点 ${index + 1} 素材候选`}>
          {node.candidates.map(id => { const shot = current?.shots.find(value => value.id === id); return shot ? <button type="button" key={id} disabled={busy} onClick={() => answerNode(node.id, 'match', id)} aria-label={`采用片段 ${shot.title}`}>
            {shot.previewUrl ? <AuthenticatedVideo apiUrl={`${shot.previewUrl}#t=${shot.start},${shot.end}`} previewFrame hoverPlay className="guided-creation__candidate-video"/> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无片段预览"/>}<span>{shot.title}</span><small>{shot.start}–{shot.end} 秒 · 候选</small>
          </button> : null; })}
          <button type="button" disabled={busy} className="guided-creation__generate" onClick={() => answerNode(node.id, 'generate')}><RotateCw size={20}/><span>重新生成</span><small>全部确认后统一执行</small></button>
          {!node.candidates.length && <p>当前节点暂无匹配候选，不以参考片代替产品实拍。</p>}
        </div>}
      </li>)}</ol>}
      <Button type="primary" disabled={busy || !guide.productionMode || !guide.presenterMode || (guide.productionMode === 'manual' && data?.nodes.some(node => !guide.assignments.some(value => value.nodeId === node.id)))} onClick={() => void run('guided_production', `制作方式：${guide.productionMode === 'auto' ? '智能匹配' : '逐镜选择'}；出镜：${guide.presenterMode}`)}>整理创作方案</Button>
    </>}
    {stage === 'guided_review' && current && <GuidedCreationSubmission reply={current} onRefresh={() => void run('guided_review', '重新核验当前创作方案')}/>}
    {stage !== 'guided_products' && <Button type="text" disabled={busy} onClick={() => void run('start', '重新选择产品和语言')}>重新选择产品与语言</Button>}
  </section>;
}
