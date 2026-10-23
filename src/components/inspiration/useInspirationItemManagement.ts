import { useState } from 'react';
import { authHeader } from '../../lib/auth';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { studioApi, type Material } from '../../lib/studioApi';
import { type StateSetter } from './inspirationDashboardContracts';
import { materialOwnershipTags, visibleMaterialTags } from './inspirationMaterialLibrary';
import type { useInspirationDiscoveryInventory } from './useInspirationDiscoveryInventory';
import type { useInspirationMaterials } from './useInspirationMaterials';

interface Dependencies extends Pick<ReturnType<typeof useInspirationMaterials>, 'setMaterialProducts' | 'refreshMaterials' | 'setProductSummaryRefreshVersion' | 'productDetailProduct' | 'loadProductMaterialDetail' | 'setLocalMaterials' | 'setProductDetailMaterials' | 'materialPage'>, Pick<ReturnType<typeof useInspirationDiscoveryInventory>, 'setCrawledVideos' | 'setTenantVideoTotalItems' | 'refreshVideos'> {
  setMaterialMessage: StateSetter<string>;
}

export function useInspirationItemManagement({ setMaterialProducts, setCrawledVideos, refreshMaterials, setProductSummaryRefreshVersion, productDetailProduct, loadProductMaterialDetail, setMaterialMessage, setTenantVideoTotalItems, refreshVideos, setLocalMaterials, setProductDetailMaterials, materialPage }: Dependencies) {
  const [manageTarget, setManageTarget] = useState<(({ kind: 'video'; item: TrendVideo } | { kind: 'material'; item: Material }) & { action: 'edit' | 'delete' }) | null>(null);

  const [manageName, setManageName] = useState('');

  const [manageTags, setManageTags] = useState('');

  const [manageProductId, setManageProductId] = useState('');

  const [manageBusy, setManageBusy] = useState(false);

  const openManageDialog = (target: ({ kind: 'video'; item: TrendVideo } | { kind: 'material'; item: Material }) & { action?: 'edit' | 'delete' }) => {
    if (!target.item.canManage) return;
    setManageTarget({ ...target, action: target.action || 'edit' });
    setManageProductId(target.kind === 'material'
      ? target.item.productId || ''
      : '');
    if (target.kind === 'material') void studioApi.materialProducts().then(result => setMaterialProducts(result.items));
    setManageName(target.kind === 'video' ? target.item.title : target.item.name);
    setManageTags(target.kind === 'video' ? target.item.tags.join(', ') : visibleMaterialTags(target.item.tags));
  };

  const saveManagedItem = async () => {
    if (!manageTarget || !manageName.trim() || manageBusy) return;
    setManageBusy(true);
    try {
      if (manageTarget.kind === 'video') {
        const recordId = manageTarget.item.recordId;
        if (!recordId) throw new Error('视频记录不存在');
        const response = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}`, {
          method: 'PATCH',
          headers: { ...authHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: manageName.trim(), tags: manageTags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '编辑失败');
        setCrawledVideos(items => items.map(item => item.id === manageTarget.item.id
          ? { ...item, title: manageName.trim(), tags: manageTags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) }
          : item));
      } else {
        const result = await studioApi.updateMaterial(manageTarget.item.id, {
          name: manageName.trim(),
          tags: materialOwnershipTags(manageTags.trim(), manageProductId),
          productId: manageProductId,
          enterpriseCommon: !manageProductId,
        });
        if (!result.ok) throw new Error(result.error || '编辑失败');
        await refreshMaterials();
        setProductSummaryRefreshVersion(version => version + 1);
        if (productDetailProduct) await loadProductMaterialDetail(productDetailProduct);
      }
      setMaterialMessage('已保存修改');
      setManageTarget(null);
    } catch (error) {
      setMaterialMessage(error instanceof Error ? error.message : '编辑失败');
    } finally {
      setManageBusy(false);
    }
  };

  const deleteManagedItem = async () => {
    if (!manageTarget || manageBusy) return;
    setManageBusy(true);
    try {
      if (manageTarget.kind === 'video') {
        const recordId = manageTarget.item.recordId;
        if (!recordId) throw new Error('视频记录不存在');
        const response = await fetch(`/api/overseas/videos/${encodeURIComponent(recordId)}`, {
          method: 'DELETE',
          headers: authHeader(),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '删除失败');
        setCrawledVideos(items => items.filter(item => item.id !== manageTarget.item.id));
        setTenantVideoTotalItems(value => value === null ? null : Math.max(0, value - 1));
        // Re-read the authoritative tenant list so a deleted record cannot
        // linger in another page/count cache.
        await refreshVideos(1, true);
      } else {
        const result = await studioApi.deleteMaterial(manageTarget.item.id);
        if (!result.ok) throw new Error(result.error || '删除失败');
        setLocalMaterials(items => items.filter(item => item.id !== manageTarget.item.id));
        setProductDetailMaterials(items => items.filter(item => item.id !== manageTarget.item.id));
        await refreshMaterials(materialPage);
        setProductSummaryRefreshVersion(version => version + 1);
        if (productDetailProduct) await loadProductMaterialDetail(productDetailProduct);
        setMaterialMessage(result.retainedForProjectReferences ? '已从我的素材移除；制作项目中的既有引用仍保留' : '已删除');
      }
      if (manageTarget.kind === 'video') setMaterialMessage('已删除');
      setManageTarget(null);
    } catch (error) {
      setMaterialMessage(error instanceof Error ? error.message : '删除失败');
    } finally {
      setManageBusy(false);
    }
  };

  return {
    manageTarget,
    setManageTarget,
    manageName,
    setManageName,
    manageTags,
    setManageTags,
    manageProductId,
    setManageProductId,
    manageBusy,
    setManageBusy,

    openManageDialog,
    saveManagedItem,
    deleteManagedItem
  };
}
