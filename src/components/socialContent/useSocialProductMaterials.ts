import { useCallback, useEffect, useMemo, useState } from 'react';
import { studioApi, type Material } from '../../lib/studioApi';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import { materialToClip } from '../studio/studioSourceMaterial';
import { productMaterialCandidates } from '../studio/studioProductMaterialSelection';
import { useProductMaterialSelection } from '../studio/useProductMaterialSelection';

export async function readSocialProductMaterialInventory(list = studioApi.listMaterialLibrary) {
  // This existing endpoint is unpaginated when page/pageSize are absent.
  const result = await list('library');
  if (result.status !== 'ready') throw new Error(result.sources.filter(source => source.state !== 'ready').map(source => source.message).filter(Boolean).join('；') || '部分素材来源暂时不可读取，请重试');
  return result.items.filter(item => item.scope !== 'shared');
}

/** Read-only inventory: selecting a product never starts analysis or generation. */
export function useSocialProductMaterials(productIds: string[], ready: boolean) {
  const identity = productionNavigationIdentity();
  const [inventory, setInventory] = useState<Material[]>([]);
  const [loadedIdentity, setLoadedIdentity] = useState('');
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [restored, setRestored] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => { setSelectedIds([]); setRestored(false); }, [identity]);
  useEffect(() => {
    let active = true;
    setInventory([]); setLoadedIdentity(''); setError('');
    void readSocialProductMaterialInventory().then(materials => {
      if (!active || identity !== productionNavigationIdentity()) return;
      setInventory(materials);
      setLoadedIdentity(identity);
    }).catch(cause => {
      if (active && identity === productionNavigationIdentity()) setError(cause instanceof Error ? cause.message : '产品素材读取失败');
    });
    return () => { active = false; };
  }, [identity, revision]);
  const clips = useMemo(() => loadedIdentity === identity ? inventory.map(materialToClip) : [], [inventory, loadedIdentity, identity]);
  const safeSelectedIds = useMemo(() => loadedIdentity === identity ? selectedIds : [], [loadedIdentity, identity, selectedIds]);
  const { resetSelectionBaseline } = useProductMaterialSelection({ productIds, materials: clips, selectedIds, setSelectedIds,
    enabled: ready && loadedIdentity === identity, resetKey: identity, preserveInitialSelection: restored });
  const candidates = useMemo(() => productMaterialCandidates({ productIds, materials: clips, selectedIds: [] }), [productIds, clips]);
  const selectedMaterials = useMemo(() => inventory.filter(item => safeSelectedIds.includes(item.id) && candidates.some(candidate => candidate.id === item.id)), [inventory, safeSelectedIds, candidates]);
  const restore = useCallback((spec: Record<string, unknown>) => {
    if (!Array.isArray(spec.selected)) return;
    resetSelectionBaseline();
    setSelectedIds(spec.selected.filter((id): id is string => typeof id === 'string'));
    setRestored(true);
  }, [resetSelectionBaseline]);
  const selectionSpec = useMemo(() => ({ selected: safeSelectedIds, materialSnapshots: selectedMaterials.map(materialToClip) }), [safeSelectedIds, selectedMaterials]);
  return { candidates, selectedIds: selectedMaterials.map(item => item.id), selectedMaterials, error,
    loading: loadedIdentity !== identity && !error, retry: () => setRevision(value => value + 1), restore,
    toggle: (id: string) => setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]),
    selectionSpec,
  };
}
