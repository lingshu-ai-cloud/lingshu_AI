import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  canProcessVideo,
  displayDuration,
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

assert.equal(resultEmptyState(0, '', false), 'no-data');
assert.equal(resultEmptyState(12, 'not-found', false), 'no-match');
assert.equal(resultEmptyState(12, '', true), 'no-match');

const componentSource = readFileSync(fileURLToPath(new URL('./InspirationDashboard.tsx', import.meta.url)), 'utf8');
assert.match(componentSource, /aria-label={`播放 \${material\.name}`}[^]*?event\.stopPropagation\(\); setPreviewMaterial\(material\);[^]*?z-20/, '播放按钮应稳定置于 hover 操作层之上且只打开预览');
assert.match(componentSource, /z-10 flex items-end[^]*?event\.stopPropagation\(\); enterMaterialSmartGeneration\(material\);[^]*?用此素材生成/, '生成必须使用位于播放按钮下方的独立操作区');
assert.match(componentSource, /INSPIRATION_PAGE_SIZE = 30/, '灵感列表每页必须固定读取最新 30 条');
assert.match(componentSource, /inventory-summary[^]*?setTenantVideoTotalItems/, '首屏必须独立优先读取真实库存量');
assert.match(componentSource, /正在读取真实视频库存/, '首次列表请求完成前必须显示加载动画，不能先显示空状态');
assert.match(componentSource, /上一页[^]*?第 \{videoPage\} \/ \{videoTotalPages\} 页[^]*?下一页/, '灵感列表必须使用稳定分页');
assert.doesNotMatch(componentSource, />\s*加载更多\s*</, '灵感列表不再使用追加式“加载更多”');

console.log('InspirationDashboard data-quality tests passed');
