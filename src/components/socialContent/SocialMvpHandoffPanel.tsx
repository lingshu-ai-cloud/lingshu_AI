import type { SocialMvpScope } from '../../../shared/contracts/socialMvpHandoff';
import { mvpMoney, mvpReviewLabel, socialMvpWorkbenchRead } from '../../lib/socialMvpWorkbench';

const scopeLabels: Record<keyof SocialMvpScope, string> = {
  tenantId: '租户', accountId: '账号', productId: '产品', projectId: '制作项目', taskId: '内容任务', runId: '生产运行', version: '冻结版本',
};
export default function SocialMvpHandoffPanel({ value, expected }: { value: unknown; expected: Partial<SocialMvpScope> }) {
  let read: ReturnType<typeof socialMvpWorkbenchRead> = null, error = '';
  try { read = socialMvpWorkbenchRead(value, expected); } catch {
    error = expected.projectId === '' ? '当前制作工程尚未绑定，交接未核验；请由制作负责人核对原工程。'
      : '交接记录缺项或身份不一致，未核验；请由经营与制作负责人核对原执行包。';
  }
  const p = read?.package;
  return <details className="rounded-xl border border-border bg-white p-3" aria-label="真实 MVP 交接与验收">
    <summary className="cursor-pointer text-xs font-black">真实交接 · 费用与审核</summary>
    <div className="mt-3 space-y-3 break-words text-[10px] leading-5">
      <p>这里只读展示原任务凭据；记录存在不等于媒体、费用或最终人工质量已核验。</p>
      {error && <p role="alert">{error}</p>}
      {!p ? <p role="status">冻结执行包未核验。参考 hash、人物/音色版本、逐镜输入、供应商回执、预估/预占/实际费用、事实权利与审核均待原记录接入。</p> : <>
        <dl>{Object.entries(scopeLabels).map(([key, label]) => <div key={key}><dt className="inline font-bold">{label}：</dt><dd className="inline">{p.scope[key as keyof SocialMvpScope]}</dd></div>)}</dl>
        <p>执行包 hash：{p.recordHash}</p>
        <p>参考：{p.reference.id} · {p.reference.version}<br/>hash：{p.reference.sha256}<br/>使用边界：{p.reference.usageBoundaryRef.id}</p>
        <p>人物：{p.avatar.id} · {p.avatar.version} · 权利 {p.avatar.rightsRef.id}<br/>音色：{p.voice.id} · {p.voice.version} · 权利 {p.voice.rightsRef.id}</p>
        <p>脚本：{p.script.id} · {p.script.version}<br/>分镜：{p.storyboard.id} · {p.storyboard.version}<br/>口播：{p.voiceover.id} · {p.voiceover.version}</p>
        <div className="overflow-x-auto"><table className="w-full text-left"><caption>费用分别展示；预算上限不作为预估或实际费用</caption><thead><tr><th>范围</th><th>预估</th><th>预占</th><th>实际</th></tr></thead><tbody>{(['A', 'B', 'total'] as const).map(lane => <tr key={lane}><th>{lane === 'total' ? '全片' : lane === 'A' ? '数字人 A' : '关键镜头 B'}</th><td>{mvpMoney(read?.estimatedCosts?.[lane], p.budgets[lane].currency)}</td><td>见逐镜账本</td><td>全范围账本未核验</td></tr>)}</tbody></table></div>
        <ol className="space-y-3">{p.scenes.map(scene => {
          const clip = read?.clips.find(item => item.sceneId === scene.sceneId);
          return <li key={scene.sceneId} className="rounded border p-2">
            <p className="font-bold">镜头 {scene.sceneId} · {scene.role}</p><p>输入 fingerprint：{scene.inputFingerprint}</p>
            <p>事实依据：{scene.factRefs.length ? scene.factRefs.map(r => `${r.id} / ${r.version}`).join('；') : '未核验'}<br/>权利依据：{scene.rightsRefs.map(r => `${r.id} / ${r.version}`).join('；') || '未核验'}</p>
            {clip ? <><p>供应商 {clip.provider.providerId}<br/>任务 {clip.provider.taskId}<br/>请求 {clip.provider.requestId} · attempt {clip.provider.attemptId}<br/>回执 {clip.provider.receiptRef.id} · {clip.provider.receiptRef.version}</p>
              <p>媒体 hash：{clip.file.sha256}</p><p>预占 {mvpMoney(clip.cost.reserved, clip.cost.currency)} · 实际 {clip.cost.state === 'settled' ? mvpMoney(clip.cost.actual, clip.cost.currency) : '未核验'}<br/>账本 {clip.cost.ledgerRef.id} · {clip.cost.ledgerRef.version}（权威对账待核验）</p></> : <p>片段、供应商回执与费用：未核验</p>}
          </li>;
        })}</ol>
      </>}
      <dl><div>技术检查：{mvpReviewLabel(read?.reviews?.technical)}</div><div>独立创意初审：{mvpReviewLabel(read?.reviews?.creativePreliminary)}</div><div>最终内部人工审核：{mvpReviewLabel(read?.reviews?.finalInternalHuman, true)}</div></dl>
      {mvpReviewLabel(read?.reviews?.finalInternalHuman, true) !== '未核验' && read?.reviews?.finalInternalHuman && <p>审核人 {read.reviews.finalInternalHuman.reviewerId} · {read.reviews.finalInternalHuman.reviewedAt} · 凭据 {read.reviews.finalInternalHuman.recordRef}</p>}
      {read?.gaps.map((gap, index) => <p key={index}>待核验：{gap}</p>)}
      <p>最终人工审核由有权限的内部业务审核员记录；此面板不会自动确认或批准发布。</p>
    </div>
  </details>;
}
