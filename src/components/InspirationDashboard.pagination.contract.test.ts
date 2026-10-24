import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./InspirationDashboard.tsx', import.meta.url), 'utf8')
  + readFileSync(new URL('./inspiration/inspirationDashboardContracts.ts', import.meta.url), 'utf8')
  + readFileSync(new URL('./inspiration/useInspirationMaterials.ts', import.meta.url), 'utf8')
  + readFileSync(new URL('./inspiration/InspirationMaterialGallery.tsx', import.meta.url), 'utf8');
const inventorySource = readFileSync(new URL('./inspiration/inspirationProductMaterialInventory.ts', import.meta.url), 'utf8');
const inventoryHookSource = readFileSync(new URL('./inspiration/useInspirationMaterialInventory.ts', import.meta.url), 'utf8');
const gallerySource = readFileSync(new URL('./inspiration/inspirationMaterialGalleryProjection.ts', import.meta.url), 'utf8');
const librarySource = readFileSync(new URL('./inspiration/InspirationMaterialGallery.tsx', import.meta.url), 'utf8');
const materialGridIndex = librarySource.indexOf('<LsMasonryGallery layout="masonry" items={pagedUngroupedFilteredMaterials.map');
const paginationIndex = librarySource.indexOf('aria-label="普通素材分页"');

assert.match(source, /const MATERIAL_LIBRARY_PAGE_SIZE = 20;/, '我的素材每页应限制为 20 条，避免单页过长');
assert.match(inventorySource, /const MATERIAL_LIBRARY_FETCH_PAGE_SIZE = 100;/, '素材库存读取每页应有明确上限');
assert.match(source, /useInspirationMaterialInventory\(\{ innerView, materialSource, materialTheme, materialProducts \}\)/, '页面必须使用共用库存生命周期');
assert.match(inventoryHookSource, /import \{ MATERIAL_LIBRARY_FETCH_PAGE_SIZE, fetchCompleteProductMaterialInventory/, '库存与按产品读取必须复用同一分页上限');
assert.doesNotMatch(inventoryHookSource, /fetchProductMaterialSummaries/, '产品摘要应从共用库存派生，不能再次全量请求');
assert.match(source, /projectMaterialGallery\(\{[\s\S]*?page: materialPage,[\s\S]*?pageSize: MATERIAL_LIBRARY_PAGE_SIZE/, '页面必须把当前页和固定页大小交给完整素材投影');
assert.match(gallerySource, /const ungrouped = filteredMaterials\.filter[\s\S]*?ungrouped\.slice\(offset, offset \+ pageSize\)/, '普通素材应在完整筛选后统一分页');
assert.match(gallerySource, /visibleProductGroupsForPage = page === 1 \? visibleProductGroups : \[\]/, '产品集合卡不得在普通素材后续页重复');
assert.ok(materialGridIndex >= 0, '应使用适配真实媒体比例的瀑布流');
assert.ok(paginationIndex > materialGridIndex, '我的素材分页必须位于素材网格底部');
assert.match(librarySource, /<Pagination[\s\S]*?total=\{ordinaryFilteredTotal\}[\s\S]*?pageSize=\{MATERIAL_LIBRARY_PAGE_SIZE\}[\s\S]*?onChange=\{setMaterialPage\}/, '普通素材分页总量必须与筛选后集合一致');

console.log('Inspiration material pagination contract passed');
