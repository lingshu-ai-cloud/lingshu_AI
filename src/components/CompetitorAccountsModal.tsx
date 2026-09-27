import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Loader2, Trash2, Download, Users, ExternalLink, AlertCircle } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import { useModalFocus } from '../hooks/useModalFocus';

type AccountPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

interface CompetitorAccount {
  id: string;
  platform: AccountPlatform;
  accountUrl: string;
  accountName: string;
  handle: string;
  avatarUrl: string;
  note: string;
  lastCrawledAt: string;
  lastCrawlCount: number;
  createdAt: string;
}

const PLATFORM_META: Record<AccountPlatform, { label: string }> = {
  youtube: { label: 'YouTube' },
  tiktok: { label: 'TikTok' },
  instagram: { label: 'Instagram' },
  facebook: { label: 'Facebook' },
};

const CRAWL_COUNT = 3;

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
  if (platform === 'youtube') return 'https://www.youtube.com/@handle';
  if (platform === 'tiktok') return 'https://www.tiktok.com/@user';
  if (platform === 'instagram') return 'https://www.instagram.com/username';
  return 'https://www.facebook.com/page';
}

export default function CompetitorAccountsModal({
  open,
  onClose,
  onCrawled,
  embedded = false,
}: {
  open: boolean;
  onClose: () => void;
  onCrawled: (importedCount: number) => void;
  embedded?: boolean;
}) {
  const [accounts, setAccounts] = useState<CompetitorAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [platform, setPlatform] = useState<AccountPlatform>('youtube');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [crawlingId, setCrawlingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialogRef = useModalFocus<HTMLDivElement>({
    open: open && !embedded,
    onClose,
    closeOnEscape: () => !adding && !crawlingId && !deletingId,
  });

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/overseas/competitor-accounts', { headers: authHeader() });
      const data = await r.json().catch(() => ({})) as { items?: CompetitorAccount[] };
      setAccounts(data.items || []);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setError('');
      setNotice('');
      void loadAccounts();
    }
  }, [open, loadAccounts]);

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
        body: JSON.stringify({ limit: CRAWL_COUNT }),
      });
      if (!r.ok) { setError(await readError(r, '采集失败')); return; }
      const data = await r.json().catch(() => ({})) as { imported?: number; message?: string };
      const imported = Number(data.imported || 0);
      setNotice(data.message || `已从「${account.accountName}」采集 ${imported} 条最新视频`);
      await loadAccounts();
      onCrawled(imported);
    } catch {
      setError('采集失败，请稍后重试');
    } finally {
      setCrawlingId('');
    }
  };

  const deleteAccount = async (account: CompetitorAccount) => {
    setDeletingId(account.id);
    try {
      const r = await fetch(`/api/overseas/competitor-accounts/${account.id}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
      if (r.ok) setAccounts(prev => prev.filter(a => a.id !== account.id));
    } finally {
      setDeletingId('');
    }
  };

  const panel = open ? (
          <motion.div
            ref={dialogRef}
            tabIndex={embedded ? undefined : -1}
            role={embedded ? 'region' : 'dialog'}
            aria-modal={embedded ? undefined : true}
            aria-labelledby="competitor-accounts-title"
            initial={embedded ? false : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={embedded ? undefined : { opacity: 0, y: 16, scale: 0.98 }}
            onClick={e => e.stopPropagation()}
            className={embedded
              ? 'flex min-h-[560px] w-full flex-col overflow-hidden rounded-lg border border-border bg-white shadow-sm'
              : 'flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-lg border border-border bg-white shadow-xl sm:max-h-[86vh] sm:rounded-lg'}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:items-center sm:px-6">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-glow text-accent">
                  <Users size={18} />
                </span>
                <div>
                  <h2 id="competitor-accounts-title" className="text-base font-bold text-text-primary">对标账号</h2>
                  <p className="text-xs text-text-muted">集中查看已采集账号，并把最新内容送入灵感发现</p>
                </div>
              </div>
              {!embedded && <button type="button" data-modal-initial-focus onClick={onClose} aria-label="关闭对标账号库"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:bg-surface-2" title="关闭">
                <X size={16} />
              </button>}
            </div>

            {/* Add form */}
            <div className="border-b border-border bg-surface-2 px-4 py-4 sm:px-6">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative shrink-0">
                  <SocialPlatformIcon platform={platform} size={18} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2" />
                  <select
                    value={platform}
                    onChange={e => setPlatform(e.target.value as AccountPlatform)}
                    aria-label="平台"
                    className="ui-field ui-select h-11 cursor-pointer !w-auto !rounded-md !pl-9 text-sm font-bold"
                  >
                    <option value="youtube">YouTube</option>
                    <option value="tiktok">TikTok</option>
                    <option value="instagram">Instagram</option>
                    <option value="facebook">Facebook</option>
                  </select>
                </div>
                <input
                  type="text"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !adding) void addAccount(); }}
                  placeholder={accountPlaceholder(platform)}
                  aria-label="对标账号主页链接"
                  className="ui-field h-11 !rounded-md"
                />
                <button
                  type="button"
                  onClick={() => void addAccount()}
                  disabled={adding}
                  className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-md bg-accent px-4 text-sm font-bold text-white transition-colors hover:bg-accent-dim disabled:opacity-60"
                >
                  {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  添加
                </button>
              </div>
              {error && (
                <p role="alert" className="mt-2 flex items-center gap-1.5 border-l-2 border-red bg-red/5 px-2 py-1.5 text-xs font-semibold text-red">
                  <AlertCircle size={13} /> {error}
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
                  <p className="text-xs text-text-muted">在上方粘贴一个 YouTube / TikTok / Instagram / Facebook 主页链接开始</p>
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
                              ? ` · 上次采集 ${formatTime(account.lastCrawledAt)}（+${account.lastCrawlCount}）`
                              : ' · 尚未采集'}
                          </p>
                        </div>
                        <div className="flex w-full items-center gap-2 pl-12 sm:w-auto sm:pl-0">
                        <button
                          type="button"
                          onClick={() => void crawlAccount(account)}
                          disabled={crawling || Boolean(crawlingId)}
                          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-xs font-bold text-white transition-colors hover:bg-accent-dim disabled:opacity-60 sm:flex-none"
                          title={`采集最新 ${CRAWL_COUNT} 条`}
                        >
                          {crawling ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                          {crawling ? '采集中' : '采集最新'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteAccount(account)}
                          disabled={deletingId === account.id}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:border-red hover:bg-red/5 hover:text-red disabled:opacity-60"
                          title="移除"
                          aria-label={`移除对标账号 ${account.accountName}`}
                        >
                          {deletingId === account.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="border-t border-border bg-insight-soft px-4 py-3 text-xs text-insight-action sm:px-6">
              采集到的视频会进入「灵感发现」，并由编导 Agent 验收定时采集结果。
            </div>
          </motion.div>
  ) : null;

  if (embedded) return panel;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          role="presentation"
          onMouseDown={event => { if (event.target === event.currentTarget && !adding && !crawlingId && !deletingId) onClose(); }}
          className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:px-5 sm:py-6"
        >
          {panel}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
