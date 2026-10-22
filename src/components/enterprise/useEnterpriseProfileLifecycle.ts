import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { authHeader } from '../../lib/auth';
import type { ProductApiStatus } from '../EnterpriseProductImportCard';
import { saveEnterpriseProfileAndVerify } from './enterpriseProfilePersistence';
import { hydrateEnterpriseProfile, profileSnapshot } from './enterpriseProfileState';
import type { FaqPack, Profile } from './enterpriseProfileTypes';

interface Options {
  profile: Profile;
  setProfile: Dispatch<SetStateAction<Profile>>;
  saveError: string;
  setSaveError: Dispatch<SetStateAction<string>>;
  setSaved: Dispatch<SetStateAction<boolean>>;
  acceptLoadedPacks: (data: { packs?: FaqPack[]; recommendedIndustry?: string }) => void;
}

export function useEnterpriseProfileLifecycle({ profile, setProfile, saveError, setSaveError, setSaved, acceptLoadedPacks }: Options) {
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [apiStatus, setApiStatus] = useState<ProductApiStatus>({ count: 0 });
  const persistedProfileRef = useRef('');
  const productStatusAbortRef = useRef<AbortController | null>(null);
  const hasUnsavedChanges = profileLoaded && !loading && persistedProfileRef.current !== profileSnapshot(profile);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    const requestInit = { headers: authHeader(), signal: controller.signal };
    Promise.all([
      fetch('/api/overseas/enterprise/profile', requestInit).then(r => r.ok ? r.json() : Promise.reject(new Error(`企业资料加载失败（${r.status}）`))),
      fetch('/api/overseas/enterprise/product-api/status', requestInit).then(r => r.json()).catch(() => ({ count: 0 })),
      fetch('/api/overseas/enterprise/faq/packs', requestInit).then(r => r.json()).catch(() => ({ packs: [], recommendedIndustry: 'general' })),
    ])
      .then(([data, productApiStatus, packData]: [Partial<Profile>, ProductApiStatus, { packs?: FaqPack[]; recommendedIndustry?: string }]) => {
        if (!active) return;
        const next = hydrateEnterpriseProfile(data);
        persistedProfileRef.current = profileSnapshot(next);
        setProfile(next);
        setProfileLoaded(true);
        setSaveError('');
        setApiStatus(productApiStatus);
        acceptLoadedPacks(packData);
      })
      .catch(error => {
        if (!active) return;
        setProfileLoaded(false);
        setSaveError(error instanceof Error && error.name === 'AbortError'
          ? '企业资料加载超时，请刷新后重试'
          : error instanceof Error ? error.message : '企业资料加载失败，请刷新后重试');
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!profileLoaded) return;
    let disposed = false;
    let inFlight = false;
    const poll = async () => {
      if (disposed || inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      const controller = new AbortController();
      productStatusAbortRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch('/api/overseas/enterprise/product-api/status', {
          headers: authHeader(),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`产品接口状态查询失败（${response.status}）`);
        const status = await response.json() as ProductApiStatus;
        if (!disposed) setApiStatus(status);
      } catch {
        // Keep the last successful status; the next bounded poll can recover.
      } finally {
        window.clearTimeout(timeout);
        if (productStatusAbortRef.current === controller) productStatusAbortRef.current = null;
        inFlight = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void poll();
      else productStatusAbortRef.current?.abort();
    };
    const timer = window.setInterval(() => void poll(), 5000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      productStatusAbortRef.current?.abort();
      productStatusAbortRef.current = null;
    };
  }, [profileLoaded]);

  const handleSave = async () => {
    if (!profileLoaded) {
      setSaveError('企业资料尚未成功加载，请刷新后重试');
      return;
    }
    setSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      const confirmedProfile = await saveEnterpriseProfileAndVerify(profile);
      persistedProfileRef.current = profileSnapshot(confirmedProfile);
      setProfile(confirmedProfile);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (loading || saving || !hasUnsavedChanges || saveError) return;
    const timer = window.setTimeout(() => { void handleSave(); }, 900);
    return () => window.clearTimeout(timer);
  }, [profile, loading, saving, hasUnsavedChanges, saveError]);

  return { saving, loading, profileLoaded, apiStatus, hasUnsavedChanges, handleSave };
}
