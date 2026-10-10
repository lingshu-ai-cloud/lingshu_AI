import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./InspirationDashboard.tsx', import.meta.url), 'utf8');
const libraryStart = source.indexOf("{innerView === 'library'");
const libraryEnd = source.indexOf("{previewMaterial?.type === 'video'", libraryStart);
const librarySource = source.slice(libraryStart, libraryEnd);
const materialGridIndex = librarySource.indexOf('<LsMasonryGallery layout="grid" items={filteredMaterials.map');
const paginationIndex = librarySource.indexOf('aria-label="我的素材分页"');

assert.match(source, /const MATERIAL_LIBRARY_PAGE_SIZE = 20;/, '我的素材每页应限制为 20 条，避免单页过长');
assert.match(source, /page, pageSize: MATERIAL_LIBRARY_PAGE_SIZE,/, '素材接口请求必须复用统一分页数量');
assert.ok(materialGridIndex >= 0, '应使用统一的齐行媒体卡片网格');
assert.ok(paginationIndex > materialGridIndex, '我的素材分页必须位于素材网格底部');
assert.match(librarySource, /<Pagination[\s\S]*?pageSize=\{MATERIAL_LIBRARY_PAGE_SIZE\}[\s\S]*?showSizeChanger=\{false\}/, '素材分页应复用 Ant Design Pagination');

console.log('Inspiration material pagination contract passed');
