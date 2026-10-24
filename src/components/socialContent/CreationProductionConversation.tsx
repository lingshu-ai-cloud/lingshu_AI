import CreationFinishingQuestions from './CreationFinishingQuestions';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input } from 'antd';
import { CREATION_QUESTIONS, type CreationReply, type CreationSelection, type CreationTurn } from '../../../shared/contracts/contentCreationDialogue';
import { useAssistantStore } from '../../stores/assistantStore';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import { requestCreationReply } from '../assistant/contentCreationRequest';

/** Same authenticated planning endpoint and same persisted assistant thread. Never executes production. */
export default function CreationProductionConversation({ plan }: { plan: CreationReply }) {
  const thread = useAssistantStore(state => state.threads.business);
  const selection = thread.creationDraft;
  const matches = (reply: CreationReply | undefined) => Boolean(reply?.stage.startsWith('production_') && reply.selection.referenceId === selection?.referenceId && reply.selection.evidenceVersion === selection?.evidenceVersion && JSON.stringify(reply.selection.productIds) === JSON.stringify(selection?.productIds) && JSON.stringify(reply.selection.shotIds) === JSON.stringify(selection?.shotIds));
  const reply = [...thread.messages].reverse().find(message => matches(message.creation))?.creation;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [edited, setEdited] = useState<string | null>(null);
  const lock = useRef(false);
  const active = useRef(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);
  const run = async (action: CreationTurn['action'], answer: string, patch?: CreationSelection['productionDraft']) => {
    if (lock.current || !selection) return;
    const identity = productionNavigationIdentity();
    const expected = selection;
    const nextSelection = patch ? { ...selection, productionDraft: { ...selection.productionDraft, ...patch } } : selection;
    const isCurrent = () => active.current && identity === productionNavigationIdentity() && useAssistantStore.getState().threads.business.creationDraft === expected;
    lock.current = true; setBusy(true); setError('');
    const abort = new AbortController(); controller.current = abort;
    const store = useAssistantStore.getState();
    store.setMessages('business', [...store.threads.business.messages, { role: 'user', content: answer }]);
    try {
      await requestCreationReply({ turn: { action, selection: nextSelection, instruction: answer }, controller: abort, isCurrent, persist: () => { /* GlobalAssistant persists this same thread through its existing CAS save queue. */ } });
      if (active.current) setEdited(null);
    } catch (cause) { if (isCurrent() && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : '证据读取失败，请保留选择后重试。'); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  };
  const stage = reply?.stage;
  const firstProduction = thread.messages.findIndex(message => matches(message.creation));
  const latestStart = thread.messages.map(message => message.role === 'user' && message.content === '先不加数字人，开始逐步确认分镜。').lastIndexOf(true);
  const historyStart = latestStart >= 0 ? latestStart : firstProduction;
  const history = historyStart < 0 ? [] : thread.messages.slice(historyStart, thread.messages.at(-1)?.creation ? -1 : undefined).slice(-12);
  const current = reply?.production;
  const navigateBack = () => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'strategy' } }));
  return <main className="h-full min-h-0 overflow-y-auto bg-white px-4 py-6 text-text-primary sm:px-8">
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-semibold">内容制作对话</h1>
      <p className="mt-2 text-sm text-text-secondary">{plan.products.filter(row => plan.selection.productIds.includes(row.id)).map(row => row.name).join('、')} · 本轮不加数字人 · 仅编辑草稿，不调用付费生成</p>
      <Button className="my-3" onClick={navigateBack}>返回内容创作问答</Button>
      {!selection || selection.referenceId !== plan.selection.referenceId ? <Alert type="warning" title="当前方案已变化，请返回内容创作重新核验。"/> : selection.avatar !== false ? <Alert type="warning" title="请先在问答中选择“不加入数字人”。"/> : <>
        <section aria-label="生产问答记录" role="log" className="space-y-3">
          {history.map((message, index) => <div key={index} className={message.role === 'user' ? 'ml-8 rounded-xl ls-messenger-bubble--outbound p-3' : 'mr-8 rounded-xl border border-border p-3'}><span className="text-xs">{message.role === 'user' ? '我' : '灵小枢'}</span><p className="mt-1 whitespace-pre-wrap">{message.content}</p></div>)}
        </section>
        <section aria-label="当前生产问题" aria-busy={busy} className="mt-4 space-y-3 rounded-xl border border-border p-4">
          {!reply ? <><p>接下来逐步确认分镜、素材匹配和口播，可以开始吗？</p><Button type="primary" loading={busy} onClick={() => void run('production_storyboard', '先不加数字人，开始逐步确认分镜。')}>开始分镜问答</Button></> : <>
            <p className="font-semibold">{CREATION_QUESTIONS[reply.stage]}</p>
            {(stage === 'production_shots' || stage === 'production_materials' || stage === 'production_review') && <ol className="space-y-3">{current?.shots.map((shot, index) => <li key={shot.id} className="rounded-lg border border-border p-3">
              <p>{index + 1}. {shot.title}</p><p className="text-sm">{shot.description}</p>
              <p className="mt-1 text-sm text-text-secondary">{({ reference_only: '仅作结构参考，不作为产品实拍', candidate: '待核验候选，尚未完成授权和企业归属校验', missing: '缺素材，保持待补', skipped: '暂不使用，不参与生产匹配' })[shot.status]}{shot.start !== undefined ? ` · 原片 ${shot.start}–${shot.end}秒` : ''}</p>
              {shot.sourceId && <p className="break-all text-xs text-text-secondary">来源：{shot.sourceId}</p>}
            </li>)}</ol>}
            {stage === 'production_shots' && <Button type="primary" loading={busy} onClick={() => void run('production_match', '确认这个分镜顺序；缺失的产品实拍保留待补。')}>确认顺序，继续素材问答</Button>}
            {stage === 'production_materials' && <div className="flex flex-wrap gap-2">
              <Button type="primary" loading={busy} onClick={() => void run('production_edit', '保留工厂素材候选，授权和企业归属待核验；不使用参考片作为产品实拍。', { materialChoice: 'candidate' })}>保留候选，授权待核验</Button>
              <Button disabled={busy} onClick={() => void run('production_edit', '暂不使用工厂片段，保持缺素材提示。', { materialChoice: 'skip' })}>暂不使用工厂片段</Button>
            </div>}
            {stage === 'production_narration' && <>
              <label htmlFor="production-answer-narration">请回答你要保留的口播文字</label>
              <Input.TextArea id="production-answer-narration" aria-label="口播问答回复" value={edited ?? current?.narration ?? ''} maxLength={1500} autoSize={{ minRows: 4, maxRows: 10 }} disabled={busy} onChange={event => setEdited(event.target.value)}/>
              <Button type="primary" loading={busy} disabled={!(edited ?? current?.narration)?.trim()} onClick={() => { const text = (edited ?? current?.narration ?? '').trim(); void run('production_review', `我确认的口播草稿：${text}`, { narrationDraft: text }); }}>确认口播文字，不合成语音</Button>
            </>}
            {stage === 'production_review' && <>
              <Button type="primary" loading={busy} onClick={() => void run('production_voice', '继续配音问答，只检查证据，先不调用付费生成。')}>继续配音问答（不生成）</Button>
              <p>已保留口播（预计{current?.seconds}秒，未合成语音）：{current?.narration}</p>
              <Alert type="warning" showIcon title="当前仅完成问答草稿；素材授权、产品实拍和完整画面仍待补齐。没有创建生成任务或成片回执。"/>
              <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void run('production_storyboard', '重新确认分镜顺序。')}>重新回答分镜问题</Button><Button disabled={busy} onClick={() => void run('production_match', '重新选择素材候选处理方式。')}>重新回答素材问题</Button><Button disabled={busy} onClick={() => void run('production_edit', '继续修改口播文字。')}>继续口播问答</Button></div>
            </>}
            <CreationFinishingQuestions reply={reply} busy={busy} run={run}/>
            {reply.gaps.map(gap => <Alert key={gap} type="warning" showIcon title={gap}/>)}
          </>}
          {error && <Alert type="error" showIcon title={error}/>}
        </section>
      </>}
    </div>
  </main>;
}
