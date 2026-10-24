import { Alert, Button, Input } from 'antd';
import { creationReplySchema, type CreationReply } from '../../../shared/contracts/contentCreationDialogue';

/** Original planning evidence stays attributed; it is never promoted to usable production footage. */
export default function CreationDialoguePlanPanel({ value, narrationText, onNarrationChange }: { value: CreationReply; narrationText: string; onNarrationChange: (text: string) => void }) {
  const parsed = creationReplySchema.safeParse(value);
  if (!parsed.success) return <Alert type="error" title="交接方案格式无效，请返回内容创作重新核验。"/>;
  const plan = parsed.data;
  const selected = plan.shots.filter(shot => plan.selection.shotIds.includes(shot.id));
  const narration = plan.narrations.find(row => row.id === plan.selection.narrationId);
  return <section className="m-4 max-h-[45vh] shrink-0 overflow-y-auto rounded-xl border border-border bg-white p-4 text-text-primary" aria-label="内容创作交接方案">
    <h2 className="text-base font-semibold">已带入内容创作方案</h2>
    <p>产品：{plan.products.filter(row => plan.selection.productIds.includes(row.id)).map(row => row.name).join('、')}</p>
    <p>参考：{plan.referenceTitle}</p>
    <label htmlFor="creation-handoff-narration">口播草稿（原稿预计{narration?.seconds}秒，未合成语音）</label>
    <Input.TextArea id="creation-handoff-narration" aria-label="交接口播草稿" value={narrationText} onChange={event => onNarrationChange(event.target.value)} autoSize={{ minRows: 3, maxRows: 6 }}/>
    <p>数字人：{plan.selection.avatar ? '已提出加入；人物、声音、授权与镜头位置仍须核验' : '不加入'}</p>
    <ul>{selected.map(shot => <li key={shot.id}>{shot.title} · {shot.start}–{shot.end}秒 · {shot.description}<br/>{shot.evidence}</li>)}</ul>
    <Alert type="warning" showIcon title="此方案为待核验草稿，参考片段不作为已授权生产素材。" description={plan.gaps.join('；')}/>
    <Button className="mt-2" onClick={() => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'strategy' } }))}>返回内容创作方案</Button>
  </section>;
}
