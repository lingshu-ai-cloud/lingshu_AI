import { useEffect, useState, type FormEvent } from 'react';
import AdCreativePanel from './AdCreativePanel';
import type { PlatformAdCreative } from '../../shared/platformAdCreatives';
import type { AdPreflightResult as PreflightReport } from '../../shared/platformAdPreflight';
import { getAdPlanCapability } from '../../shared/platformAdCapabilities';
import { platformAdsApi, platformAdsRequest, type AdAuthorization, type PlatformAdTask } from '../lib/platformAds';
import { creationSourceLabels, managementModeLabels, type AdManagementMode } from '../lib/platformAdsDomain';

type Connection = { id: string; provider: string; accountId: string; name: string; currency: string; status: string };
type Capability = { provider: string; configured: boolean; reason?: string; oauthConfigured?: boolean };
type ReleasePolicy = { mode: string; allowedActions: string[]; executionProviders: string[]; reason: string };
type Connections = { items: Connection[]; capabilities: Capability[]; releasePolicy?: ReleasePolicy };
const message = (error: unknown) => error instanceof Error ? error.message : '请求失败，请重试';
const statusLabel = (status: unknown) => (({ ACTIVE: '配置已启用（不代表审核通过或产生曝光）', active: '配置已启用（不代表审核通过或产生曝光）', PAUSED: '已暂停', DISABLE: '已停用', VERIFIED: '平台操作已核验', FAILED: '操作失败', UNKNOWN: '结果待核验', PENDING: '等待处理', APPROVING: '审批执行中', EXECUTED: '已执行', REJECTED: '已拒绝', EXPIRED: '已过期', INVALIDATED: '已失效', CREATING: '创建中', CREATED: '已创建', ACTIVATING: '启动中', BLOCKED: '等待处理问题' } as Record<string, string>)[String(status)] || String(status || '暂无状态'));
const localDateInput = (value: string) => { if (!value || !value.endsWith('Z')) return value.slice(0, 16); const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

export { default as AdAccountConnections } from './AdAccountConnections';

export function AdTaskControls({ task, onUpdate, onExecution }: { task: PlatformAdTask; onUpdate: (task: PlatformAdTask) => void; onExecution?: () => void }) {
  const currency = task.currency || 'USD';
  const capability = getAdPlanCapability(task);
  const managementUnavailable = (target: AdManagementMode) => (target === 'approval' && !capability.supportsApproval) || (target === 'managed' && !capability.supportsManaged);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [releasePolicy, setReleasePolicy] = useState<ReleasePolicy | undefined>();
  const [mode, setMode] = useState<AdManagementMode>(task.managementMode);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [boundary, setBoundary] = useState<AdAuthorization>(task.authorization || { accountIds: [], allowedActions: ['pause'], maxDailyBudget: task.configuration.dailyBudget || Math.min(task.budget, 50), maxTotalBudget: task.budget, maxAdjustmentPercent: 10, expiresAt: '' });
  useEffect(() => { platformAdsRequest<Connections>('/connections').then(result => { setConnections(result.items); setReleasePolicy(result.releasePolicy); }).catch(e => setFeedback(message(e))); }, []);
  useEffect(() => { setMode(task.managementMode); }, [task.managementMode]);
  const save = async (target: AdManagementMode) => {
    setBusy(true); setFeedback('');
    if (managementUnavailable(target)) { setFeedback(capability.reason || '当前计划暂不支持审批或托管，请使用人工管理或 AI 建议。'); setBusy(false); return; }
    if (['approval', 'managed'].includes(target) && boundary.accountIds.some(id => connections.find(account => account.id === id)?.currency !== currency)) { setFeedback('授权账户币种与计划不一致，请选择同币种账户。'); setBusy(false); return; }
    if (['approval', 'managed'].includes(target) && boundary.accountIds.some(id => connections.find(account => account.id === id)?.status !== 'connected')) { setFeedback('授权账户已失效，请移除不可用账户或重新连接后保存。'); setBusy(false); return; }
    try { const updated = await platformAdsApi.setManagement(task.id, { expectedVersion: task.version || 1, managementMode: target, ...(['approval', 'managed'].includes(target) ? { authorization: { ...boundary, expiresAt: new Date(boundary.expiresAt).toISOString() } } : {}) }); onUpdate(updated); setFeedback(target === 'manual' ? '已交回人工管理。既有平台广告是否暂停，请查看实际平台状态。' : '管理方式与授权边界已保存。实际自动执行能力以服务状态为准。'); }
    catch (e) { setFeedback(message(e)); } finally { setBusy(false); }
  };
  if (task.creationSource === 'platform_import') return <section className="ads-card ads-operations"><h3>{task.name} · 平台导入（只读）</h3><p>已保存真实平台快照。本轮导入计划支持查看，不会取得自动操作权限。预算为 0 表示尚未同步总预算，不代表零消耗。</p><AdTaskMetrics taskId={task.id} /></section>;
  return <section className="ads-card ads-operations">
    <div className="ads-section-title"><h3>{task.name}</h3><span>{creationSourceLabels[task.creationSource]} · {managementModeLabels[task.managementMode]}</span><button className="ads-text-button" disabled={busy} onClick={() => platformAdsApi.getTask(task.id).then(onUpdate).catch(e => setFeedback(message(e)))}>刷新任务版本</button></div>
    <AdTaskMetrics taskId={task.id} />
    {task.sourceContext && <div className="ads-proposal"><h3>智能经营来源</h3><p>{task.sourceContext.objective}</p><p>经营依据：{task.sourceContext.evidence}</p><p>预期结果：{task.sourceContext.expectedOutcome}</p><p>经营约束：{task.sourceContext.constraints}</p></div>}
    {task.proposal && <div className="ads-proposal"><h3>投放方案与依据</h3><p><strong>为什么投：</strong>{task.proposal.rationale}</p><p><strong>投给谁：</strong>{task.proposal.audienceStrategy}</p><p><strong>投什么：</strong>{task.proposal.creativeStrategy}</p><p><strong>预期结果：</strong>{task.proposal.expectedOutcome}</p><p><strong>假设：</strong>{task.proposal.assumptions.join('；')}</p><p><strong>风险：</strong>{task.proposal.risks.join('；')}</p></div>}
    <form className="ads-form-fields" onSubmit={e => { e.preventDefault(); void save(mode); }}>
      <label>后续管理方式<select value={mode} onChange={e => setMode(e.target.value as AdManagementMode)}>{Object.entries(managementModeLabels).map(([value, label]) => <option key={value} value={value} disabled={managementUnavailable(value as AdManagementMode)}>{label}{managementUnavailable(value as AdManagementMode) ? '（当前计划未开放）' : ''}</option>)}</select></label>
      {!capability.supportsManaged && <p className="ads-muted">当前计划仅开放人工管理或 AI 建议。{capability.reason}</p>}
      {['approval', 'managed'].includes(mode) && !managementUnavailable(mode) && <>
        <fieldset><legend>授权账户（当前托管与审批仅支持 Meta）</legend>{connections.some(c => c.provider === 'meta') ? connections.filter(c => c.provider === 'meta').map(c => <label key={c.id}><input type="checkbox" disabled={!boundary.accountIds.includes(c.id) && (c.currency !== currency || c.status !== 'connected')} checked={boundary.accountIds.includes(c.id)} onChange={e => setBoundary({ ...boundary, accountIds: e.target.checked ? [...boundary.accountIds, c.id] : boundary.accountIds.filter(id => id !== c.id) })} />{c.name} · {c.currency} · {c.status}{c.currency !== currency ? '（与计划币种不匹配）' : ''}</label>) : <p>请先连接 Meta 广告账户。</p>}</fieldset>
        <fieldset><legend>允许的动作</legend>{([['create', '创建'], ['activate', '启用'], ['pause', '暂停'], ['resume', '恢复'], ['adjust_budget', '调整预算']] as const).map(([action, label]) => <label key={action}><input type="checkbox" checked={boundary.allowedActions.includes(action)} onChange={e => setBoundary({ ...boundary, allowedActions: e.target.checked ? [...boundary.allowedActions, action] : boundary.allowedActions.filter(item => item !== action) })} />{label}</label>)}</fieldset>
        <label>每日预算上限（{currency}）<input type="number" required min="1" max={boundary.maxTotalBudget} step="0.01" value={boundary.maxDailyBudget} onChange={e => setBoundary({ ...boundary, maxDailyBudget: Number(e.target.value) })} /></label>
        <label>总预算上限（{currency}）<input type="number" required min="1" max={task.budget} step="0.01" value={boundary.maxTotalBudget} onChange={e => setBoundary({ ...boundary, maxTotalBudget: Number(e.target.value) })} /></label>
        <label>单次预算调整上限（%）<input type="number" required min="1" max="100" value={boundary.maxAdjustmentPercent} onChange={e => setBoundary({ ...boundary, maxAdjustmentPercent: Number(e.target.value) })} /></label>
        <label>授权到期时间<input type="datetime-local" required value={localDateInput(boundary.expiresAt)} onChange={e => setBoundary({ ...boundary, expiresAt: e.target.value })} /></label>
      </>}
      <div className="ads-actions"><button className="ads-button primary" disabled={busy || managementUnavailable(mode) || (['approval', 'managed'].includes(mode) && !boundary.accountIds.length)}>{busy ? '保存中…' : '保存管理方式'}</button>{task.managementMode !== 'manual' && <button type="button" className="ads-button" disabled={busy} onClick={() => void save('manual')}>人工接管并撤销托管授权</button>}</div>
    </form>
    {feedback && <p role="status" className="ads-operation-feedback">{feedback}</p>}
    {releasePolicy && releasePolicy.mode !== 'full' && <p role="status" className="ads-operation-feedback">{releasePolicy.reason}</p>}
    <AdExecutionControls task={task} onUpdate={onUpdate} connections={connections} onExecution={onExecution} releasePolicy={releasePolicy} />
    <AdAutomationControls task={task} connections={connections} />
  </section>;
}

function AdExecutionControls({ task, connections, onExecution, releasePolicy, onUpdate }: { task: PlatformAdTask; onUpdate: (task: PlatformAdTask) => void; connections: Connection[]; onExecution?: () => void; releasePolicy?: ReleasePolicy }) {
  const currency = task.currency || 'USD';
  const [connectionId, setConnectionId] = useState('');
  const [creative, setCreative] = useState<PlatformAdCreative | null>(null);
  const [action, setAction] = useState('create');
  const [launchMode, setLaunchMode] = useState<'create_paused' | 'create_and_activate'>('create_paused');
  const [resourceId, setResourceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [preflight, setPreflight] = useState<{ fingerprint: string; report: PreflightReport } | null>(null);
  const [records, setRecords] = useState<Array<Record<string, unknown>>>([]);
  const [approvals, setApprovals] = useState<Array<Record<string, unknown>>>([]);
  const [launches, setLaunches] = useState<Array<Record<string, unknown>>>([]);
  const [meta, setMeta] = useState({ pageId: '', videoId: '', imageUrl: '', linkUrl: '', message: '', countries: 'US', dailyBudget: task.configuration.dailyBudget || 10 });
  useEffect(() => { setCreative(null); setPreflight(null); setMeta(value => ({ ...value, videoId: '' })); }, [task.id, task.version]);
  const [tiktok, setTikTok] = useState({ identityId: '', tiktokItemId: '', locationIds: '', adText: '' });
  const isTikTok = connections.find(item => item.id === connectionId)?.provider === 'tiktok';
  const isGoogle = connections.find(item => item.id === connectionId)?.provider === 'google';
  const currencyMismatch = !!connectionId && connections.find(item => item.id === connectionId)?.currency !== currency;
  const releaseBlocked = !!releasePolicy && (!releasePolicy.allowedActions.includes(action) || !releasePolicy.executionProviders.includes(connections.find(c => c.id === connectionId)?.provider || '') || (task.managementMode === 'managed' && action === 'create' && launchMode === 'create_and_activate' && !releasePolicy.allowedActions.includes('activate')));
  const [google, setGoogle] = useState({ targetCpa: 10, videoAssetId: '', logoAssetId: '', finalUrl: '', businessName: '', headline: '', longHeadline: '', description: '', locationIds: '' });
  const refresh = async () => { const [executionResult, approvalResult, launchResult] = await Promise.all([platformAdsRequest<{ items: typeof records }>(`/tasks/${encodeURIComponent(task.id)}/executions`), platformAdsRequest<{ items: typeof approvals }>(`/tasks/${encodeURIComponent(task.id)}/approvals`), platformAdsRequest<{ items: typeof launches }>(`/tasks/${encodeURIComponent(task.id)}/launch`)]); setRecords(executionResult.items); if (executionResult.items.some(item => item.status !== 'FAILED')) onExecution?.(); setApprovals(approvalResult.items); setLaunches(launchResult.items); };
  useEffect(() => { refresh().catch(e => setFeedback(message(e))); }, [task.id]);
  const executionInput = { expectedVersion: task.version || 1, ...(creative && task.managementMode === 'manual' && action === 'create' && !isTikTok && !isGoogle && creative.connectionId === connectionId ? { creativeId: creative.id } : {}), connectionId, action, resourceId, ...(task.managementMode === 'managed' && action === 'create' ? { launchMode } : {}), dailyBudget: meta.dailyBudget, ...(isGoogle ? { google: { ...google, locationIds: google.locationIds.split(',').map(item => item.trim()).filter(Boolean) } } : isTikTok ? { tiktok: { ...tiktok, locationIds: tiktok.locationIds.split(',').map(item => item.trim()).filter(Boolean) } } : { meta: { ...meta, countries: meta.countries.split(',').map(c => c.trim().toUpperCase()).filter(Boolean) } }) };
  const fingerprint = JSON.stringify({ taskId: task.id, ...executionInput });
  const currentPreflight = preflight?.fingerprint === fingerprint ? preflight.report : null;
  const checkBeforeSubmit = async () => {
    setBusy(true); setFeedback(''); setPreflight(null);
    try {
      const report = await platformAdsRequest<PreflightReport>(`/tasks/${encodeURIComponent(task.id)}/preflight`, { method: 'POST', body: JSON.stringify(executionInput) });
      setPreflight({ fingerprint, report });
    } catch (error) { setFeedback(message(error)); } finally { setBusy(false); }
  };
  const execute = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setFeedback('');
    try {
      if (currentPreflight && !currentPreflight.canSubmit) throw new Error('投放前检查存在阻塞项，请处理后重试。');
      if (releaseBlocked) throw new Error(releasePolicy?.reason || '当前操作未开放');
      if (currencyMismatch) throw new Error(`广告账户币种与计划 ${currency} 不一致，无法执行；请使用同币种账户或新建方案。`);
      const result = await platformAdsRequest<Record<string, unknown>>(`/tasks/${encodeURIComponent(task.id)}/${task.managementMode === 'managed' && action === 'create' ? 'launch' : task.managementMode === 'approval' ? 'approvals' : 'execute'}`, { method: 'POST', body: JSON.stringify({ ...executionInput, requestId: crypto.randomUUID() }) });
      const execution = result.execution as { status?: string; result?: { campaignId?: string }; error?: string } | undefined;
      if (execution?.result?.campaignId) setResourceId(execution.result.campaignId);
      setFeedback(task.managementMode === 'managed' && action === 'create' ? launchMode === 'create_paused' ? '托管暂停创建任务已保存。系统仅创建并核验广告，不会自动启用。' : '自动启动任务已保存。系统将在授权范围内创建并启用广告，请查看启动状态。' : task.managementMode === 'approval' ? '动作已提交审批，尚未执行。' : execution?.status === 'VERIFIED' ? action === 'create' ? '完整广告已创建并核验，当前保持暂停。' : '平台操作已核验，请查看执行回执与最新效果。' : execution?.error || `执行状态：${execution?.status || '未知'}，请核验平台结果后再继续。`);
      await refresh();
    } catch (e) { setFeedback(message(e)); await refresh().catch(() => {}); } finally { setBusy(false); }
  };
  return <div className="ads-execution"><h3>真实平台执行</h3><p className="ads-muted">Meta 支持网站引流与视频观看；TikTok 支持已有授权帖子的视频观看；Google 支持使用现有资产的 Demand Gen 转化人工计划。后两者需单一对应渠道与未来起止排期，暂不开放自动托管或审批。创建后广告均暂停，启动会产生真实消耗。任务版本：{task.version || 1}</p>
    <AdCreativePanel task={task} connections={connections} onUpdate={onUpdate} uploadAllowed={!!releasePolicy?.allowedActions.includes('create') && !!releasePolicy?.executionProviders.includes('meta')} onUse={item => { setCreative(item); setConnectionId(item.connectionId); setAction('create'); setMeta(value => ({ ...value, videoId: item.platformVideoId })); setPreflight(null); }} />
    {creative && <p role="status" className="ads-muted">已选成片：{creative.name} · {creative.sha256.slice(0, 12)}。仅关联本次 Meta 人工创建。<button type="button" className="ads-text-button" onClick={() => { setCreative(null); setMeta(value => ({ ...value, videoId: '' })); }}>改用手填平台视频</button></p>}
    {task.managementMode === 'manual' && <section className="ads-preflight" aria-label="投放前检查">
      <div className="ads-section-title"><h3>投放前检查</h3><button type="button" className="ads-button" disabled={busy} onClick={() => void checkBeforeSubmit()}>{busy ? '处理中…' : '检查当前配置'}</button></div>
      <p className="ads-muted">检查当前计划与表单，不上传素材、不创建广告。结果不代表平台账户在线、审核通过或预算充足。</p>
      {currentPreflight ? <div role="status"><strong>{currentPreflight.canSubmit ? '本地检查通过，平台条件仍待核验' : '以下事项需要处理'}</strong><ul>{currentPreflight.checks.map(check => <li key={check.id}><strong>{check.status === 'pass' ? '通过' : check.status === 'blocked' ? '需处理' : '待核验'} · {check.label}</strong><p>{check.message}</p></li>)}</ul><small>检查时间：{new Date(currentPreflight.checkedAt).toLocaleString('zh-CN')}</small></div> : <p className="ads-muted">{preflight ? '配置已变化，请重新检查。' : '填写下方配置后，可先检查缺失项。'}</p>}
    </section>}
    <form className="ads-form-fields" onSubmit={execute}>
      <label>广告账户<select aria-label="广告账户" required value={connectionId} onChange={e => { setConnectionId(e.target.value); setCreative(null); setMeta(value => ({ ...value, videoId: '' })); }}><option value="">选择已连接账户</option>{connections.filter(c => ['meta', 'tiktok', 'google'].includes(c.provider)).map(c => <option key={c.id} value={c.id} disabled={c.currency !== currency}>{c.name} · {c.provider} · {c.currency} · {c.status}{c.currency !== currency ? '（币种不匹配）' : ''}</option>)}</select></label>
      <label>操作<select aria-label="操作" value={action} onChange={e => setAction(e.target.value)}><option value="create">创建完整广告（暂停）</option><option value="activate">启动真实广告</option><option value="pause">暂停广告</option><option value="resume">恢复广告</option><option value="adjust_budget">调整日预算</option></select></label>
      {task.managementMode === 'managed' && action === 'create' && <label>托管创建方式<select value={launchMode} onChange={e => setLaunchMode(e.target.value as typeof launchMode)}><option value="create_paused">创建并保持暂停（不自动启用）</option><option value="create_and_activate">创建后自动启用（可能产生真实消耗）</option></select></label>}
      {action === 'create' && isGoogle ? <>
        <p className="ads-muted">目标选择“获取线索或转化”，渠道仅选 YouTube。资产 ID 必须为 Google Ads 已有资产，不是 YouTube 视频 ID。</p>
        {([['videoAssetId', 'Google 视频资产 ID', 200], ['logoAssetId', 'Google Logo 资产 ID', 200], ['businessName', '品牌名称', 25], ['headline', '短标题', 40], ['longHeadline', '长标题', 90], ['description', '广告描述', 90], ['locationIds', 'Google 地域 ID（逗号分隔）', 500]] as const).map(([key, label, maxLength]) => <label key={key}>{label}<input required maxLength={maxLength} value={google[key]} onChange={e => setGoogle({ ...google, [key]: e.target.value })} /></label>)}
        <label>Google 落地页 HTTPS 地址<input required type="url" pattern="https://.*" value={google.finalUrl} onChange={e => setGoogle({ ...google, finalUrl: e.target.value })} /></label>
        <label>目标转化成本（{currency}）<input required type="number" min="0.01" step="0.01" value={google.targetCpa} onChange={e => setGoogle({ ...google, targetCpa: Number(e.target.value) })} /></label>
      </> : action === 'create' && isTikTok ? <>
        <label>TikTok 授权身份 ID<input required value={tiktok.identityId} onChange={e => setTikTok({ ...tiktok, identityId: e.target.value })} /></label>
        <label>既有可推广帖子 ID<input required value={tiktok.tiktokItemId} onChange={e => setTikTok({ ...tiktok, tiktokItemId: e.target.value })} /></label>
        <label>TikTok 地域 ID（逗号分隔）<input required value={tiktok.locationIds} onChange={e => setTikTok({ ...tiktok, locationIds: e.target.value })} placeholder="6252001" /></label>
        <label>TikTok 广告文案<input required value={tiktok.adText} onChange={e => setTikTok({ ...tiktok, adText: e.target.value })} /></label>
        <p className="ads-muted">使用计划总预算 {currency} {task.budget}；当前 TikTok 路径仅支持人工创建和启停。</p>
      </> : action === 'create' ? <>
        <label>Facebook 主页 ID<input required pattern="[0-9]+" value={meta.pageId} onChange={e => setMeta({ ...meta, pageId: e.target.value })} /></label>
        <label>Meta 已上传视频 ID<input required pattern="[0-9]+" readOnly={!!creative && task.managementMode === 'manual'} value={meta.videoId} onChange={e => setMeta({ ...meta, videoId: e.target.value })} /></label>
        <label>公开视频缩略图 HTTPS 地址<input required type="url" pattern="https://.*" value={meta.imageUrl} onChange={e => setMeta({ ...meta, imageUrl: e.target.value })} /></label>
        <label>落地页 HTTPS 地址{task.goal === '提升有效视频观看' ? '（视频观看可不填）' : ''}<input required={task.goal !== '提升有效视频观看'} type="url" pattern="https://.*" value={meta.linkUrl} onChange={e => setMeta({ ...meta, linkUrl: e.target.value })} /></label>
        <label>广告文案<textarea required value={meta.message} onChange={e => setMeta({ ...meta, message: e.target.value })} /></label>
        <label>目标国家代码（逗号分隔）<input required value={meta.countries} onChange={e => setMeta({ ...meta, countries: e.target.value })} placeholder="US,CA" /></label>
      </> : <label>平台广告系列 ID<input required pattern={isGoogle ? 'customers/[0-9]+/campaigns/[0-9]+' : '[0-9]+'} value={resourceId} onChange={e => setResourceId(e.target.value)} placeholder={isGoogle ? 'customers/123/campaigns/456' : '使用执行记录中的 campaignId'} /></label>}
      {!isTikTok && !isGoogle && ['create', 'adjust_budget'].includes(action) && <label>日预算（{currency}）<input required min="1" max={task.budget} step="0.01" type="number" value={meta.dailyBudget} onChange={e => setMeta({ ...meta, dailyBudget: Number(e.target.value) })} /></label>}
      <button className="ads-button primary" disabled={busy || currentPreflight?.canSubmit === false || releaseBlocked || !connectionId || currencyMismatch || task.managementMode === 'suggest' || ((isTikTok || isGoogle) && (task.managementMode !== 'manual' || action === 'adjust_budget' || task.goal !== (isGoogle ? '获取线索或转化' : '提升有效视频观看'))) || (task.managementMode === 'managed' && action !== 'create') || (action === 'create' && !isGoogle && !['提升网站访问', '提升有效视频观看'].includes(task.goal))}>{busy ? '处理请求中…' : task.managementMode === 'suggest' ? '建议模式不执行平台动作' : task.managementMode === 'managed' ? action === 'create' ? launchMode === 'create_paused' ? '保存并自动创建暂停广告' : '保存并自动启动真实投放' : '人工调整前请先接管计划' : task.managementMode === 'approval' ? '提交动作审批' : action === 'create' ? '创建真实广告并保持暂停' : ['activate', 'resume'].includes(action) ? '确认启动真实投放' : '执行平台操作'}</button>
    </form>
    {feedback && <p role="status" className="ads-operation-feedback">{feedback}</p>}
    {launches.length > 0 && <section><h3>自动启动状态</h3>{launches.map((launch, index) => <p key={String(launch.id || index)}>{launch.launchMode === 'create_paused' ? '仅创建暂停广告' : '创建后自动启用'} · {statusLabel(launch.status)} · {String(launch.reason || launch.error || '')}{['UNKNOWN', 'CREATING', 'ACTIVATING'].includes(String(launch.status)) && <button className="ads-text-button" disabled={busy} onClick={async () => { setBusy(true); try { await platformAdsRequest(`/tasks/${encodeURIComponent(task.id)}/launch/${encodeURIComponent(String(launch.id))}/reconcile`, { method: 'POST' }); await refresh(); } catch (e) { setFeedback(message(e)); } finally { setBusy(false); } }}>核验平台结果</button>}</p>)}</section>}
    <h3>动作审批</h3>{approvals.length ? approvals.map(approval => <div key={String(approval.id)} className="ads-proposal"><p>{String(approval.action)} · {statusLabel(approval.status)} · {String(approval.resourceId || '')}</p><details><summary>查看动作参数与影响范围</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(approval, null, 2)}</pre></details>{approval.status === 'PENDING' && <div className="ads-actions">{(['approve', 'reject'] as const).map(decision => <button className="ads-button" key={decision} disabled={busy} onClick={async () => { setBusy(true); try { await platformAdsRequest(`/tasks/${encodeURIComponent(task.id)}/approvals/${encodeURIComponent(String(approval.id))}/decision`, { method: 'POST', body: JSON.stringify({ decision }) }); await refresh(); } catch (e) { setFeedback(message(e)); } finally { setBusy(false); } }}>{decision === 'approve' ? '批准并执行' : '拒绝'}</button>)}</div>}</div>) : <p className="ads-muted">暂无待审批动作。</p>}
    {approvals.filter(item => ['UNKNOWN', 'APPROVING'].includes(String(item.status))).map(item => <button key={String(item.id)} className="ads-button" disabled={busy} onClick={async () => { setBusy(true); try { await platformAdsRequest(`/tasks/${encodeURIComponent(task.id)}/approvals/${encodeURIComponent(String(item.id))}/reconcile`, { method: 'POST' }); await refresh(); } catch (e) { setFeedback(message(e)); } finally { setBusy(false); } }}>核验审批 {String(item.id)} 的平台结果</button>)}
    <div className="ads-section-title"><h3>执行记录与平台回执</h3><button className="ads-button" disabled={busy} onClick={() => refresh().catch(e => setFeedback(message(e)))}>刷新记录</button></div>
    {records.length ? records.map((record, i) => <details key={String(record.id || i)}><summary>{String(record.action || '操作')} · {statusLabel(record.status)} · {String(record.createdAt || '')}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(record, null, 2)}</pre></details>) : <p className="ads-muted">尚无执行记录。平台请求失败或结果不确定时不会显示为投放成功。</p>}
  </div>;
}

export function AdTaskMetrics({ taskId }: { taskId: string }) {
  const [data, setData] = useState<{ stale?: boolean; dataNote?: string; currency: string; reportedAt: string; spend: number | null; impressions: number | null; clicks: number | null; results: number | null; costPerResult: number | null; metricLabel: string; forecast?: { status: string; range?: { low: number; high: number } } } | null>(null);
  const [error, setError] = useState('');
  const refresh = () => platformAdsRequest<NonNullable<typeof data>>(`/tasks/${encodeURIComponent(taskId)}/metrics`).then(result => { setData(result); setError(''); }).catch(e => { setError(message(e)); setData(null); });
  useEffect(() => { void refresh(); }, [taskId]);
  const metrics = data ? [
    { id: 'spend', label: '消耗', value: data.spend === null ? '—' : `${data.currency} ${data.spend}` },
    { id: 'impressions', label: '展示', value: data.impressions },
    { id: 'clicks', label: '点击', value: data.clicks },
    { id: 'results', label: data.metricLabel || '结果', value: data.results },
  ] : [];
  return <div><div className="ads-section-title"><h3>{data?.stale ? '真实历史投放快照（非实时）' : '真实投放效果 · 最近 7 天'}</h3><button className="ads-text-button" onClick={() => void refresh()}>刷新效果</button></div>{data ? <>{data.stale && <p role="status">{data.dataNote}</p>}<div className="ads-detail-metrics">{metrics.map(({ id, label, value }) => <div key={id}><span>{label}</span><strong>{value ?? '—'}</strong></div>)}</div><p className="ads-muted">平台数据更新时间：{data.reportedAt || '暂无平台数据'}。{data.forecast?.status === 'available' && data.forecast.range ? `预计结果区间 ${data.forecast.range.low}–${data.forecast.range.high}，非收益承诺。` : '预测样本不足，暂不可预测。'}</p></> : <p className="ads-muted">{error || '正在读取平台效果…'}</p>}</div>;
}

function AdAutomationControls({ task, connections }: { task: PlatformAdTask; connections: Connection[] }) {
  const currency = task.currency || 'USD';
  const [settings, setSettings] = useState({ connectionId: '', resourceId: '', targetCpc: 1, minClicks: 30, cooldownMinutes: 1440, maxMetricAgeMinutes: 15, enabled: true });
  const [data, setData] = useState<{ rules: Array<Record<string, unknown>>; runs: Array<Record<string, unknown>> }>({ rules: [], runs: [] });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const refresh = () => platformAdsRequest<typeof data>(`/tasks/${encodeURIComponent(task.id)}/automation`).then(setData);
  useEffect(() => { refresh().catch(e => setFeedback(message(e))); }, [task.id]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setFeedback('');
    if (connections.find(account => account.id === settings.connectionId)?.currency !== currency) { setFeedback('规则账户币种与计划不一致，请选择同币种账户。'); setBusy(false); return; }
    try { await platformAdsRequest(`/tasks/${encodeURIComponent(task.id)}/automation`, { method: 'POST', body: JSON.stringify({ ...settings, expectedVersion: task.version || 1 }) }); await refresh(); setFeedback('优化规则已保存；每次运行的依据与结果见观察记录。'); }
    catch (e) { setFeedback(message(e)); } finally { setBusy(false); }
  };
  const supportsOptimization = getAdPlanCapability(task).supportsCpcOptimization;
  return <section className="ads-automation"><h3>持续优化规则</h3><p className="ads-muted">针对已核验创建的 Meta 网站访问系列，观察真实点击成本与消耗。规则保存不代表后台正在运行；只有有效托管授权、后台服务和平台条件均满足时才能执行。样本不足时保持观察。</p>{!supportsOptimization && <p className="ads-muted">此计划暂不支持持续优化，以下仅展示已有规则与观察记录。</p>}{supportsOptimization && <form className="ads-form-fields" onSubmit={save}>
    <label>规则账户<select required value={settings.connectionId} onChange={e => setSettings({ ...settings, connectionId: e.target.value })}><option value="">选择已连接账户</option>{connections.filter(c => c.provider === 'meta').map(c => <option key={c.id} value={c.id} disabled={c.currency !== currency}>{c.name} · {c.currency}{c.currency !== currency ? '（币种不匹配）' : ''}</option>)}</select></label>
    <label>规则广告系列 ID<input required pattern="[0-9]+" value={settings.resourceId} onChange={e => setSettings({ ...settings, resourceId: e.target.value })} /></label>
    <label>目标点击成本（{currency}）<input type="number" min="0.01" step="0.01" required value={settings.targetCpc} onChange={e => setSettings({ ...settings, targetCpc: Number(e.target.value) })} /></label>
    <label>最小点击样本<input type="number" min="30" required value={settings.minClicks} onChange={e => setSettings({ ...settings, minClicks: Number(e.target.value) })} /></label>
    <label>调整间隔（分钟）<input type="number" min="60" max="43200" required value={settings.cooldownMinutes} onChange={e => setSettings({ ...settings, cooldownMinutes: Number(e.target.value) })} /></label>
    <label>规则状态<select value={String(settings.enabled)} onChange={e => setSettings({ ...settings, enabled: e.target.value === 'true' })}><option value="true">启用持续观察与优化</option><option value="false">停用规则</option></select></label>
    <button className="ads-button primary" disabled={busy || !settings.connectionId}>{busy ? '保存中…' : '保存优化规则'}</button>
  </form>}{feedback && <p role="status">{feedback}</p>}<div className="ads-section-title"><h3>规则与观察记录</h3><button className="ads-text-button" onClick={() => refresh().catch(e => setFeedback(message(e)))}>刷新观察</button></div>{data.rules.map((rule, index) => <details key={String(rule.id || index)}><summary>系列 {String(rule.resourceId || '')} · {rule.enabled ? '规则启用' : '规则停用'}</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(rule, null, 2)}</pre></details>)}{data.runs.length ? data.runs.map((run, index) => <p key={String(run.id || index)}>{String(run.createdAt || '')} · {String(run.status || '')} · {String(run.reason || '')}</p>) : <p className="ads-muted">暂无运行观察记录。</p>}</section>;
}
