import ContentCreationShotPreview from './ContentCreationShotPreview';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Drawer, Empty, Select, Tag } from 'antd';
import { useAssistantStore } from '../../stores/assistantStore';
import { useCreationMode } from '../../lib/creationMode';
import type { CreationReply, CreationSelection, CreationTurn } from '../../../shared/contracts/contentCreationDialogue';
import type { useAssistantSend } from './useAssistantSend';
import { PRIMARY_ASSISTANT_THREAD } from './globalAssistantRuntime';

const kindLabel = { hook: '参考钩子', factory: '工厂素材', product: '产品素材' };
/** Controls edit the same thread draft. Replies are server snapshots, never executable production authorizations. */
export default function ContentCreationChoices({ reply, busy, send, onNavigateEvidence }: {
  reply: CreationReply; busy: boolean; send: ReturnType<typeof useAssistantSend>['send']; onNavigateEvidence: () => void;
}) {
  const selection = useAssistantStore(state => state.threads.business.creationDraft);
  const creationMode = useCreationMode();
  const [drawerIndex, setDrawerIndex] = useState<number | null>(null);
  const [returnStage, setReturnStage] = useState<CreationReply['stage'] | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setDrawerIndex(null); setReturnStage(null); }, [reply]);
  if (!selection || !selection.evidenceVersion || selection.referenceId !== reply.selection.referenceId || creationMode !== 'free') return null;
  const stage = returnStage || reply.stage;
  const change = (patch: Partial<CreationSelection>) => useAssistantStore.getState().hydrateThread(PRIMARY_ASSISTANT_THREAD, { creationDraft: { ...selection, ...patch } });
  const submit = (action: CreationTurn['action'], answer: string) => void send(answer, 'business', undefined, [], action);
  const toggle = (id: string, checked: boolean) => change({ shotIds: checked ? [...selection.shotIds.filter(value => value !== id), id].slice(0, 12) : selection.shotIds.filter(value => value !== id), narrationId: undefined, avatar: undefined });
  const selectedNames = reply.products.filter(row => selection.productIds.includes(row.id)).map(row => row.name).join('、');
  const startIndex = drawerIndex ?? 0;
  return <section className="creation-dialogue-choices" aria-label="当前创作选择" aria-busy={busy}>
    {reply.gaps.map(gap => <Alert key={gap} type="warning" showIcon title={gap}/>)}
    <div className="flex flex-wrap items-center gap-2"><Tag>参考：{reply.referenceTitle}</Tag>
      {stage !== 'products' && <Button disabled={busy} onClick={() => { change({ shotIds: [], narrationId: undefined, avatar: undefined }); setReturnStage('products'); }}>返回产品选择</Button>}
      <Button disabled={busy} onClick={onNavigateEvidence}>查看来源与补齐证据</Button>
    </div>
    {stage === 'products' && <>
      <label htmlFor="creation-products">选择知识库产品（可多选）</label>
      <Select id="creation-products" aria-label="选择知识库产品" mode="multiple" allowClear showSearch={{ optionFilterProp: 'label' }}
        value={selection.productIds} disabled={busy} className="w-full" maxCount={12}
        options={reply.products.map(row => ({ value: row.id, label: row.name }))}
        notFoundContent="企业知识库暂无产品，请先补充产品资料" placeholder="选择一个或多个产品"
        onChange={productIds => change({ productIds, shotIds: [], narrationId: undefined, avatar: undefined })}/>
      {!reply.products.length && <Empty description="企业知识库暂无产品" image={Empty.PRESENTED_IMAGE_SIMPLE}/>}
      <Button type="primary" disabled={busy || !selection.productIds.length} onClick={() => submit('products', `我选择产品：${selectedNames}`)}>确认产品</Button>
      <Button disabled={busy} onClick={() => submit('start', '重新读取当前知识库产品')}>刷新产品</Button>
    </>}
    {stage === 'shots' && <>
      <div className="creation-dialogue-strip" aria-label="推荐分镜">
        {reply.shots.map((shot, index) => <article key={shot.id} className="creation-dialogue-shot" data-selected={selection.shotIds.includes(shot.id)}>
          <Checkbox aria-label={`选择分镜 ${shot.title}`} checked={selection.shotIds.includes(shot.id)} disabled={busy} onChange={event => toggle(shot.id, event.target.checked)}>选中</Checkbox>
          <button type="button" disabled={busy} onClick={() => setDrawerIndex(index)} aria-label={`查看分镜 ${shot.title}`}>
            <Tag>{kindLabel[shot.kind]}</Tag><strong>{shot.title}</strong><p>{shot.description}</p><span>{shot.start}–{shot.end} 秒</span>
          </button>
        </article>)}
      </div>
      {!reply.shots.length && <Empty description="暂无通过证据校验的分镜，请补齐素材后刷新" image={Empty.PRESENTED_IMAGE_SIMPLE}/>}
      <p role="status">已选 {selection.shotIds.length} 个分镜；参考视频作为钩子依据保留，不代表整条视频可直接复用。</p>
      <Button type="primary" disabled={busy || !selection.shotIds.length} onClick={() => submit('shots', `采用分镜：${reply.shots.filter(shot => selection.shotIds.includes(shot.id)).map(shot => `${shot.title}（${shot.start}–${shot.end}秒）`).join('；')}`)}>确认分镜</Button>
      <Button disabled={busy} onClick={() => submit('products', `刷新 ${selectedNames} 的分镜推荐`)}>刷新分镜</Button>
    </>}
    {stage === 'narration' && <>
      <div className="creation-dialogue-strip" aria-label="推荐口播">
        {reply.narrations.map(row => <article className="creation-dialogue-narration" key={row.id} data-selected={selection.narrationId === row.id}>
          <strong>{row.title} · 预计 {row.seconds} 秒</strong><p>{row.text}</p>
          <Button disabled={busy} type={selection.narrationId === row.id ? 'primary' : 'default'} onClick={() => change({ narrationId: row.id, avatar: undefined })}>{selection.narrationId === row.id ? '已选择' : '选择口播'}</Button>
        </article>)}
      </div>
      <p className="text-text-secondary">依据知识库与所选分镜整理的口播草稿；时长为朗读估计，尚未合成语音。</p>
      <Button disabled={busy} onClick={() => { change({ narrationId: undefined, avatar: undefined }); setReturnStage('shots'); }}>返回分镜选择</Button>
      <Button type="primary" disabled={busy || !selection.narrationId || !reply.narrations.length} onClick={() => submit('narration', `我选择${reply.narrations.find(row => row.id === selection.narrationId)?.title}口播`)}>确认口播</Button>
    </>}
    {stage === 'avatar' && <>
      <Button disabled={busy} onClick={() => { change({ narrationId: undefined, avatar: undefined }); setReturnStage('narration'); }}>返回口播选择</Button>
      <Button disabled={busy} onClick={() => { change({ avatar: true }); submit('avatar', '是，加入数字人视频'); }}>是，加入数字人</Button>
      <Button disabled={busy} onClick={() => { change({ avatar: false }); submit('avatar', '否，使用所选素材'); }}>否，使用素材</Button>
    </>}
    {stage === 'review' && <>
      <p>产品：{selectedNames}；分镜：{reply.plannedShots?.length || selection.shotIds.length} 个；口播：{reply.narrations.find(row => row.id === selection.narrationId)?.title || '待选择'}。</p>
      <p>{reply.avatarPlacement === 'first' ? '沿用首镜数字人口播形式，不重复新增第二镜。' : reply.avatarPlacement === 'second' ? '第二镜拟采用数字人口播形式，等待人物与素材核验。' : reply.avatarPlacement === 'pending' ? '首镜人物形式待核验，数字人镜头位置尚未确定。' : '保留所选素材，不加入数字人。'}</p>
      <p>方案已保留在本会话；尚未生成视频或提交生产任务。</p>
      <Button disabled={busy} onClick={() => setReturnStage('shots')}>重新选择分镜</Button>
      <Button disabled={busy} onClick={() => setReturnStage('avatar')}>修改数字人选择</Button>
    </>}
    <Drawer classNames={{ wrapper: 'creation-dialogue-drawer' }} destroyOnHidden open={drawerIndex !== null} title="分镜信息流" placement="right" onClose={() => setDrawerIndex(null)} size={520}
      afterOpenChange={open => { if (open) drawerRef.current?.querySelector(`[data-shot-index="${startIndex}"]`)?.scrollIntoView({ block: 'start' }); }}>
      <div ref={drawerRef} className="creation-dialogue-flow">
        {reply.shots.map((shot, index) => <article key={shot.id} data-shot-index={index} data-selected={selection.shotIds.includes(shot.id)}>
          <Checkbox aria-label={`信息流选择 ${shot.title}`} checked={selection.shotIds.includes(shot.id)} disabled={busy} onChange={event => toggle(shot.id, event.target.checked)}>选择此分镜</Checkbox>
          <h3>{shot.title}</h3><Tag>{kindLabel[shot.kind]}</Tag>
          <ContentCreationShotPreview shot={shot}/>
          <p>{shot.description}</p><p>{shot.start}–{shot.end} 秒</p><p className="text-text-secondary">{shot.evidence}</p>
        </article>)}
      </div>
    </Drawer>
  </section>;
}
