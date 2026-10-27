import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Material } from '../../lib/studioApi.js';
import {
  materialBelongsToKnownProduct,
  materialHasAuthoritativeAspectRatio,
  materialIntrinsicAspectRatio,
  materialMatchesProduct,
  neutralProductSceneLabel,
  productSceneSlotHasReadyMaterial,
} from './ProductMaterialGroup.js';

const componentSource = readFileSync(new URL('./ProductMaterialGroup.tsx', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../InspirationDashboard.tsx', import.meta.url), 'utf8')
  + readFileSync(new URL('../inspiration/useInspirationMaterials.ts', import.meta.url), 'utf8')
  + readFileSync(new URL('../inspiration/InspirationMaterialGallery.tsx', import.meta.url), 'utf8');
const inventorySource = readFileSync(new URL('../inspiration/inspirationProductMaterialInventory.ts', import.meta.url), 'utf8');
const inventoryHookSource = readFileSync(new URL('../inspiration/useInspirationMaterialInventory.ts', import.meta.url), 'utf8');

const products = [
  { id: 'product-1', name: '云朵泡沫卸妆蜜' },
  { id: 'product-2', name: '紫苏控油洁面' },
];

function material(overrides: Partial<Material> = {}): Material {
  return {
    id: 'material-1',
    name: '产品素材',
    folder: 'social',
    type: 'image',
    duration: 0,
    size: '',
    file: '',
    url: '/media/product.png',
    createdAt: '',
    ...overrides,
  };
}

test('产品素材按稳定产品身份归组，企业通用素材保持独立', () => {
  assert.equal(materialMatchesProduct(material({ productId: 'product-1' }), products[0]), true);
  assert.equal(materialMatchesProduct(material({ productId: 'product-2', productName: products[0].name }), products[0]), false, '已有产品 ID 时不得用旧名称串组');
  assert.equal(materialMatchesProduct(material({ productName: products[0].name }), products[0]), true, '兼容尚未补齐 ID 的历史素材');
  assert.equal(materialBelongsToKnownProduct(material(), products), false);
  assert.equal(materialBelongsToKnownProduct(material({ productId: 'product-1' }), products), true);
});

test('预制场景只用中性序号，不向前端暴露具体画面分类', () => {
  assert.deepEqual([0, 1, 2].map(neutralProductSceneLabel), ['预制场景 1', '预制场景 2', '预制场景 3']);
  assert.doesNotMatch(componentSource, /货架|流水线|堆叠在地面|具体画面/);
  assert.match(componentSource, /neutralProductSceneLabel\(index\)/);
});

test('预制场景上传只限制视频类型，不把建议时长当作就绪门槛', () => {
  assert.equal(productSceneSlotHasReadyMaterial({
    status: 'ready',
    materialId: 'material-video',
    materialUrl: '/media/product-scene.mp4',
    actualDurationSeconds: 12,
    targetDurationSeconds: { min: 2, max: 3 },
  } as never), true, '超出建议时长的视频仍应正常显示为已入库');
  assert.equal(productSceneSlotHasReadyMaterial({
    status: 'ready',
    materialId: 'material-video',
    materialUrl: '',
    actualDurationSeconds: 2.5,
    targetDurationSeconds: { min: 2, max: 3 },
  } as never), false, '没有可用文件地址不能误报已入库');
  const uploadFlowSource = dashboardSource.slice(dashboardSource.indexOf('const handleUploadMaterials'), dashboardSource.indexOf('const requestMaterialUpload'));
  assert.match(uploadFlowSource, /uploadProductSceneKind && type !== 'video'/, '预制场景仍应只接受视频');
  assert.match(uploadFlowSource, /studioMaterialFileKind\(file\)/, '文件 MIME 为空时必须按后缀识别 MOV、MP4 与 WebM');
  assert.match(uploadFlowSource, /if \(uploadProductSceneKind\) continue;[\s\S]*?studioApi\.updateMaterial/, '预制场景由上传接口原子绑定，不得因多余的二次保存误报上传失败');
  assert.doesNotMatch(uploadFlowSource, /probeShootingVideo|duration < 2|duration > 3|2–3 秒/, '预制场景上传不得再做时长探测或硬限制');
  assert.doesNotMatch(dashboardSource, /请选择 2–3 秒视频|仅支持上传 2–3 秒视频/, '上传弹窗与错误文案不得继续展示硬时长要求');
});

test('我的素材只渲染一个产品集合卡，详情从右侧展开完整库存', () => {
  assert.doesNotMatch(dashboardSource, /ProductScenePreparationBoard/);
  const gallerySource = readFileSync(new URL('../inspiration/inspirationMaterialGalleryProjection.ts', import.meta.url), 'utf8');
  assert.match(dashboardSource, /projectMaterialGallery\(\{/, '产品卡必须由共用素材列表投影提供');
  assert.match(gallerySource, /visibleProductGroupsForPage = page === 1 \? visibleProductGroups : \[\]/, '产品卡只在普通素材首页出现，不随分页重复');
  assert.match(dashboardSource, /visibleProductGroupsForPage\.map\(product/);
  assert.match(dashboardSource, /id: `product-\$\{product\.id\}`/);
  assert.match(dashboardSource, /pagedUngroupedFilteredMaterials/);
  assert.match(inventoryHookSource, /excludeProductAssociated: true, page, pageSize: MATERIAL_LIBRARY_PAGE_SIZE/, '主墙只请求当前普通素材页，产品详情另行精确读取');
  assert.match(dashboardSource, /useInspirationMaterialInventory\(\{ innerView, materialSource, materialTheme, materialProducts \}\)/, '页面必须调用迁出的库存生命周期');
  assert.match(inventoryHookSource, /import \{ MATERIAL_LIBRARY_FETCH_PAGE_SIZE, fetchCompleteProductMaterialInventory/, '库存生命周期必须复用完整库存读取');
  assert.match(inventorySource, /fetchCompleteProductMaterialInventory[\s\S]*?productId: product\.id[\s\S]*?pageSize: MATERIAL_LIBRARY_FETCH_PAGE_SIZE/, '产品摘要与侧边详情必须按稳定产品 ID 精确读取完整素材');
  assert.match(inventoryHookSource, /Object\.fromEntries\(materialProducts\.map[\s\S]*?localMaterials\.filter\(material => materialMatchesProduct\(material, product\)\)/, '主墙产品摘要复用已读取的素材，不得按产品 N+1 请求');
  assert.match(inventorySource, /for \(let page = 2; page <= pageCount; page \+= 1\)/, '批量摘要应受控地逐页读取，避免并发风暴');
  assert.match(gallerySource, /summary\.materials\.some\(material => materialMatchesLibraryFilters\(material, productFilters\)\)/, '产品卡必须使用真实详情素材响应筛选');
  assert.match(componentSource, /<Drawer[\s\S]*?placement="right"/);
  assert.match(componentSource, /产品素材集合/);
  assert.match(componentSource, /onRetry: \(product: ProductMaterialGroupProduct\)[\s\S]*?重新加载/, '抽屉读取失败必须可重试');
  for (const action of ['onEditMaterial', 'onDeleteMaterial', 'onToggleFavoriteMaterial', 'onOpenMaterialDetail', 'onCreateFromMaterial']) {
    assert.match(componentSource, new RegExp(action), `产品详情素材必须保留 ${action} 操作`);
  }
});

test('素材与产品卡使用瀑布流和真实比例，不再固定 9:16', () => {
  assert.equal(materialIntrinsicAspectRatio(material({ width: 1920, height: 1080 })), 16 / 9);
  assert.equal(materialIntrinsicAspectRatio(material({ aspectRatio: 0.8, width: 1920, height: 1080 })), 16 / 9, '视频宽高必须优先于历史比例字段');
  assert.equal(materialIntrinsicAspectRatio(material({ aspectRatio: 0.8 })), 0.8);
  assert.equal(materialIntrinsicAspectRatio(material()), 1);
  assert.equal(materialHasAuthoritativeAspectRatio(material({ aspectRatio: 0.8 })), true);
  assert.match(componentSource, /posterMustNotOverrideVideo[^]*?material\?\.type === 'video'[^]*?mediaSource === 'image'[^]*?materialHasAuthoritativeAspectRatio\(material\)/, '产品视频封面不得覆盖权威视频比例');
  assert.match(componentSource, /onLoadedMetadata=\{event => updateRatio\(event\.currentTarget\.videoWidth, event\.currentTarget\.videoHeight, 'video'\)\}/, '无封面视频必须以视频元数据校正比例');
  assert.match(dashboardSource, /<LsMasonryGallery layout="masonry" items=\{visibleProductGroupsForPage\.map/);
  assert.match(dashboardSource, /<LsMasonryGallery layout="masonry" items=\{pagedUngroupedFilteredMaterials\.map/);
  assert.match(componentSource, /<LsMasonryGallery[\s\S]*?layout="masonry"/);
  assert.match(componentSource, /columns=\{\{ xs: 1, sm: 2, md: 2, lg: 3, xl: 3, xxl: 3 \}\}/, '抽屉内容应限制在 2–3 列');
  assert.doesNotMatch(componentSource, /aspect-\[9\/16\]/);
  assert.doesNotMatch(dashboardSource.slice(dashboardSource.indexOf("innerView === 'library'")), /aspect-\[9\/16\]/);
});
