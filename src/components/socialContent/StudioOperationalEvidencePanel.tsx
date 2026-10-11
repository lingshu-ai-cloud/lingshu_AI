import { useEffect, useState } from 'react';
import { authenticatedAudioBlobUrl } from '../studio/studioAuthenticatedMedia';
type Contract = { tenantId?: string; taskId?: string; taskVersion?: number; runId?: string; jobId?: string; planHash?: string; inputHash?: string; scriptVersion?: string; operationalEvidence?: unknown };
const providerLabel = (value: unknown) => value === 'completed' || value === 'completed_rejected' ? '已生成' : value === 'accepted' ? '供应商已受理' : '状态待核验';
const qualityLabel = (value: unknown) => value === 'rejected' || value === 'failed' ? '质检拒绝' : value === 'passed' ? '技术质检通过' : '质检待核验';
const adoptionLabel = (value: unknown) => value === 'adopted' ? '原始镜头已采纳' : value === 'blocked' || value === 'rejected' ? '拒绝采用' : '未采用';
const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? `¥${value.toFixed(2)}` : '待核账';
type VoiceTrack = { role?: string; url?: string; sha256?: string; durationSeconds?: number; receiptRef?: string };
function OriginalVoicePreview({ track }: { track: VoiceTrack }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const source = track.role === 'assembled' && typeof track.url === 'string' && /^\/api\/overseas\/starter-198\/social-content\/files\/socialfile_[a-zA-Z0-9]+$/.test(track.url) && /^[a-f0-9]{64}$/.test(track.sha256 || '') && track.durationSeconds === 24 ? track.url : null;
  useEffect(() => {
    let active = true;
    setUrl(null); setError('');
    if (source) void authenticatedAudioBlobUrl(source).then(value => { if (active) setUrl(value); }).catch(() => { if (active) setError('原声合成轨读取失败，请保留原记录并重试查看。'); });
    return () => { active = false; };
  }, [source]);
  if (!source) return null;
  return <div aria-label="原声合成轨试听" className="mt-2 rounded border p-2">
    <p>24秒原声合成轨 · 音轨试听，非最终成片，未完成人工审核。</p>
    {url ? <audio aria-label="24秒原声合成轨" src={url} controls preload="metadata" /> : <p role="status">{error || '正在鉴权读取原始音轨…'}</p>}
  </div>;
}
/** Operational receipts remain separate from final handoff and human approval. */
export default function StudioOperationalEvidencePanel({ contract }: { contract: Contract }) {
  const value = contract.operationalEvidence;
  const evidence = value && typeof value === 'object' ? value as Record<string, any> : null;
  const bound = evidence?.schemaVersion === 'social-studio-operational.v1' && ['tenantId', 'taskId', 'taskVersion', 'runId', 'jobId', 'planHash', 'inputHash'].every(key => evidence[key] === contract[key as keyof Contract]);
  return <section aria-label="冻结生产实际记录" className="rounded-xl border border-border bg-white p-3 text-xs leading-5">
    <p className="font-bold">冻结生产实际记录 · v{contract.taskVersion} / {contract.scriptVersion}</p>
    <p>运行 {contract.runId} · 整片尚未完成，尚未记录最终人工批准。</p>
    {!bound ? <p>供应商、口播与费用来源待接入；正式交接包未核验。</p> : <>
      <p>已分配预算池额度 {money(evidence.budget?.poolAuthorizedCny)} · 保留预占 {money(evidence.budget?.retainedReservedCny)} · 实际费用 {money(evidence.budget?.actualCostCny)}</p>
      <p>预算池额度不是用户总授权；未分池额度不计为预占。预估与预占不是实际账单，未对账不会计为零费用。</p>
      {(Array.isArray(evidence.providerOperations) ? evidence.providerOperations : []).map((row: any, index: number) => <div key={row.operationId || index} className="mt-2 rounded border p-2">
        <p>{row.shotId} · {typeof row.operationId === 'string' && row.operationId.includes(':repair-') ? '返工尝试' : row.shotId === 'S04' ? '首次尝试' : '原始镜头'} · {providerLabel(row.providerStatus)} · {qualityLabel(row.qualityStatus)} · {adoptionLabel(row.adoptionStatus)}</p>
        <details><summary>来源凭据详情</summary><p>原状态 {row.providerStatus} / {row.qualityStatus} / {row.adoptionStatus}</p><p>任务 {row.providerTaskId || '未回执'} · 回执 {row.receiptRef || '未接入'}</p></details>
        <p>预估 {money(row.estimatedCostCny)} · 预占 {money(row.reservedCostCny)} · 实际 {money(row.actualCostCny)}</p>
      </div>)}
      {(Array.isArray(evidence.audio) ? evidence.audio : []).map((row: any, index: number) => <p key={row.receiptRef || index}>原声 {row.role === 'hook' ? '开场' : row.role === 'body' ? '正文' : row.role === 'assembled' ? '24秒合成轨' : '待确认'} · {typeof row.durationSeconds === 'number' ? `${row.durationSeconds.toFixed(3)}s` : '时长待核验'} · 回执 {row.receiptRef || '未接入'}</p>)}
      {(Array.isArray(evidence.audio) ? evidence.audio : []).filter((row: VoiceTrack) => row.role === 'assembled').map((row: VoiceTrack, index: number) => <OriginalVoicePreview key={row.receiptRef || index} track={row} />)}
      <p>这些是原供应商与本地质量记录，不构成最终交接或真人批准。</p>
    </>}
  </section>;
}
