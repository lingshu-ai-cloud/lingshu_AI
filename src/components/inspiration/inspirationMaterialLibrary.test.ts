import assert from 'node:assert/strict';
import test from 'node:test';
import type { Material } from '../../lib/studioApi';
import {
  isEnterpriseCommonMaterial,
  materialMatchesLibraryFilters,
  materialMatchesOrientation,
  materialMatchesProductFilter,
  materialOwnershipTags,
  materialSemanticLabel,
  parseMaterialLibraryEntry,
  resolveLinkedFavoriteMaterialId,
  visibleMaterialTags,
  type MaterialGalleryFilterSnapshot,
} from './inspirationMaterialLibrary';

test('material ownership tag is internal and product filtering stays explicit', () => {
  assert.equal(materialOwnershipTags('工厂, enterprise_common', 'product-1'), '工厂');
  assert.equal(materialOwnershipTags('工厂', ''), '工厂, enterprise_common');
  assert.equal(visibleMaterialTags('工厂,enterprise_common'), '工厂');
  assert.equal(isEnterpriseCommonMaterial({ tags: '工厂,enterprise_common' }), true);
  assert.equal(materialMatchesProductFilter({ productId: '', productName: '', tags: 'enterprise_common' }, { enabled: true, productId: '', productRef: '' }), true);
  assert.equal(materialMatchesProductFilter({ productId: 'other', productName: '其他产品', tags: '' }, { enabled: true, productId: 'product-1', productRef: '本产品' }), false);
});

test('material gallery applies semantic, product and orientation evidence without exposing internal IDs', () => {
  const material = {
    id: 'material-1', name: '工厂包装', type: 'video', tags: '工厂,enterprise_common',
    productName: '', sourceType: 'local_upload', width: 1080, height: 1920,
    scriptAnalysis: { searchableText: '车间包装', directorIndex: { subjects: ['包装产品'] } },
  } as unknown as Material;
  const filters: MaterialGalleryFilterSnapshot = {
    query: '包装', assetTab: 'all', type: 'video', industry: 'all', shotFunction: 'all',
    applicability: 'all', orientation: 'vertical', source: 'all', theme: 'all', favorite: 'all',
  };
  assert.equal(materialSemanticLabel(material), '内容：工厂');
  assert.equal(materialMatchesOrientation(material, 'vertical'), true);
  assert.equal(materialMatchesLibraryFilters(material, filters), true);
  assert.equal(materialMatchesLibraryFilters(material, { ...filters, orientation: 'horizontal' }), false);
  assert.equal(materialMatchesLibraryFilters(material, { ...filters, query: '不存在' }), false);
  assert.equal(resolveLinkedFavoriteMaterialId({ sourceUrl: 'https://example.com/post' }, [{ id: 'saved-1', sourceUrl: 'https://example.com/post' }]), 'saved-1');
  assert.deepEqual(parseMaterialLibraryEntry('?view=library&productId=product-1&productRef=%E5%8C%85%E8%A3%85'), { openLibrary: true, productId: 'product-1', productRef: '包装' });
});
