import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { PublishPlatform, PublishQueueItem } from '../../lib/publishQueueState';
import { fetchPublishingJson as fetchJson } from './publishRequest';

export type PublishAccount = {
  id: string;
  platform: PublishPlatform;
  title: string;
  handle?: string;
  status: 'connected' | 'error' | 'expired';
  avatarUrl?: string;
};

export function usePublishingAccounts(
  setItems: Dispatch<SetStateAction<PublishQueueItem[]>>,
  setError: Dispatch<SetStateAction<string>>,
) {
  const [accounts, setAccounts] = useState<PublishAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingTargetAccountIds, setPendingTargetAccountIds] = useState<string[]>([]);
  const accountTargetsSeededRef = useRef(false);
  const pendingAccountTargetsSeededRef = useRef(false);

  const loadAccounts = async () => {
    setLoading(true);
    setError('');
    try {
      const [youtube, tiktok, instagram, facebook, linkedin] = await Promise.all([
        fetchJson<{ items?: Array<{ id: string; channelTitle: string; status: PublishAccount['status']; thumbnailUrl?: string }> }>('/api/overseas/youtube/accounts'),
        fetchJson<{ items?: Array<{ id: string; title: string; handle?: string; status: PublishAccount['status']; avatarUrl?: string }> }>('/api/overseas/social/accounts?platform=tiktok'),
        fetchJson<{ items?: Array<{ id: string; title: string; handle?: string; status: PublishAccount['status']; avatarUrl?: string }> }>('/api/overseas/social/accounts?platform=instagram'),
        fetchJson<{ items?: Array<{ id: string; title: string; handle?: string; status: PublishAccount['status']; avatarUrl?: string }> }>('/api/overseas/social/accounts?platform=facebook'),
        fetchJson<{ items?: Array<{ id: string; title: string; handle?: string; status: PublishAccount['status']; avatarUrl?: string }> }>('/api/overseas/social/accounts?platform=linkedin'),
      ]);
      const next: PublishAccount[] = [
        ...(youtube.items ?? []).map(account => ({ id: account.id, platform: 'youtube' as const, title: account.channelTitle, handle: account.channelTitle, status: account.status, avatarUrl: account.thumbnailUrl })),
        ...(tiktok.items ?? []).map(account => ({ id: account.id, platform: 'tiktok' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
        ...(instagram.items ?? []).map(account => ({ id: account.id, platform: 'instagram' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
        ...(facebook.items ?? []).map(account => ({ id: account.id, platform: 'facebook' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
        ...(linkedin.items ?? []).map(account => ({ id: account.id, platform: 'linkedin' as const, title: account.title, handle: account.handle, status: account.status, avatarUrl: account.avatarUrl })),
      ];
      setAccounts(next);
      if (!pendingAccountTargetsSeededRef.current) {
        setPendingTargetAccountIds(next.filter(account => account.status === 'connected' && account.platform !== 'tiktok').map(account => account.id));
        pendingAccountTargetsSeededRef.current = true;
      }
      if (!accountTargetsSeededRef.current) {
        const connected = next.filter(account => account.status === 'connected' && account.platform !== 'tiktok');
        setItems(prev => prev.map(item => {
          if (item.targetAccountIds.length) return item;
          const matchingSource = item.sourcePlatform
            ? connected.filter(account => account.platform === item.sourcePlatform)
            : [];
          return {
            ...item,
            targetAccountIds: (matchingSource.length ? matchingSource : connected).map(account => account.id),
          };
        }));
        accountTargetsSeededRef.current = true;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取授权账号');
    } finally {
      setLoading(false);
    }
  };

  return { accounts, loading, pendingTargetAccountIds, setPendingTargetAccountIds, loadAccounts };
}
