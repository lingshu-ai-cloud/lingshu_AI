import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Select, Space } from 'antd';
import { createAssistantCatalogProduct, readAssistantProductCatalog, type AssistantCatalogProduct } from '../../lib/assistantProductCatalog';
import { socialContentApi } from '../../lib/socialContentApi';
import { submitContentIntakeBatch } from '../../lib/assistantContentIntakeBatch';

export const CONTENT_INTAKE_QUESTIONS = [
  '这次要为哪个产品制作内容？请从企业知识库选择一个或多个产品，也可以新建产品。',
  '这条内容想达到什么目标？例如介绍新品、突出某个卖点，或制作一条口播。',
  '准备发布到哪个平台？',
  '希望什么时候交付？请选择交付截止时间（北京时间）。',
] as const;
type Receipt = Awaited<ReturnType<typeof socialContentApi.createAssistantAction>>;
type IntakeHints = { formats?: string[]; aspectRatio?: string | null; targetDurationSeconds?: number | null };
type Options = { scopeKey: string; page: string; append: (role: 'assistant' | 'user', text: string) => void; onReceipt: (result: Receipt) => void; onFinish: (taskId: string) => void };

/** Collecting answers is local only. No production request occurs before explicit final confirmation. */
export function useContentTaskIntake(options: Options) {
  const [step, setStep] = useState<number | null>(null);
  const [products, setProducts] = useState<AssistantCatalogProduct[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [objective, setObjective] = useState('');
  const [platform, setPlatform] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newInfo, setNewInfo] = useState('');
  const generation = useRef(0);
  const locked = useRef(false);
  const keys = useRef(new Map<string, string>());
  const completed = useRef(new Map<string, string>());
  const hints = useRef<IntakeHints>({});
  const latest = useRef(options); latest.current = options;
  useEffect(() => {
    generation.current++; locked.current = false; setStep(null); setBusy(false); setCatalogLoading(false);
    return () => { generation.current++; };
  }, [options.scopeKey, options.page]);

  const refresh = async () => {
    const epoch = generation.current; setCatalogLoading(true); setError('');
    try { const items = await readAssistantProductCatalog(); if (epoch === generation.current) { setProducts(items); setSelected(previous => previous.filter(id => items.some(item => item.id === id))); } }
    catch (cause) { if (epoch === generation.current) setError(cause instanceof Error ? cause.message : '产品读取失败'); }
    finally { if (epoch === generation.current) setCatalogLoading(false); }
  };
  const start = (initialObjective = '', initialHints: IntakeHints = {}) => {
    if (step !== null) return;
    generation.current++; keys.current.clear(); completed.current.clear();
    hints.current = initialHints;
    setSelected([]); setObjective(initialObjective); setPlatform(''); setDueAt(''); setError(''); setAdding(false); setNewName(''); setNewInfo(''); setStep(0);
    options.append('assistant', CONTENT_INTAKE_QUESTIONS[0]); void refresh();
  };
  const cancel = () => {
    if (locked.current) return;
    generation.current++; setStep(null); setCatalogLoading(false);
    options.append('assistant', '已取消本次收集，不再创建任务。已保存到知识库的产品和已创建的任务不会删除。');
  };
  const advance = (answer: string, next: number) => {
    options.append('user', answer); setError(''); setStep(next);
    options.append('assistant', next === 4 ? '信息已收齐，请核对后确认创建。多选产品将为每个产品分别创建一个周任务；确认后立即尝试生产，截止时间不是预约启动时间。' : CONTENT_INTAKE_QUESTIONS[next]);
  };
  const answer = (text: string) => {
    if (step === null) return false;
    if (busy) return true;
    const value = text.trim();
    if (/^(取消|退出)$/u.test(value)) { cancel(); return true; }
    if (step === 1) {
      if (!value || value.length > 1000) { setError('请填写1～1000字的内容目标。'); return true; }
      setObjective(value); advance(value, 2);
    } else if (step === 2) {
      const resolved = ({ tiktok: 'tiktok', 抖音: 'tiktok', instagram: 'instagram', ig: 'instagram', facebook: 'facebook', fb: 'facebook', youtube: 'youtube', linkedin: 'linkedin', '领英': 'linkedin' } as Record<string, string>)[value.toLowerCase()];
      if (resolved) { setPlatform(resolved); advance(resolved, 3); } else setError('请选择下面的平台，或输入 TikTok、Instagram、Facebook、YouTube、LinkedIn。');
    } else if (step === 3) {
      const date = value.replace(' ', 'T');
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}+08:00`)) || Date.parse(`${date}+08:00`) <= Date.now()) {
        setError('请选择未来的北京时间，或输入“2026-10-18 18:00”这样的明确日期时间。'); return true;
      }
      setDueAt(date); advance(`${date.replace('T', ' ')} 北京时间`, 4);
    } else setError(step === 0 ? '请使用下方产品下拉列表选择，或点击新建产品。' : '请使用下方确认按钮创建，或返回修改。');
    return true;
  };
  const saveProduct = async () => {
    if (locked.current) return; locked.current = true; setBusy(true); setError('');
    const epoch = generation.current;
    try {
      const item = await createAssistantCatalogProduct(newName, newInfo);
      if (epoch !== generation.current) return;
      setProducts(previous => [...previous.filter(value => value.id !== item.id), item]);
      setSelected(previous => [...new Set([...previous, item.id])]); setAdding(false); setNewName(''); setNewInfo('');
      latest.current.append('assistant', `产品「${item.name}」已保存到企业知识库并选中。请确认本次要制作的产品。`);
    } catch (cause) { if (epoch === generation.current) setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { if (epoch === generation.current) { locked.current = false; setBusy(false); } }
  };
  const submit = async () => {
    if (locked.current || step !== 4) return;
    if (!selected.length || !objective.trim() || !platform || Date.parse(`${dueAt}+08:00`) <= Date.now() || !Number.isFinite(Date.parse(`${dueAt}+08:00`))) { setError('信息不完整或截止时间已过，请返回修改。'); return; }
    locked.current = true; setBusy(true); setError(''); const epoch = generation.current;
    try {
      await submitContentIntakeBatch<Receipt>({ ids: selected, keys: keys.current, completed: completed.current,
        isCurrent: () => epoch === generation.current, taskId: result => result.receipt.taskId,
        onResult: result => latest.current.onReceipt(result), create: async (id, key) => {
        const product = products.find(item => item.id === id);
        if (!product) throw new Error('所选产品已不可用，请返回重新选择。');
        return socialContentApi.createAssistantAction({
          title: `${product.name} · ${objective}`.slice(0, 100), objective: objective.trim(), productId: id, productRef: product.name,
          platforms: [platform], formats: hints.current.formats || ['短视频'], aspectRatio: hints.current.aspectRatio || '9:16',
          targetDurationSeconds: hints.current.targetDurationSeconds, requestedOutputCount: 1,
          dueAt: new Date(`${dueAt}+08:00`).toISOString(), planningMode: 'auto_adjust', restrictions: [], mode: 'weekly',
          creationMode: 'material_processing', assetAvailability: 'none', managementMode: 'one_click_managed', productionMode: 'social_ready', productionApproach: 'ai_enhanced',
        }, key);
      } });
      if (epoch !== generation.current) return;
      setStep(null); latest.current.onFinish([...completed.current.values()].at(-1)!);
    } catch (cause) { if (epoch === generation.current) setError(`${cause instanceof Error ? cause.message : '创建失败'}${completed.current.size ? `（已成功创建${completed.current.size}个，重试不会重复创建）` : ''}`); }
    finally { if (epoch === generation.current) { locked.current = false; setBusy(false); } }
  };
  const picked = products.filter(item => selected.includes(item.id));
  const node = step === null ? null : <div data-assistant-content-intake className="ml-9 min-w-0 space-y-3" aria-label="内容任务逐项问答" aria-busy={busy || catalogLoading}>
    <p className="text-xs text-text-muted">{step < 4 ? `第${step + 1}/4项` : '确认任务'}</p>
    {error && <Alert type="error" showIcon title={error} />}
    {step === 0 && <>
      <Select aria-label="企业知识库产品（可多选）" mode="multiple" showSearch={{ optionFilterProp: 'label' }} style={{ width: '100%' }} loading={catalogLoading} disabled={busy || catalogLoading} value={selected} options={products.map(item => ({ value: item.id, label: item.name }))} onChange={setSelected} placeholder="选择知识库产品，可多选" notFoundContent="暂无产品，可新建产品或刷新重试" />
      <Space wrap><Button disabled={busy || catalogLoading} onClick={() => void refresh()}>刷新产品</Button><Button disabled={busy} onClick={() => { setAdding(!adding); setError(''); }}>新建产品</Button></Space>
      {adding && <div className="space-y-2">
        <Input aria-label="新产品名称" placeholder="产品名称（必填）" maxLength={120} value={newName} disabled={busy} onChange={event => setNewName(event.target.value)} />
        <Input.TextArea aria-label="新产品说明" placeholder="产品卖点或说明（可后续在知识库补齐）" maxLength={2000} value={newInfo} disabled={busy} onChange={event => setNewInfo(event.target.value)} />
        <Button loading={busy} disabled={!newName.trim()} onClick={() => void saveProduct()}>保存到知识库并选中</Button>
      </div>}
      <Button type="primary" disabled={busy || catalogLoading || !selected.length || adding} onClick={() => advance(picked.map(item => item.name).join('、'), 1)}>选好了，下一项</Button>
    </>}
    {step === 1 && <>
      <Input.TextArea aria-label="内容目标" placeholder="也可以直接在下方对话输入框回答" value={objective} maxLength={1000} onChange={event => setObjective(event.target.value)} />
      <Button type="primary" disabled={!objective.trim()} onClick={() => answer(objective)}>回答并继续</Button>
    </>}
    {step === 2 && <Space wrap>{['tiktok', 'instagram', 'facebook', 'youtube', 'linkedin'].map(item => <Button key={item} onClick={() => answer(item)}>{item}</Button>)}</Space>}
    {step === 3 && <>
      <Input aria-label="交付截止时间（北京时间）" type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} />
      <Button type="primary" onClick={() => { if (!dueAt || !Number.isFinite(Date.parse(`${dueAt}+08:00`)) || Date.parse(`${dueAt}+08:00`) <= Date.now()) { setError('请选择未来的北京时间。'); return; } advance(`${dueAt.replace('T', ' ')} 北京时间`, 4); }}>确认时间</Button>
    </>}
    {step === 4 && <>
      <div className="whitespace-pre-line break-words text-sm">{`产品：${picked.map(item => item.name).join('、')}\n目标：${objective}\n平台：${platform}\n截止：${dueAt.replace('T', ' ')} 北京时间\n将创建 ${selected.length} 个周任务`}</div>
      <Button type="primary" loading={busy} onClick={() => void submit()}>确认创建并进入生产</Button>
    </>}
    <Space wrap>{step > 0 && <Button disabled={busy || keys.current.size > 0} onClick={() => { setError(''); setStep(step - 1); options.append('assistant', CONTENT_INTAKE_QUESTIONS[step - 1]); }}>返回上一项</Button>}<Button disabled={busy} onClick={cancel}>取消创建</Button></Space>
  </div>;
  return { active: step !== null, start, answer, node, busy };
}
