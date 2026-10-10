import { TikTokPostSettings } from './TikTokPostSettings';
import { emptyTikTokPostSettings, invalidateTikTokConsent, buildTikTokPostOptions, validateTikTokCreatorResponse, type TikTokCreatorResponse, type TikTokDirectPostOptions } from '../../lib/tikTokPostSettings';
import { useEffect, useState } from 'react';
import { authHeader } from '../../lib/auth';
import {
  buildExternalVideoApprovalRequests,
  canRestartExternalApprovals,
  canStartNextExternalVideo,
  EXTERNAL_VIDEO_PLATFORMS,
  type ExternalVideoAccount,
} from '../../lib/externalVideoApproval';
import type { PublishPlatform } from '../../lib/publishQueueState';
import { publishStorageKey } from '../../lib/publishQueueState';

type Approval = {
  id: string;
  status: string;
  contentHash: string;
  videoPreviewUrl?: string;
  platform: PublishPlatform;
  targetAccountIds: string[];
  title: string;
  description: string;
  scheduledAt: string;
  providerReceiptId?: string;
  platformPostId?: string;
  platformUrl?: string;
  publishError?: string;
  tiktokPostOptions?: TikTokDirectPostOptions;
  tiktokCreatorReceiptHash?: string;
};

const LABEL: Record<PublishPlatform, string> = {
  youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok',
};
const BASE = '/api/overseas/publishing/external-video-approvals';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...authHeader(), ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({})) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(data.message || data.error || `请求失败 (${response.status})`);
  return data;
}

function futureLocalValue(): string {
  const date = new Date(Date.now() + 15 * 60_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Independently reviewed external media. This does not claim agent-produced provenance. */
export function ExternalVideoApprovalPanel({ storageScope }: { storageScope?: string }) {
  const [accounts, setAccounts] = useState<ExternalVideoAccount[]>([]);
  const [accountIds, setAccountIds] = useState<Partial<Record<PublishPlatform, string>>>({});
  const [videoPath, setVideoPath] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scheduledAt, setScheduledAt] = useState(futureLocalValue);
  const [approvals, setApprovals] = useState<Partial<Record<PublishPlatform, Approval>>>({});
  const [previousApprovals, setPreviousApprovals] = useState<Approval[]>([]);
  const [previousApprovalIds, setPreviousApprovalIds] = useState<string[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [approvalsLoaded, setApprovalsLoaded] = useState(false);
  const [tikTokDraft, setTikTokDraft] = useState(emptyTikTokPostSettings);
  const [tikTokCreator, setTikTokCreator] = useState<TikTokCreatorResponse | null>(null);
  const [tikTokLoading, setTikTokLoading] = useState(false);
  const [tikTokError, setTikTokError] = useState('');
  const [tikTokRefreshKey, setTikTokRefreshKey] = useState(0);
  const approvalStorageKey = publishStorageKey('external_video_approvals', storageScope);
  const historyStorageKey = publishStorageKey('external_video_approval_history', storageScope);

  useEffect(() => { setTikTokDraft(current => invalidateTikTokConsent(current)); }, [videoPath, title, description, scheduledAt]);
  useEffect(() => {
    let active = true;
    const accountId = accountIds.tiktok || '';
    setTikTokCreator(null); setTikTokDraft(emptyTikTokPostSettings()); setTikTokError('');
    if (!accountId) { setTikTokLoading(false); return () => { active = false; }; }
    setTikTokLoading(true);
    void json<TikTokCreatorResponse>(`/api/overseas/social/accounts/${encodeURIComponent(accountId)}/tiktok/creator-info`).then(value => {
      if (active) {
        const fresh = validateTikTokCreatorResponse(value, accountId); setTikTokCreator(fresh);
        const frozen = approvals.tiktok;
        if (frozen?.tiktokPostOptions && frozen.tiktokCreatorReceiptHash === fresh.creatorReceiptHash && frozen.targetAccountIds[0] === accountId) setTikTokDraft({ ...frozen.tiktokPostOptions, disclosureEnabled: frozen.tiktokPostOptions.commercial.ownBrand || frozen.tiktokPostOptions.commercial.brandedContent });
      }
    }).catch(cause => { if (active) setTikTokError(cause instanceof Error ? cause.message : 'TikTok 最新账号设置读取失败'); }).finally(() => { if (active) setTikTokLoading(false); });
    return () => { active = false; };
  }, [accountIds.tiktok, tikTokRefreshKey, approvals.tiktok?.id]);

  useEffect(() => {
    let active = true;
    try {
      const saved = JSON.parse(localStorage.getItem(approvalStorageKey) || '{}') as Record<string, unknown>;
      void Promise.all(EXTERNAL_VIDEO_PLATFORMS.map(async platform => {
        const id = saved[platform];
        if (typeof id !== 'string' || !id.trim()) return null;
        const result = await json<{ approval: Approval }>(`${BASE}/${encodeURIComponent(id)}`);
        return result.approval;
      })).then(items => {
        if (!active) return;
        setApprovals(Object.fromEntries(items.filter((item): item is Approval => Boolean(item)).map(item => [item.platform, item])));
        const savedTikTok = items.find(item => item?.platform === 'tiktok');
        if (savedTikTok?.targetAccountIds[0]) setAccountIds(current => ({ ...current, tiktok: savedTikTok.targetAccountIds[0] }));
        setApprovalsLoaded(true);
      }).catch(() => { if (active) setError('已有审批单状态暂时无法读取，请刷新后重试。'); });
    } catch { setApprovalsLoaded(true); }
    return () => { active = false; };
  }, [approvalStorageKey]);

  useEffect(() => {
    try {
      const ids = JSON.parse(localStorage.getItem(historyStorageKey) || '[]') as unknown;
      if (!Array.isArray(ids)) { setHistoryLoaded(true); return; }
      const savedIds = ids.filter((id): id is string => typeof id === 'string' && Boolean(id.trim()));
      setPreviousApprovalIds(savedIds);
      void Promise.all(savedIds.map(id =>
        json<{ approval: Approval }>(`${BASE}/${encodeURIComponent(id)}`).then(result => result.approval).catch(() => null),
      )).then(items => { setPreviousApprovals(items.filter((item): item is Approval => Boolean(item))); setHistoryLoaded(true); });
    } catch { setHistoryLoaded(true); }
  }, [historyStorageKey]);

  useEffect(() => {
    if (!approvalsLoaded) return;
    try {
      localStorage.setItem(approvalStorageKey, JSON.stringify(Object.fromEntries(
        Object.entries(approvals).filter(([, approval]) => Boolean(approval)).map(([platform, approval]) => [platform, approval?.id]),
      )));
    } catch { /* browser storage unavailable */ }
  }, [approvalStorageKey, approvals, approvalsLoaded]);

  useEffect(() => {
    if (!historyLoaded) return;
    try { localStorage.setItem(historyStorageKey, JSON.stringify(previousApprovalIds)); }
    catch { /* browser storage unavailable */ }
  }, [historyStorageKey, previousApprovalIds, historyLoaded]);

  const canRestart = canRestartExternalApprovals(Object.values(approvals).filter((item): item is Approval => Boolean(item)));

  const restartApproval = () => {
    const abandoned = Object.values(approvals).filter((item): item is Approval => Boolean(item));
    setPreviousApprovals(current => [...current, ...abandoned]);
    setPreviousApprovalIds(current => [...new Set([...current, ...abandoned.map(approval => approval.id)])]);
    setApprovals({});
    setScheduledAt(futureLocalValue());
    setNotice('旧审批单编号已保留。请核对新的发布时间，再提交四平台新审批单。');
    setError('');
  };

  useEffect(() => {
    let active = true;
    void Promise.all([
      json<{ items?: Array<{ id: string; channelTitle: string; status: string }> }>('/api/overseas/youtube/accounts'),
      ...(['instagram', 'facebook', 'tiktok'] as const).map(platform =>
        json<{ items?: Array<{ id: string; title: string; handle?: string; status: string }> }>(`/api/overseas/social/accounts?platform=${platform}`)),
    ]).then(([youtube, instagram, facebook, tiktok]) => {
      if (!active) return;
      const next: ExternalVideoAccount[] = [
        ...(youtube.items || []).map(account => ({ id: account.id, platform: 'youtube' as const, label: account.channelTitle, status: account.status })),
        ...([['instagram', instagram], ['facebook', facebook], ['tiktok', tiktok]] as const).flatMap(([platform, result]) =>
          (result.items || []).map(account => ({ id: account.id, platform, label: account.handle || account.title, status: account.status }))),
      ];
      setAccounts(next);
      setAccountIds(Object.fromEntries(EXTERNAL_VIDEO_PLATFORMS.map(platform => [platform, next.find(account => account.platform === platform && account.status === 'connected')?.id || ''])));
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '无法读取已授权账号'); });
    return () => { active = false; };
  }, []);

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (!/\.(mp4|mov|webm|mkv|avi)$/i.test(file.name)) throw new Error('请选择视频文件');
      const result = await json<{ video: { videoPath: string; previewUrl: string } }>('/api/overseas/publishing/local-videos', {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file,
      });
      setVideoPath(result.video.videoPath);
      setPreviewUrl(result.video.previewUrl);
      setTitle(file.name.replace(/\.[^.]+$/, ''));
      setApprovals({});
      setNotice('获授权外部素材已存入灵枢；提交审批前不会发布。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '视频上传失败'); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      if (!tikTokCreator) throw new Error('请先读取 TikTok 最新账号设置');
      const tiktokPostOptions = buildTikTokPostOptions(tikTokDraft, tikTokCreator, accountIds.tiktok || '');
      const freshCreator = validateTikTokCreatorResponse(await json<TikTokCreatorResponse>(`/api/overseas/social/accounts/${encodeURIComponent(accountIds.tiktok || '')}/tiktok/creator-info`), accountIds.tiktok || '');
      if (freshCreator.creatorReceiptHash !== tikTokCreator.creatorReceiptHash || !freshCreator.directPostApproved) { setTikTokCreator(freshCreator); setTikTokDraft(emptyTikTokPostSettings()); throw new Error('TikTok 账号设置已变化，请重新选择并授权'); }
      const requests = buildExternalVideoApprovalRequests({ videoPath, title, description, scheduledAt, accountIds, accounts, trackWaLink: false, tiktokPostOptions, tiktokCreatorReceiptHash: freshCreator.creatorReceiptHash });
      const next = { ...approvals };
      for (const request of requests) {
        if (next[request.platform]) continue;
        const result = await json<{ approval: Approval }>(BASE, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
        });
        next[request.platform] = result.approval;
        setApprovals({ ...next });
      }
      setNotice('四个平台的审批单已创建。请逐张核对内容与账号，再批准排期。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '提交审批失败；已创建的审批单保留，请核对后重试'); }
    finally { setBusy(false); }
  };

  const approve = async (approval: Approval) => {
    setBusy(true); setError(''); setNotice('');
    try {
      if (approval.platform === 'tiktok') {
        if (!approval.tiktokCreatorReceiptHash || !approval.tiktokPostOptions) throw new Error('旧 TikTok 审批单缺少发布设置，请重新创建');
        const accountId = approval.targetAccountIds[0];
        const fresh = validateTikTokCreatorResponse(await json<TikTokCreatorResponse>(`/api/overseas/social/accounts/${encodeURIComponent(accountId)}/tiktok/creator-info`), accountId);
        if (!fresh.directPostApproved || fresh.creatorReceiptHash !== approval.tiktokCreatorReceiptHash) throw new Error('TikTok 平台审核未确认或账号设置已变化，请重新审批');
      }
      const result = await json<{ approval: Approval; calendarPostId: string }>(`${BASE}/${encodeURIComponent(approval.id)}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentHash: approval.contentHash }),
      });
      setApprovals(current => ({ ...current, [approval.platform]: { ...approval, ...result.approval } }));
      setNotice(`${LABEL[approval.platform]} 已批准并排期，日历任务 ${result.calendarPostId}。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '批准失败'); }
    finally { setBusy(false); }
  };

  const refresh = async (approval: Approval) => {
    setBusy(true); setError('');
    try {
      const result = await json<{ approval: Approval }>(`${BASE}/${encodeURIComponent(approval.id)}`);
      setApprovals(current => ({ ...current, [approval.platform]: result.approval }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取审批状态失败'); }
    finally { setBusy(false); }
  };

  let tikTokSettingsReady = false;
  try { if (tikTokCreator) { buildTikTokPostOptions(tikTokDraft, tikTokCreator, accountIds.tiktok || ''); tikTokSettingsReady = true; } } catch { /* incomplete user choices keep submission disabled */ }

  return <section aria-label="获授权外部素材发布审批" className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 shadow-sm">
    <h3 className="text-sm font-bold text-text-primary">获授权外部素材 · 四平台审批发布</h3>
    <p className="mt-1 text-xs text-text-secondary">从灵枢上传原视频，分别核对四个平台的账号与内容。此素材作为外部素材单独审批，不标记为经营编导自动生产结果；批准前不会提交平台。</p>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</p>}
    <label className="mt-4 block text-xs font-bold text-text-secondary">授权视频文件<input type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo" disabled={busy || Object.keys(approvals).length > 0} onChange={event => { void upload(event.target.files?.[0]); event.currentTarget.value = ''; }} className="mt-1 block w-full text-xs" /></label>
    {(previewUrl || Object.values(approvals).find(approval => approval?.videoPreviewUrl)?.videoPreviewUrl) && <video controls src={previewUrl || Object.values(approvals).find(approval => approval?.videoPreviewUrl)?.videoPreviewUrl} className="mt-3 max-h-72 w-full rounded-xl bg-black object-contain" />}
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <label className="text-xs font-bold text-text-secondary">标题<input value={title} disabled={busy || Object.keys(approvals).length > 0} onChange={event => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs" /></label>
      <label className="text-xs font-bold text-text-secondary">发布时间<input type="datetime-local" value={scheduledAt} disabled={busy || Object.keys(approvals).length > 0} onChange={event => setScheduledAt(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs" /></label>
    </div>
    <label className="mt-3 block text-xs font-bold text-text-secondary">配文<textarea value={description} disabled={busy || Object.keys(approvals).length > 0} onChange={event => setDescription(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs" /></label>
    <div className="mt-3 grid gap-2 md:grid-cols-4">{EXTERNAL_VIDEO_PLATFORMS.map(platform => <label key={platform} className="text-xs font-bold text-text-secondary">{LABEL[platform]} 目标账号<select value={accountIds[platform] || ''} disabled={busy || Object.keys(approvals).length > 0} onChange={event => setAccountIds(current => ({ ...current, [platform]: event.target.value }))} className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs"><option value="">请选择已授权账号</option>{accounts.filter(account => account.platform === platform && account.status === 'connected').map(account => <option key={account.id} value={account.id}>{account.label}</option>)}</select></label>)}</div>
    <TikTokPostSettings accountId={accountIds.tiktok || ''} creator={tikTokCreator} draft={tikTokDraft} onChange={setTikTokDraft} disabled={busy || Object.keys(approvals).length > 0} loading={tikTokLoading} error={tikTokError} onRefresh={() => setTikTokRefreshKey(value => value + 1)} />
    <button type="button" onClick={() => void submit()} disabled={busy || !approvalsLoaded || !videoPath || Object.keys(approvals).length === 4 || !tikTokSettingsReady} className="mt-4 rounded-lg bg-amber-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">提交四平台审批</button>
    {canRestart && <button type="button" disabled={busy || !historyLoaded} onClick={restartApproval} className="ml-2 rounded-lg border border-amber-400 bg-white px-4 py-2 text-xs font-bold text-amber-800 disabled:opacity-50">旧单过期或被拒绝 · 重新准备审批</button>}
    {canStartNextExternalVideo(EXTERNAL_VIDEO_PLATFORMS.map(platform => approvals[platform])) && <button type="button" disabled={busy} onClick={() => { setPreviousApprovals(current => [...current, ...Object.values(approvals).filter((item): item is Approval => Boolean(item))]); setPreviousApprovalIds(current => [...new Set([...current, ...Object.values(approvals).map(item => item?.id).filter((id): id is string => Boolean(id))])]); setApprovals({}); setVideoPath(''); setPreviewUrl(''); setTitle(''); setDescription(''); setScheduledAt(futureLocalValue()); setNotice('四个平台均有最终作品回执，可以上传下一份获授权外部素材。'); }} className="ml-2 rounded-lg border border-border bg-white px-4 py-2 text-xs font-bold text-text-secondary disabled:opacity-50">开始下一份素材</button>}
    {Object.values(approvals).length > 0 && <div className="mt-4 grid gap-2 md:grid-cols-2">{Object.values(approvals).map(approval => approval && <div key={approval.id} className="rounded-xl border border-border bg-white p-3">
      <strong className="text-xs">{LABEL[approval.platform]} · {approval.status}</strong>
      <p className="mt-1 text-xs">{approval.title}</p>
      {approval.platform === 'tiktok' && approval.tiktokPostOptions && <p className="mt-1 text-xs">已冻结 TikTok 设置：{approval.tiktokPostOptions.privacyLevel} · 评论 {approval.tiktokPostOptions.allowComment ? '允许' : '关闭'} · 合拍 {approval.tiktokPostOptions.allowDuet ? '允许' : '关闭'} · 拼接 {approval.tiktokPostOptions.allowStitch ? '允许' : '关闭'} · {approval.tiktokPostOptions.commercial.brandedContent ? 'Paid partnership' : approval.tiktokPostOptions.commercial.ownBrand ? 'Promotional content' : '未披露商业推广'} · AIGC {approval.tiktokPostOptions.isAigc ? '是' : '否'}</p>}
      <p className="mt-1 break-all text-[10px] text-text-muted">账号 {approval.targetAccountIds.map(id => accounts.find(account => account.id === id)?.label || id).join(', ')} · {new Date(approval.scheduledAt).toLocaleString('zh-CN')}</p>
      {approval.providerReceiptId && <p className="mt-1 break-all text-[10px] text-text-secondary">平台受理回执：{approval.providerReceiptId}</p>}
      {approval.platformPostId && <p className="mt-1 break-all text-[10px] text-emerald-700">平台作品 ID：{approval.platformPostId}</p>}
      {approval.platformUrl && <a href={approval.platformUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-[10px] text-emerald-700 underline">查看平台作品</a>}
      {approval.publishError && <p role="alert" className="mt-1 text-[10px] text-red-700">{approval.publishError}</p>}
      <div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={() => void refresh(approval)} className="rounded border border-border px-2 py-1 text-[10px]">刷新状态</button>{approval.status === 'awaiting_approval' && <button type="button" disabled={busy || (approval.platform === 'tiktok' && (!tikTokCreator?.directPostApproved || !approval.tiktokPostOptions || !approval.tiktokCreatorReceiptHash || approval.tiktokCreatorReceiptHash !== tikTokCreator.creatorReceiptHash))} onClick={() => void approve(approval)} className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white">核对后批准排期</button>}</div>
    </div>)}</div>}
    {previousApprovalIds.length > 0 && <details className="mt-4 text-xs text-text-secondary"><summary className="cursor-pointer font-bold">历史审批单（{previousApprovalIds.length}）</summary><ul className="mt-2 space-y-1">{previousApprovalIds.map(id => { const approval = previousApprovals.find(item => item.id === id); return <li key={id} className="break-all">{approval ? `${LABEL[approval.platform]} · ${approval.status} · ` : ''}审批单 {id}{approval?.platformUrl && <> · <a href={approval.platformUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">平台作品</a></>}</li>; })}</ul></details>}
  </section>;
}
