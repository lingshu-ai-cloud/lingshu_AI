import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type RefObject } from 'react';
import { studioApi } from '../../lib/studioApi';
import { mediaType } from '../../lib/studioFileInputs';
import { clipAspectRatio } from './studioStoryboardMaterialMatching';
import { materialToClip, type Clip } from './studioSourceMaterial';
import { mergeClipLists } from './studioMaterialPresentation';
import { probeMedia, probeClipAspect } from './studioMediaProbes';
import type { StoryboardSourcePlan } from './studioWorkspaceContracts';

export interface StudioMaterialInventoryInput {
  contentMode: 'video' | 'poster';
  activeFolder: string;
  selectedProductIds: string[];
  storyboardAssignments: Record<string, string>;
  storyboardSourcePlans: Record<string, StoryboardSourcePlan>;
  onAppendUploaded: (ids: string[]) => void;
  onChooseFolder: (folder: string) => void;
  onNotice: (notice: string) => void;
}

interface InventoryState {
  materialRightsConfirmed: boolean;
  setMaterials: Dispatch<SetStateAction<Clip[]>>;
  setUploading: Dispatch<SetStateAction<boolean>>;
  materialSourceRefreshesRef: RefObject<Set<string>>;
}

/** One read/upload/recovery lifecycle; page selection remains a shared model. */
export function createStudioMaterialInventoryActions(input: StudioMaterialInventoryInput, state: InventoryState) {
  const { contentMode, activeFolder, selectedProductIds, storyboardAssignments, storyboardSourcePlans, onAppendUploaded,
    onChooseFolder: setActiveFolder, onNotice: setModeNotice } = input;
  const { materialRightsConfirmed, setMaterials, setUploading, materialSourceRefreshesRef } = state;

  const refreshMaterials = async () => {
    try {
      const real = await studioApi.listMaterials('all');
      const realClips = real.map(materialToClip);
      const boundIds = new Set([...Object.values(storyboardAssignments), ...Object.values(storyboardSourcePlans).map(plan => plan.generatedClipId).filter(Boolean)]);
      setMaterials(current => mergeClipLists(realClips, current.filter(item => boundIds.has(item.id) || item.sourceType === 'project-snapshot' || item.sourceType === 'historical-kickoff')));
      return realClips;
    } catch { return [] as Clip[]; /* retain the last inventory; MaterialLibraryStatus offers retry */ }
  };

  const refreshMaterialSource = async (materialId: string): Promise<Clip | undefined> => {
    if (materialSourceRefreshesRef.current.has(materialId)) return undefined;
    materialSourceRefreshesRef.current.add(materialId);
    try {
      const real = await studioApi.listMaterials();
      const refreshed = real.find(item => item.id === materialId);
      if (!refreshed) return undefined;
      const next = materialToClip(refreshed);
      setMaterials(current => current.map(item => item.id === materialId ? { ...item, url: next.url, poster: next.poster } : item));
      return next;
    } catch { return undefined; } finally {
      materialSourceRefreshesRef.current.delete(materialId);
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    if (contentMode === 'poster' && !materialRightsConfirmed) {
      setModeNotice('请先确认你拥有这些素材的商业使用、改编和 AI 处理授权，再上传用于生图。');
      return;
    }
    setUploading(true);
    const uploadedIds: string[] = [];
    const uploadErrors: string[] = [];
    const targetFolder = activeFolder && !['all', 'hot', 'recommend'].includes(activeFolder) ? activeFolder : 'upload';
    for (const f of Array.from(files)) {
      try {
        const media = await probeMedia(f);
        const { material, ok, error } = await studioApi.uploadMaterialFile(f, {
          folder: targetFolder,
          type: mediaType(f),
          duration: media.duration,
          width: media.width,
          height: media.height,
          rightsConfirmed: contentMode === 'poster' && materialRightsConfirmed,
          productId: contentMode === 'poster'
            && ['product', 'packaging'].includes(targetFolder)
            && selectedProductIds.length === 1 ? selectedProductIds[0] : undefined,
        });
        if (!ok || !material?.id) throw new Error(error || `「${f.name}」上传失败`);
        if (material?.id) uploadedIds.push(material.id);
      } catch (error) {
        uploadErrors.push(error instanceof Error ? error.message : `「${f.name}」上传失败`);
      }
    }
    await refreshMaterials();
    if (uploadedIds.length) {
      onAppendUploaded(uploadedIds);  // 上传完自动选中
      setActiveFolder(targetFolder);
    }
    if (uploadErrors.length) setModeNotice(uploadErrors[0]);
    setUploading(false);
  };

  return { refreshMaterials, refreshMaterialSource, handleUpload };
}

export function useStudioMaterialInventory(input: StudioMaterialInventoryInput) {
  const [materials, setMaterials] = useState<Clip[]>([]);
  const [previewClip, setPreviewClip] = useState<Clip | null>(null);
  const [uploading, setUploading] = useState(false);
  const [materialRightsConfirmed, setMaterialRightsConfirmed] = useState(false);
  const materialSourceRefreshesRef = useRef(new Set<string>());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const actions = createStudioMaterialInventoryActions(input, {
    materialRightsConfirmed, setMaterials, setUploading, materialSourceRefreshesRef,
  });
  return { materials, setMaterials, previewClip, setPreviewClip, uploading, materialRightsConfirmed,
    setMaterialRightsConfirmed, fileInputRef, ...actions };
}

export function useStudioMaterialInventoryLoad(inventory: Pick<ReturnType<typeof useStudioMaterialInventory>, 'refreshMaterials'>) {
  const { refreshMaterials } = inventory;
  useEffect(() => { void refreshMaterials(); }, []);
}

export function useStudioMaterialInventoryDimensions(inventory: Pick<ReturnType<typeof useStudioMaterialInventory>, 'materials' | 'setMaterials'>) {
  const { materials, setMaterials } = inventory;
  useEffect(() => {
    const missing = materials.filter(item => item.type !== 'audio' && !clipAspectRatio(item) && (item.url || item.poster));
    if (!missing.length) return;
    let cancelled = false;
    void Promise.all(missing.map(async item => ({ id: item.id, ...(await probeClipAspect(item)) }))).then(results => {
      if (cancelled) return;
      const dimensions = new Map(results.filter(item => item.width > 0 && item.height > 0).map(item => [item.id, item]));
      if (!dimensions.size) return;
      setMaterials(current => current.map(item => {
        const found = dimensions.get(item.id);
        return found ? { ...item, width: found.width, height: found.height, aspectRatio: found.width / found.height } : item;
      }));
    });
    return () => { cancelled = true; };
  }, [materials]);
}
