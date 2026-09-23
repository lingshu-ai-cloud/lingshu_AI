import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { productMaterialLibraryParams } from './EnterprisePage.js';
import {
  materialMatchesProductFilter,
  materialOwnershipTags,
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
assert.match(inspirationSource, /本次上传归属（必选）/, '上传前必须明确素材归属');
assert.match(inspirationSource, /请选择产品或企业通用/, '上传和编辑都必须提供未选择占位状态');
assert.match(inspirationSource, /aria-label="本次上传素材归属"/, '紧凑上传入口仍必须有清晰的无障碍名称');
assert.match(inspirationSource, /updateMaterial\(result\.material\.id,[^]*?productId: uploadProductId/, '前端 P0 上传后必须保存产品归属');
assert.match(inspirationSource, /material\.productId === filter\.productId/, '产品 ID 存在时必须按 ID 精确筛选');
assert.match(inspirationSource, /manageTarget\.kind === 'material' && manageProductId === null/, '旧素材未确认产品归属时必须禁用保存');
assert.doesNotMatch(inspirationSource, /通用素材 \/ 未关联产品/, '企业通用与未确认归属不得再混成一个选项');
assert.doesNotMatch(inspirationSource, /系统已按创作主题整理素材|项可匹配|主题待确认/, '素材库不得残留旧主题卡片和派生主题标签');
assert.doesNotMatch(inspirationSource, /任务中上传的图片、视频和音频也会归入这里/, '上传入口不得再使用大段说明文字');
assert.match(inspirationSource, /material\.type === 'audio' \? '音频'/, '音频素材不得继续误标为图片');

console.log('material ownership frontend contracts passed');
