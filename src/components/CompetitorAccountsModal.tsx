import { Button, Input, Modal, Popconfirm, Select } from 'antd';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, Trash2, Download, Users, ExternalLink, AlertCircle } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { SocialPlatformIcon } from './SocialPlatformIcon';

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
          <section aria-label="对标账号" className="flex min-h-[480px] w-full flex-col overflow-hidden rounded-lg border border-border bg-surface">
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
            </div>

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
                        <Button onClick={() => void crawlAccount(account)} loading={crawling} disabled={Boolean(crawlingId) && !crawling} icon={<Download size={13} />} title={`采集最新 ${CRAWL_COUNT} 条`}>采集最新</Button>
                        <Popconfirm title="移除这个对标账号？" description="已采集的灵感内容会保留。" onConfirm={() => deleteAccount(account)} okText="移除" cancelText="取消"><Button danger loading={deletingId === account.id} icon={<Trash2 size={13} />} aria-label={`移除对标账号 ${account.accountName}`} /></Popconfirm>
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
