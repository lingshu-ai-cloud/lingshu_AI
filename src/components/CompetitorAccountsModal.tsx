import { Button, Input, Modal, Popconfirm, Select } from 'antd';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Loader2, Trash2, Download, Users, ExternalLink, AlertCircle } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { SocialPlatformIcon } from './SocialPlatformIcon';

import { readCompetitorAccounts, type AccountPlatform, type CrawlContentMode, type CompetitorAccount } from '../lib/competitorAccountsApi';

const PLATFORM_META: Record<AccountPlatform, { label: string }> = {
  linkedin: { label: 'LinkedIn' },
  facebook: { label: 'Facebook' },
  youtube: { label: 'YouTube' },
  tiktok: { label: 'TikTok' },
  instagram: { label: 'Instagram' },
};

const CRAWL_COUNT_OPTIONS = [3, 10, 20, 30].map(value => ({ value, label: `${value} 条` }));
const CRAWL_MODE_OPTIONS: Array<{ value: CrawlContentMode; label: string }> = [
  { value: 'mixed', label: '混合模式' },
  { value: 'video', label: '仅视频' },
  { value: 'image', label: '仅图文' },
];

function crawlModeLabel(mode?: CrawlContentMode): string {
  return CRAWL_MODE_OPTIONS.find(option => option.value === mode)?.label || '仅视频';
}

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function readError(r: Response, fallback: string): Promise<string> {
  const data = await r.json().catch(() => ({})) as { error?: string };
  return data.error || fallback;
}

function accountPlaceholder(platform: AccountPlatform): string {
  if (platform === 'linkedin') return 'https://www.linkedin.com/company/company-name';
  if (platform === 'youtube') return 'https://www.youtube.com/@handle';
  if (platform === 'tiktok') return 'https://www.tiktok.com/@user';
  if (platform === 'instagram') return 'https://www.instagram.com/username';
  return 'https://www.facebook.com/page';
}

export default function CompetitorAccountsModal({
  open,
  onClose,
  onCrawled,
  onCountChange,
  embedded = false,
}: {
  open: boolean;
  onClose: () => void;
  onCrawled: (importedCount: number, mode: CrawlContentMode, queued: boolean) => void;
  onCountChange?: (count: number) => void;
  embedded?: boolean;
}) {
  const [accounts, setAccounts] = useState<CompetitorAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [platform, setPlatform] = useState<AccountPlatform>('linkedin');
  const [crawlMode, setCrawlMode] = useState<CrawlContentMode>('mixed');
  const [crawlCount, setCrawlCount] = useState(10);
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [crawlingId, setCrawlingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const accountRequestRef = useRef(0);
  const accountReadsInFlight = useRef(0);
  const loadAccounts = useCallback(async (quiet = false) => {
    if (quiet && accountReadsInFlight.current) return;
    const requestId = ++accountRequestRef.current;
    accountReadsInFlight.current += 1;
    if (!quiet) setLoading(true);
    try {
      const items = await readCompetitorAccounts();
      if (requestId !== accountRequestRef.current) return;
      setAccounts(items);
      onCountChange?.(items.length);
      setError('');
    } catch (error) {
      if (requestId === accountRequestRef.current) setError(error instanceof Error ? error.message : '对标账号读取失败');
    } finally {
      accountReadsInFlight.current -= 1;
      if (requestId === accountRequestRef.current) setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    if (open) {
      setError('');
      setNotice('');
      void loadAccounts();
    }
  }, [open, loadAccounts]);

  useEffect(() => () => { accountRequestRef.current += 1; }, []);

  const hasRunningAccount = accounts.some(account => account.crawlStatus === 'running');
  useEffect(() => {
    if (!open || !hasRunningAccount) return;
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void loadAccounts(true); }, 4000);
    return () => window.clearInterval(timer);
  }, [open, hasRunningAccount, loadAccounts]);

  const addAccount = async () => {
    const trimmed = url.trim();
    if (!trimmed) { setError('请粘贴对标账号主页链接'); return; }
    setAdding(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch('/api/overseas/competitor-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ url: trimmed, platform }),
      });
      if (!r.ok) { setError(await readError(r, '添加失败')); return; }
      const data = await r.json().catch(() => ({})) as { item?: CompetitorAccount; duplicated?: boolean };
      setUrl('');
      setNotice(data.duplicated ? '该账号已在库中' : '已加入对标账号库');
      await loadAccounts();
      window.dispatchEvent(new Event('lingshu:competitor-accounts-updated'));
    } catch {
      setError('添加失败，请稍后重试');
    } finally {
      setAdding(false);
    }
  };

  const crawlAccount = async (account: CompetitorAccount) => {
    setCrawlingId(account.id);
    setError('');
    setNotice('');
    try {
      const r = await fetch(`/api/overseas/competitor-accounts/${account.id}/crawl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ limit: crawlCount, contentMode: crawlMode }),
      });
      if (!r.ok) { setError(await readError(r, '采集失败')); return; }
      const data = await r.json().catch(() => ({})) as { imported?: number; message?: string; queued?: boolean };
      const imported = Number(data.imported || 0);
      setNotice(data.message || `已从「${account.accountName}」以${crawlModeLabel(crawlMode)}采集 ${imported} 条作品`);
      await loadAccounts();
      onCrawled(imported, crawlMode, data.queued === true);
    } catch {
      setError('采集失败，请稍后重试');
    } finally {
      setCrawlingId('');
    }
  };

  const deleteAccount = async (account: CompetitorAccount) => {
    setDeletingId(account.id);
    setError('');
    try {
      const r = await fetch(`/api/overseas/competitor-accounts/${account.id}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
      if (!r.ok) throw new Error(await readError(r, '删除对标账号失败'));
      accountRequestRef.current += 1;
      setLoading(false);
      const next = accounts.filter(item => item.id !== account.id);
      setAccounts(next);
      onCountChange?.(next.length);
      window.dispatchEvent(new Event('lingshu:competitor-accounts-updated'));
    } catch (error) {
      setError(error instanceof Error ? error.message : '删除对标账号失败');
    } finally {
      setDeletingId('');
    }
  };

  const panel = open ? (
          <section aria-label="对标账号" className="flex min-h-[480px] w-full flex-col overflow-hidden rounded-lg border border-border bg-surface">
            {/* Add form */}
            <div className="border-b border-border bg-surface-2 px-4 py-4 sm:px-6">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select<AccountPlatform> value={platform} onChange={setPlatform} aria-label="平台" className="min-w-36"
                  options={Object.entries(PLATFORM_META).map(([value, meta]) => ({ value: value as AccountPlatform, label: <span className="inline-flex items-center gap-2"><SocialPlatformIcon platform={value as AccountPlatform} size={16}/>{meta.label}</span> }))} />
                <Input
                  type="text"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !adding) void addAccount(); }}
                  placeholder={accountPlaceholder(platform)}
                  aria-label="对标账号主页链接"
                  className="flex-1"
                />
                <Button type="primary" onClick={() => void addAccount()} loading={adding} icon={<Plus size={15} />}>添加账号</Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-text-secondary">采集内容</span>
                <Select<CrawlContentMode>
                  value={crawlMode}
                  onChange={setCrawlMode}
                  aria-label="主页作品采集模式"
                  className="min-w-32"
                  options={CRAWL_MODE_OPTIONS}
                />
                <span className="text-xs font-semibold text-text-secondary">采集数量</span>
                <Select<number>
                  value={crawlCount}
                  onChange={setCrawlCount}
                  aria-label="每种内容最多采集数量"
                  className="min-w-24"
                  options={CRAWL_COUNT_OPTIONS}
                />
                <span className="text-xs text-text-muted">混合模式优先采集主页高表现视频和图文；图文会保留原帖配文，已有原帖不重复入库。</span>
              </div>
              {error && (
                <p role="alert" className="mt-2 flex items-center gap-1.5 border-l-2 border-red bg-red/5 px-2 py-1.5 text-xs font-semibold text-red">
                  <AlertCircle size={13} /> {error}<Button size="small" type="link" onClick={() => void loadAccounts()}>重新读取</Button>
                </p>
              )}
              {!error && notice && (
                <p role="status" className="mt-2 border-l-2 border-accent bg-accent-glow px-2 py-1.5 text-xs font-semibold text-accent">{notice}</p>
              )}
            </div>

            {/* Accounts list */}
            <div className="min-h-[220px] flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              {loading ? (
                <div className="flex h-40 items-center justify-center text-text-muted">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : accounts.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
                  <Users size={26} className="text-text-muted" />
                  <p className="text-sm font-semibold text-text-primary">还没有对标账号</p>
                  <p className="text-xs text-text-muted">在上方粘贴一个 LinkedIn / YouTube / TikTok / Instagram / Facebook 主页链接开始</p>
                </div>
              ) : (
                <ul className="divide-y divide-border border-y border-border">
                  {accounts.map(account => {
                    const meta = PLATFORM_META[account.platform];
                    const crawling = crawlingId === account.id;
                    return (
                      <li key={account.id}
                        className="flex flex-wrap items-center gap-3 px-1 py-3 sm:flex-nowrap sm:px-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2">
                          <SocialPlatformIcon platform={account.platform} size={23} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-sm font-bold text-text-primary">{account.accountName}</p>
                            <a href={account.accountUrl} target="_blank" rel="noopener noreferrer"
                              className="shrink-0 text-text-muted hover:text-accent" title="打开主页">
                              <ExternalLink size={12} />
                            </a>
                          </div>
                          <p className="truncate text-xs text-text-muted">
                            {meta.label}
                            {account.lastCrawledAt
                              ? ` · 上次${crawlModeLabel(account.lastCrawlMode)}采集 ${formatTime(account.lastCrawledAt)}（+${account.lastCrawlCount}）`
                              : ' · 尚未采集'}
                          </p>
                          {account.crawlStatus === 'running' && <p className="mt-1 text-xs font-semibold text-accent">采集中 · 新作品会逐条同步到灵感大屏</p>}
                          {account.crawlStatus === 'failed' && <p className="mt-1 truncate text-xs font-semibold text-red" title={account.crawlError}>采集失败 · {account.crawlError || '请稍后重试'}</p>}
                        </div>
                        <div className="flex w-full items-center gap-2 pl-12 sm:w-auto sm:pl-0">
                        <Button onClick={() => void crawlAccount(account)} loading={crawling} disabled={account.crawlStatus === 'running' || (Boolean(crawlingId) && !crawling)} icon={<Download size={13} />} title={`以${crawlModeLabel(crawlMode)}采集主页高表现作品，每种最多 ${crawlCount} 条`}>采集爆款</Button>
                        <Popconfirm title="移除这个对标账号？" description="已采集的灵感内容会保留。" onConfirm={() => deleteAccount(account)} okText="移除" cancelText="取消"><Button danger loading={deletingId === account.id} icon={<Trash2 size={13} />} aria-label={`移除对标账号 ${account.accountName}`} /></Popconfirm>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

          </section>
  ) : null;

  if (embedded) return panel;

  return (
    <Modal open={open} title="对标账号管理" width={720} onCancel={onClose}
      closable={!adding && !crawlingId && !deletingId} keyboard={!adding && !crawlingId && !deletingId}
      mask={{ closable: false }} footer={<Button onClick={onClose} disabled={adding || Boolean(crawlingId) || Boolean(deletingId)}>完成</Button>}
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}>
      {panel}
    </Modal>
  );
}
