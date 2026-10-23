import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Material } from '../lib/studioApi.js';
import {
  canProcessVideo,
  displayDuration,
  isDisplayableVideoAnalysis,
  materialMatchesLibraryFilters,
  materialMatchesOrientation,
  materialSemanticLabel,
  resolveLinkedFavoriteMaterialId,
  resultEmptyState,
  trendFromEvidence,
} from './InspirationDashboard.js';

assert.equal(trendFromEvidence({}), 'stable', '已分析不等于热门，无证据时应保持平稳');
assert.equal(trendFromEvidence({ publicBaseline: { sampleSize: 8, medianWeightedEngagement: 1, currentWeightedEngagement: 3, relativeMultiple: 3.2, status: 'usable', method: 'test' } }), 'hot');
assert.equal(trendFromEvidence({ relativeViewMultiple: 1.7 }), 'rising');
assert.equal(trendFromEvidence({ relativeViewMultiple: 0.8 }), 'stable');

assert.equal(displayDuration(0), '时长未知');
assert.equal(displayDuration(Number.NaN), '时长未知');
assert.equal(displayDuration(125), '2:05');
assert.equal(canProcessVideo({ contentFormat: 'video', duration: 0 }), false);
assert.equal(canProcessVideo({ contentFormat: 'video', duration: 12 }), true);
assert.equal(canProcessVideo({ contentFormat: 'image', duration: 0 }), true);
assert.equal(materialSemanticLabel({
  productName: '',
  tags: '',
  visualObservations: ['产品特写'],
  // Historical material records may have analysis without a director index.
  scriptAnalysis: { status: 'ready' } as never,
}), '内容：产品特写');

const filterableProductMaterial = {
  id: 'product-material-1', name: '紫苏洁面展示', folder: 'social', type: 'video', duration: 3,
  size: '', file: '', url: '/media/product.mp4', createdAt: '', pinned: true,
  sourceCategory: 'local_upload', primaryTheme: 'product', themeTags: ['product'],
  industry: 'beauty_skincare', shotFunction: 'product_demo', applicability: 'industry_specific', tags: '横屏',
} as unknown as Material;
const defaultMaterialFilters = {
  query: '', assetTab: 'all', type: 'all', industry: 'all', shotFunction: 'all', applicability: 'all',
  orientation: 'all', source: 'all', theme: 'all', favorite: 'all',
} as const;
assert.equal(materialMatchesLibraryFilters(filterableProductMaterial, { ...defaultMaterialFilters, query: '洁面' }), true, '产品摘要应按关联素材名搜索');
assert.equal(materialMatchesLibraryFilters(filterableProductMaterial, { ...defaultMaterialFilters, type: 'image' }), false, '产品摘要不得在类型不匹配时假命中');
assert.equal(materialMatchesLibraryFilters(filterableProductMaterial, { ...defaultMaterialFilters, source: 'local_upload', favorite: 'favorite' }), true, '产品摘要应响应来源与收藏筛选');
assert.equal(materialMatchesOrientation({ ...filterableProductMaterial, width: 1920, height: 1080, aspectRatio: 9 / 16, tags: '竖屏' } as never, 'horizontal'), true, '画面方向必须优先使用权威宽高');
assert.equal(materialMatchesOrientation({ ...filterableProductMaterial, width: 1920, height: 1080, tags: '竖屏' } as never, 'vertical'), false, '标签不得覆盖权威宽高');
assert.equal(materialMatchesOrientation({ ...filterableProductMaterial, width: undefined, height: undefined, aspectRatio: 9 / 16, tags: '横屏' } as never, 'vertical'), true, '缺少宽高时必须使用持久化比例');
assert.equal(materialMatchesOrientation({ ...filterableProductMaterial, width: undefined, height: undefined, aspectRatio: undefined, tags: '竖屏' } as never, 'vertical'), true, '仅在无权威比例时才允许标签兜底');

assert.equal(resultEmptyState(0, '', false), 'no-data');
assert.equal(resultEmptyState(12, 'not-found', false), 'no-match');
assert.equal(resultEmptyState(12, '', true), 'no-match');
assert.equal(resolveLinkedFavoriteMaterialId({ aiAnalysis: { materialId: 'stale-material' }, sourceUrl: 'https://example.com/video' } as never, []), '', '历史分析素材 ID 不得直接拿去修改收藏状态');
assert.equal(resolveLinkedFavoriteMaterialId({ aiAnalysis: { materialId: 'material-1' }, sourceUrl: '' } as never, [{ id: 'material-1', sourceUrl: '' }]), 'material-1', '只有当前素材库真实存在的记录才允许切换收藏');
assert.equal(resolveLinkedFavoriteMaterialId({ aiAnalysis: { materialId: 'stale-material' }, sourceUrl: ' https://example.com/video ' } as never, [{ id: 'material-2', sourceUrl: 'https://example.com/video' }]), 'material-2', '失效 ID 应按来源关联当前素材');
assert.equal(resolveLinkedFavoriteMaterialId({ aiAnalysis: { materialId: 'material-1' }, sourceUrl: 'https://example.com/video' } as never, [{ id: 'material-2', sourceUrl: 'https://example.com/video' }, { id: 'material-1', sourceUrl: '' }]), 'material-1', '有效的精确素材 ID 优先于同来源记录');
assert.equal(resolveLinkedFavoriteMaterialId({ sourceUrl: ' ' }, [{ id: 'unrelated', sourceUrl: '' }]), '', '空来源不能误关联其他素材');
assert.equal(isDisplayableVideoAnalysis({
  usage: 'reference_only',
  contentSha256: 'sha256',
  userVisible: true,
  geminiStatus: 'video_failed',
  analysisError: 'exact_analysis_stalled',
}, 'analyzed'), true, '精准分析失败的手动对标视频必须留在爆款库供查看和重试');
assert.equal(isDisplayableVideoAnalysis({ geminiStatus: 'video_failed' }, 'analyzed'), false, '普通采集视频仍遵守失败隐藏规则');

const componentSource = readFileSync(fileURLToPath(new URL('./InspirationDashboard.tsx', import.meta.url)), 'utf8')
  + readFileSync(new URL('./inspiration/useInspirationCreation.ts', import.meta.url), 'utf8')
  + readFileSync(new URL('./inspiration/useInspirationMaterials.ts', import.meta.url), 'utf8')
  + readFileSync(new URL('./inspiration/useInspirationDiscoveryInventory.ts', import.meta.url), 'utf8')
  + readFileSync(new URL('./inspiration/inspirationDashboardContracts.ts', import.meta.url), 'utf8')
  + readFileSync(new URL('./inspiration/InspirationMaterialGallery.tsx', import.meta.url), 'utf8');
const materialCardSource = readFileSync(fileURLToPath(new URL('./inspiration/MaterialLibraryCardMedia.tsx', import.meta.url)), 'utf8');
const detailSource = readFileSync(fileURLToPath(new URL('./inspiration/DirectorVideoDetailPanel.tsx', import.meta.url)), 'utf8');
const videoCardSource = readFileSync(fileURLToPath(new URL('./InspirationVideoCards.tsx', import.meta.url)), 'utf8');
const videoResultsSource = readFileSync(fileURLToPath(new URL('./inspiration/InspirationVideoResults.tsx', import.meta.url)), 'utf8');
assert.match(materialCardSource, /aria-label={`播放 \${material\.name}`}[^]*?event\.stopPropagation\(\); onPlay\(\);[^]*?z-20/, '播放按钮应稳定置于 hover 操作层之上');
assert.match(componentSource, /onPlay=\{\(\) => setPreviewMaterial\(material\)\}/, '播放按钮只打开预览');
assert.match(componentSource, /contentFormat: isImageMaterial \? 'image' : 'video'/, '图片素材进入工作流时必须保留图片类型，不能伪装成视频');
assert.match(componentSource, /disabled=\{!canCreateFromLibraryMaterial\(material\)\}[^]*?<Sparkles[^]*?自由创作/, '素材卡必须用共用门禁拦截音频、无有效时长的视频及无可用来源的素材');
assert.match(componentSource, /refreshMaterialPreviewUrl[^]*?重新获取播放地址/, '素材预览失败后必须能刷新短期播放地址并重试');
const previewRefreshSource = componentSource.slice(componentSource.indexOf('const refreshMaterialPreviewUrl'), componentSource.indexOf('const handleMaterialPreviewError'));
assert.match(previewRefreshSource, /const previewProductId = String\(current\.productId[^]*?if \(previewProductId\)[^]*?fetchCompleteProductMaterialInventory\(product\)/, '产品视频预览失败必须按 productId 精确刷新详情库存');
assert.doesNotMatch(previewRefreshSource, /excludeProductAssociated/, '产品视频预览刷新不得误走排除产品素材的主墙查询');
assert.match(materialCardSource, /aria-label={`编辑 \${material\.name}`}[^]*?aria-label={`删除 \${material\.name}`}/, '每条可管理素材必须固定提供编辑与删除入口');
assert.match(componentSource, /INSPIRATION_PAGE_SIZE = 100/, '灵感列表必须一次读取当前租户的全部常规库存，避免分页后前端过滤造成假缺失');
assert.match(componentSource, /inventory-summary[^]*?setTenantVideoTotalItems/, '首屏必须独立优先读取真实库存量');
assert.match(componentSource, /setTenantVideoTotalItems\(Math\.max\(0, Number\(result\.totalItems \?\? 0\)\)\)/, '列表加载后 Tab 数量必须使用服务端完整可见结果数，不能用当前页长度覆盖');
assert.match(componentSource, /<InspirationVideoResults[^]*?loaded=\{videosLoaded\}[^]*?loading=\{videosLoading\}/, '页面必须向结果视图传入真实加载状态');
assert.match(videoResultsSource, /!loaded && loading \?[^]*?正在读取真实视频库存/, '首次列表请求完成前必须显示加载动画，不能先显示空状态');
assert.match(componentSource, /<InspirationVideoResults[^]*?pageSize=\{INSPIRATION_PAGE_SIZE\}[^]*?onPageChange=\{page => void refreshVideos\(page\)\}/, '页面必须维持固定页大小的服务端分页');
assert.match(videoResultsSource, /<Pagination current=\{page\}[^]*?pageSize=\{pageSize\}[^]*?showSizeChanger=\{false\}[^]*?onChange=\{onPageChange\}/, '结果视图必须展示服务端分页');
assert.doesNotMatch(componentSource, />\s*加载更多\s*</, '灵感列表不再使用追加式“加载更多”');
assert.doesNotMatch(componentSource, /本页近 3 日新入库|当前显示 <strong/, '灵感中心不应再显示与真实结果集口径冲突的独立统计条');
assert.match(videoResultsSource, /<LsMasonryGallery layout="masonry"/, '爆款灵感必须使用真实比例瀑布流');
assert.match(componentSource, /<LsMasonryGallery layout="masonry"/, '我的素材必须使用真实比例瀑布流');
assert.match(videoCardSource, /style=\{\{ background: 'var\(--color-surface-2\)', aspectRatio: mediaAspectRatio > 0 \? mediaAspectRatio : 9 \/ 16 \}\}/, '爆款卡媒体区必须优先使用真实媒体比例并保留稳定占位');
assert.doesNotMatch(videoCardSource, /aspect-\[9\/16\]/, '爆款卡不得把横版素材强制裁成 9:16');
assert.doesNotMatch(videoCardSource, /min-h-52/, '爆款瀑布流卡不得强制内容区等高留白');
assert.doesNotMatch(videoCardSource, /<div role="button"/, '爆款卡媒体不得使用包含收藏按钮的伪按钮容器');
assert.match(videoCardSource, /<button[\s\S]*?aria-label=\{`\$\{isImagePost \? '查看图文' : '播放视频'\} \$\{video\.title\}`\}[\s\S]*?onClick=\{onWatch\}/, '媒体预览应使用独立真实 button');
assert.match(videoCardSource, /videoAspectRatioLockedRef\.current = true;[^]*?setMediaAspectRatio\(metadata\.width \/ metadata\.height\)/, '爆款视频元数据必须锁定真实视频比例');
assert.match(videoCardSource, /onNaturalAspectRatio=\{ratio => \{[^]*?!videoAspectRatioLockedRef\.current[^]*?setMediaAspectRatio\(ratio\)/, '缩略图后到时不得覆盖已锁定的视频比例');
const materialGridSource = componentSource.slice(componentSource.indexOf('<LsMasonryGallery layout="masonry" items={pagedUngroupedFilteredMaterials.map'), componentSource.indexOf('aria-label="普通素材分页"'));
assert.match(componentSource, /import \{ MaterialLibraryCardMedia \} from '.\/MaterialLibraryCardMedia'/);
assert.match(materialCardSource, /function MaterialLibraryCardMedia[^]*?useState\(\(\) => materialIntrinsicAspectRatio\(material\)\)[^]*?source === 'image' && materialHasAuthoritativeAspectRatio\(material\)[^]*?setAspectRatio\(ratio\)/, '素材卡必须先用视频权威比例，封面只能在缺少视频比例时兜底');
const gallerySource = readFileSync(new URL('./inspiration/inspirationMaterialGalleryProjection.ts', import.meta.url), 'utf8');
assert.match(componentSource, /projectMaterialGallery\(\{[\s\S]*?materials: localMaterials,[\s\S]*?summaries: productMaterialSummaries/, '素材列表必须投影当前素材和产品集合');
assert.match(gallerySource, /const productMaterials = Object\.values\(summaries\)\.flatMap\(summary => summary\.materials\)[^]*?\[\.\.\.materials, \.\.\.productMaterials\]/, '镜头功能筛选项必须合并产品集合素材');
assert.match(materialGridSource, /<MaterialLibraryCardMedia[^]*?flex flex-1 flex-col p-3[^]*?mt-auto grid grid-cols-2 gap-2 pt-3/, '素材卡必须使用真实比例媒体组件，并把按钮固定在信息区底部');
assert.doesNotMatch(materialGridSource, /min-h-52/, '素材卡信息区不得以固定最小高度在按钮下方制造大片空白');
assert.match(componentSource, /grid-cols-\[minmax\(240px,2fr\)_[^]*?<Input allowClear[^]*?aria-label="搜索爆款灵感"[^]*?<Select value=\{platform\}/, '搜索框必须位于灵感发现主筛选最左侧');
const inspirationMoreFilters = componentSource.slice(componentSource.indexOf('id="inspiration-more-filters"'), componentSource.indexOf("innerView === 'inspiration' && videosError"));
assert.doesNotMatch(inspirationMoreFilters, />发布平台<|aria-label="社媒平台"/, '发布平台不得重复出现在更多筛选');
assert.doesNotMatch(videoCardSource, /video\.tags\.slice\(0, 2\)/, '爆款卡片与列表首页不得展示 hashtag');
assert.doesNotMatch(videoCardSource, /HIDDEN_DISCOVERY_TAGS|visibleSignals|<Tag\b/, '媒体墙只显示画面与操作，分析维度留给详情');
assert.match(videoCardSource, /ls-viral-card group[\s\S]*?absolute inset-x-0 bottom-0[\s\S]*?group-hover:opacity-100[\s\S]*?查看详情[\s\S]*?爆款裂变/, '爆款卡的详情和生产操作位于媒体底部浮层');
assert.match(videoCardSource, /absolute right-2 top-2[\s\S]*?收藏[\s\S]*?删除/, '收藏和删除必须位于右上角对象操作区');
assert.doesNotMatch(videoResultsSource, /VideoListItem|viewMode/, '爆款集合不保留旧列表视图');
assert.match(detailSource, /aria-label="内容标签"[^]*?video\.tags\.map/, '爆款 hashtag 必须集中展示在详情顶部');
assert.match(componentSource, /startInspirationCreation[^]*?requestExactFullAnalysis/, '未完成详细分析的视频点击复刻时必须自动补齐分析');
assert.match(detailSource, /detailCreationReady =[^;]*exactQuality\.ready && !pending/, '详情复刻入口不能依赖可失败的交接状态读取');
assert.match(componentSource, /const openTask = \(taskId: string\)[^]*?directStudio: true[^]*?continueTaskId: taskId/, '爆款复刻任务创建后必须直接进入生产工作台');
assert.doesNotMatch(componentSource, /title: `\$\{video\.title \|\| '灵感视频'\} · 爆款裂变`/, '生产任务标题不得继续使用旧的“爆款裂变”名称');

console.log('InspirationDashboard data-quality tests passed');
