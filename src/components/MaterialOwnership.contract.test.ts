import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { productMaterialLibraryParams } from './EnterprisePage.js';
import {
  materialMatchesProductFilter,
  materialOwnershipTags,
  materialSemanticLabel,
  parseMaterialLibraryEntry,
  visibleMaterialTags,
} from './InspirationDashboard.js';

assert.deepEqual(
  productMaterialLibraryParams({ id: 'product-stable-id', productId: 'legacy-id', sku: 'SKU-1', name: '精华液' }),
  { productId: 'product-stable-id', productRef: '精华液' },
  '企业知识跳转素材库时必须优先使用持久产品 ID，并同时携带可读产品名',
);

assert.equal(materialOwnershipTags('factory, closeup', ''), 'factory, closeup, enterprise_common', '企业通用素材必须保留可区分的归属标记');
assert.equal(materialOwnershipTags('factory, enterprise_common', 'product-1'), 'factory', '素材改绑具体产品后必须移除企业通用标记');
assert.equal(visibleMaterialTags('factory, enterprise_common'), 'factory', '内部归属标记不得泄露到用户编辑框');
assert.equal(materialSemanticLabel({ productName: '焕亮精华液' }), '产品：焕亮精华液', '已关联产品时素材卡必须优先显示产品名');
assert.equal(materialSemanticLabel({ tags: 'enterprise_common, 工厂灌装, 自动产线, 包装' }), '内容：工厂灌装 · 自动产线 · 包装', '通用素材必须展示最多三个可读内容关键词');
assert.equal(materialSemanticLabel({ visualObservations: ['滴管取液', '精华液质地特写'] }), '内容：滴管取液 · 精华液质地特写', '没有人工关键词时使用稳定视觉观察');
assert.equal(materialSemanticLabel({}), '内容：待补充说明', '无可靠语义时使用可理解的待补充提示');
assert.equal(materialMatchesProductFilter(
  { productId: 'product-2', productName: '同名面膜', tags: '' },
  { enabled: true, productId: 'product-1', productRef: '同名面膜' },
), false, '存在产品 ID 时不得按同名产品兜底，避免跨产品串素材');
assert.equal(materialMatchesProductFilter(
  { productId: '', productName: '同名面膜', tags: '' },
  { enabled: true, productId: 'product-1', productRef: '同名面膜' },
), true, '任务上传的兼容素材尚无稳定产品 ID 时，可用任务内保存的精确产品名关联');
assert.equal(materialMatchesProductFilter(
  { productId: '', productName: '', tags: 'enterprise_common' },
  { enabled: true, productId: '', productRef: '' },
), true, '企业通用筛选只接收明确标记为通用的素材');
assert.deepEqual(
  productMaterialLibraryParams({ sku: 'SKU-2', name: '面膜' }),
  { productId: 'SKU-2', productRef: '面膜' },
  '历史产品在持久 ID 回填前仍可用 SKU 过滤',
);

assert.deepEqual(
  parseMaterialLibraryEntry('?page=socialInspiration&view=library&productId=product-1&productRef=%E9%9D%A2%E8%86%9C'),
  { openLibrary: true, productId: 'product-1', productRef: '面膜' },
  '我的素材必须读取企业知识页传入的产品筛选参数',
);
assert.deepEqual(
  parseMaterialLibraryEntry('?page=socialInspiration'),
  { openLibrary: false, productId: '', productRef: '' },
);

const enterpriseSource = readFileSync(fileURLToPath(new URL('./EnterprisePage.tsx', import.meta.url)), 'utf8');
assert.match(enterpriseSource, /产品素材统一在“我的素材”管理/, '产品页必须明确告知唯一素材入口');
assert.match(enterpriseSource, /page: 'socialInspiration', view: 'library', \.\.\.params/, '产品页必须跳转到我的素材并携带筛选上下文');
assert.match(enterpriseSource, /searchParams\.set\('productId', params\.productId\)[^]*?searchParams\.set\('productRef', params\.productRef\)/, '产品筛选必须写入可刷新恢复的 URL');
assert.match(enterpriseSource, /history\.replaceState\(\{ \.\.\.window\.history\.state, productionDetail: detail \}/, '产品筛选必须同时保留在现有导航 history 状态');
assert.match(enterpriseSource, /上传资质凭证/, '企业知识页仍需保留事实凭证上传');
assert.doesNotMatch(enterpriseSource, /MAX_PRODUCT_ASSETS|实拍视频|产品主图|工厂实拍/, '企业知识页不得残留创作媒体编辑器');
assert.doesNotMatch(enterpriseSource, /accept=['"](?:image|video)\/\*/, '企业知识页不得再提供图片或视频创作素材上传');

const inspirationSource = readFileSync(fileURLToPath(new URL('./InspirationDashboard.tsx', import.meta.url)), 'utf8');
const studioRouteSource = readFileSync(fileURLToPath(new URL('../../server/routes/studio.ts', import.meta.url)), 'utf8');
assert.match(inspirationSource, /本次上传必须关联产品/, '上传必须关联具体产品');
assert.match(inspirationSource, /选择关联产品（必选）/, '产品素材上传必须明确强绑定要求');
assert.match(inspirationSource, /aria-label="本次上传素材归属"/, '紧凑上传入口仍必须有清晰的无障碍名称');
assert.match(inspirationSource, /innerView === 'library' && <Button[\s\S]{0,400}>上传素材<\/Button>/, '我的素材上传按钮必须位于页签工具栏右侧');
assert.doesNotMatch(inspirationSource, /id="material-upload-product"/, '我的素材主页面不得继续展示独立的上传产品选择行');
assert.match(inspirationSource, /aria-label="我的素材筛选"[^]*?MaterialTaxonomyFilters[^]*?aria-label="内容形式"[^]*?aria-controls="material-more-filters"/, '我的素材主工具栏应只保留来源、主题和内容形式三个筛选');
const materialMainFilters = inspirationSource.slice(inspirationSource.indexOf('aria-label="我的素材筛选"'), inspirationSource.indexOf('id="material-more-filters"'));
assert.doesNotMatch(materialMainFilters, /aria-label="素材收藏状态"/, '收藏状态不得继续占用我的素材主筛选位');
assert.match(inspirationSource, /id="material-more-filters"[^]*?aria-label="素材收藏状态"/, '收藏状态必须收进更多筛选');
assert.match(inspirationSource, /updateMaterial\(result\.material\.id,[^]*?productId: uploadProductId/, '前端 P0 上传后必须保存产品归属');
assert.match(inspirationSource, /material\.productId === filter\.productId/, '产品 ID 存在时必须按 ID 精确筛选');
assert.doesNotMatch(inspirationSource, /manageTarget\.kind === 'material' && manageProductId === null/, '旧素材未关联产品不得成为保存卡点');
assert.match(inspirationSource, /请先选择素材对应的产品；产品素材必须与产品表中的产品一一绑定。/, '未选择产品时必须阻止产生无法追溯的产品素材');
const taxonomySource = readFileSync(new URL('./material-library/MaterialTaxonomyFilters.tsx', import.meta.url), 'utf8');
assert.match(inspirationSource, /<MaterialTaxonomyFilters/, 'material library must use the current source/theme taxonomy');
assert.match(taxonomySource, /MATERIAL_SOURCE_LABELS/, 'source categories must come from the shared contract');
assert.match(taxonomySource, /MATERIAL_THEME_LABELS/, 'theme categories must come from the shared contract');
assert.match(taxonomySource, /<Select[^]*?aria-label="素材来源"[^]*?<Select[^]*?aria-label="主题标签"/, '来源与主题必须使用一致的 Select 筛选样式');
assert.doesNotMatch(inspirationSource, /系统已按创作主题整理素材|项可匹配|主题待确认/, '素材库不得残留旧主题卡片和派生主题标签');
assert.doesNotMatch(inspirationSource, /任务中上传的图片、视频和音频也会归入这里/, '上传入口不得再使用大段说明文字');
assert.match(inspirationSource, /<span className="text-xs font-bold">音频素材<\/span>/, '音频素材必须用专属占位画面识别，不得继续误标为图片');
assert.match(inspirationSource, /studioApi\.listMaterialLibrary\('all',/, '我的素材必须展示账号下可编辑素材和采集参考素材');
assert.doesNotMatch(inspirationSource, /enterMaterialSmartGeneration[\s\S]*?material\.usage === 'reference_only'/, '所有进入素材库的视觉素材都必须可以进入创作链路');
assert.doesNotMatch(inspirationSource, /pinnedMaterialVideos/, '素材库内容不得反向混入爆款视频列表');
assert.doesNotMatch(inspirationSource, /<MaterialAnalysisStatus material=\{material\}/, '我的素材卡片不得展示内部分析进度和区间标注');
assert.doesNotMatch(inspirationSource, /采集参考 · 仅供分析|参考素材 ≠ 可商用素材|产品归属待确认|点击智能分类/, '我的素材卡片不得展示内部用途、归属和分类标注');
assert.match(inspirationSource, /<LsMasonryGallery layout="grid" items=\{filteredMaterials\.map/, '我的素材必须复用完整媒体卡的齐行网格');
assert.match(inspirationSource, /title=\{materialSemanticLabel\(material\)\}>\{materialSemanticLabel\(material\)\}<\/p>/, '每张我的素材卡片必须显示产品名或主要内容关键词');
const materialCardSource = inspirationSource.slice(inspirationSource.indexOf('<LsMasonryGallery layout="grid" items={filteredMaterials.map'), inspirationSource.indexOf('aria-label="我的素材分页"'));
assert.doesNotMatch(materialCardSource, /visibleMaterialTags\(material\.tags\)|materialAssetBadge\(material\)/, '素材卡首页不得展示标签');
assert.match(inspirationSource, /aria-label="素材标签"[^]*?materialAssetBadge\(detailMaterial\)[^]*?visibleMaterialTags\(detailMaterial\.tags\)/, '素材标签必须集中展示在详情顶部');
assert.match(inspirationSource, /<Eye size=\{14\} \/>查看详情/, '每张素材卡必须提供查看详情入口');
assert.match(inspirationSource, /<Sparkles size=\{14\} \/>自由创作/, '每张素材卡必须提供自由创作入口');
assert.match(inspirationSource, /\{ key: 'library'[\s\S]{0,220}\{ key: 'accounts'/, '对标账号必须排列在我的素材之后');
assert.match(inspirationSource, /aria-label=\{`\$\{isFavoriteMaterial\(material\) \? '取消收藏' : '收藏'\} \$\{material\.name\}`\}/, '素材卡必须提供可持久化的收藏按钮');
assert.match(studioRouteSource, /function enterpriseProductMaterials[\s\S]{0,5000}sourceType: 'enterprise_product_table'/, '产品表图片必须自动投影到正式素材接口并保留来源');
assert.match(studioRouteSource, /enterpriseAssetStableId/, '产品表素材必须使用稳定 ID，保证周计划和制作工程引用同一条素材');
assert.match(studioRouteSource, /enterpriseProductMaterials\(tenantId, enterpriseProfile\)[\s\S]{0,500}inventory\.items/, '素材接口必须合并产品表素材与用户素材，而不是仅在前端伪造分类');

console.log('material ownership frontend contracts passed');
