import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  canProcessVideo,
  displayDuration,
  isDisplayableVideoAnalysis,
  materialSemanticLabel,
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

assert.equal(resultEmptyState(0, '', false), 'no-data');
assert.equal(resultEmptyState(12, 'not-found', false), 'no-match');
assert.equal(resultEmptyState(12, '', true), 'no-match');
assert.equal(isDisplayableVideoAnalysis({
  usage: 'reference_only',
  contentSha256: 'sha256',
  userVisible: true,
  geminiStatus: 'video_failed',
  analysisError: 'exact_analysis_stalled',
}, 'analyzed'), true, '精准分析失败的手动对标视频必须留在爆款库供查看和重试');
assert.equal(isDisplayableVideoAnalysis({ geminiStatus: 'video_failed' }, 'analyzed'), false, '普通采集视频仍遵守失败隐藏规则');

const componentSource = readFileSync(fileURLToPath(new URL('./InspirationDashboard.tsx', import.meta.url)), 'utf8');
assert.match(componentSource, /aria-label={`播放 \${material\.name}`}[^]*?event\.stopPropagation\(\); setPreviewMaterial\(material\);[^]*?z-20/, '播放按钮应稳定置于 hover 操作层之上且只打开预览');
assert.match(componentSource, /contentFormat: isImageMaterial \? 'image' : 'video'/, '图片素材进入工作流时必须保留图片类型，不能伪装成视频');
assert.match(componentSource, /disabled=\{material\.type === 'audio' \|\| \(material\.type === 'video' && !canProcessVideo\([^]*?<Sparkles[^]*?自由创作/, '图片素材必须可以直接进入生成，只有无有效时长的视频和音频被拦截');
assert.match(componentSource, /refreshMaterialPreviewUrl[^]*?重新获取播放地址/, '素材预览失败后必须能刷新短期播放地址并重试');
assert.match(componentSource, /aria-label={`编辑 \${material\.name}`}[^]*?aria-label={`删除 \${material\.name}`}/, '每条可管理素材必须固定提供编辑与删除入口');
assert.match(componentSource, /INSPIRATION_PAGE_SIZE = 100/, '灵感列表必须一次读取当前租户的全部常规库存，避免分页后前端过滤造成假缺失');
assert.match(componentSource, /inventory-summary[^]*?setTenantVideoTotalItems/, '首屏必须独立优先读取真实库存量');
assert.match(componentSource, /setTenantVideoTotalItems\(videos\.filter\(video => ACTIVE_PLATFORMS\.includes\(video\.platform\) && isDisplayableForFormat\(video, contentFormat\)\)\.length\)/, '列表加载后 Tab 数量必须改用与可展示卡片一致的去重结果数');
assert.match(componentSource, /正在读取真实视频库存/, '首次列表请求完成前必须显示加载动画，不能先显示空状态');
assert.match(componentSource, /<Pagination current=\{videoPage\}[^]*?pageSize=\{INSPIRATION_PAGE_SIZE\}[^]*?showSizeChanger=\{false\}[^]*?onChange=\{page => void refreshVideos\(page\)\}/, '灵感列表必须使用固定页大小的服务端分页');
assert.doesNotMatch(componentSource, />\s*加载更多\s*</, '灵感列表不再使用追加式“加载更多”');
assert.doesNotMatch(componentSource, /本页近 3 日新入库|当前显示 <strong/, '灵感中心不应再显示与真实结果集口径冲突的独立统计条');
assert.match(componentSource, /<LsMasonryGallery layout="grid"/, '带固定操作区的视频卡必须使用齐行网格，避免瀑布流产生空列');
assert.match(componentSource, /startInspirationCreation[^]*?requestExactFullAnalysis/, '未完成详细分析的视频点击复刻时必须自动补齐分析');
assert.match(componentSource, /detailCreationReady =[^;]*exactQuality\.ready && !pending/, '详情复刻入口不能依赖可失败的交接状态读取');

console.log('InspirationDashboard data-quality tests passed');
