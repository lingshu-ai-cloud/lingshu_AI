import assert from 'node:assert/strict';
import fs from 'node:fs';

const route = fs.readFileSync(new URL('../routes/socialDiscovery.ts', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../../src/lib/socialDiscoveryApi.ts', import.meta.url), 'utf8');
const scheduler = fs.readFileSync(new URL('../routes/scheduler.ts', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('./service.ts', import.meta.url), 'utf8');
const videos = fs.readFileSync(new URL('../routes/videos.ts', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../../src/components/inspiration/DiscoveryScopePanel.tsx', import.meta.url), 'utf8');
const inspirationDashboard = fs.readFileSync(new URL('../../src/components/InspirationDashboard.tsx', import.meta.url), 'utf8');

assert.match(route, /benchmarkAccounts:\s*benchmarkAccounts\(body\.benchmarkAccounts\)/, '用户确认的对标账号必须写入发现范围');
assert.match(route, /\['tiktok', 'instagram', 'youtube', 'facebook'\]/, 'Facebook 必须在可配置采集平台中');
assert.match(scheduler, /taskType: 'social_discovery_collection'/, '必须由真实调度器执行连续发现');
assert.match(scheduler, /discoveryScopeId:\s*input\.discoveryScopeId/, '调度任务只能保存权威范围引用');
assert.doesNotMatch(scheduler, /managedBy: 'social_discovery_scope'[\s\S]{0,200}keywords:/, '权威范围调度不得另存关键词事实');
assert.match(service, /dueDiscoveryModes\(brief, previousRuns\)/, '定时触发必须仅执行到期供给');
assert.match(service, /approval\?\.status !== 'approved'/, '未经批准的长期范围不得执行');
assert.match(route, /scheduled_trigger_internal_only/, '客户端不得伪造 scheduled 触发');
assert.match(route, /body\.decision === 'track' \? 'trial'/, '编导推荐 track 不能直接晋级');
assert.match(route, /approved \? 'tracked'/, '只有经营 Agent 确认后才能晋级 tracked');
assert.match(service, /mode === 'innovation' && brief\.productionGap/, '创新参考必须能从生产缺口建立采集输入');
assert.match(route, /businessDecisionRef/, '经营 Agent 确认必须有可追溯决策引用');
assert.match(api, /getSummary:/, 'DiscoverySummary 必须对前端客户端可用');
assert.match(dashboard, /socialDiscoveryApi\.getSummary\(\)/, '大屏必须展示 DiscoverySummary');
assert.match(dashboard, /socialDiscoveryApi\.listRuns\(1, 5\)/, '大屏必须展示可追溯运行记录');
assert.match(dashboard, /modePolicies:\s*strategy\.discoveryBrief\.modePolicies/, '前端保存不得丢失三类独立采集策略');
assert.match(dashboard, /'facebook'/, '发现范围必须可配置 Facebook');
assert.match(service, /discoveryContext:\s*\{ runId, scopeId: scope\.id, scopeVersion: scope\.version, mode, queryRef: target\.ref \}/, '采集必须向素材写入运行溯源');
assert.match(videos, /discoveryOrigins:\s*discoveryOrigins\(existingAnalysis\.discoveryOrigins/, '去重素材也必须追加发现溯源');
assert.match(inspirationDashboard, /discoverySupplyLabel\(video\)/, '素材卡必须向用户解释三类供给来源');
assert.match(scheduler, /reconcileSocialDiscoveryCollectionTasks\(\)/, '调度器启动时必须补齐历史已批准范围');
assert.doesNotMatch(route, /momentum[^\n]{0,80}(?:0\.\d+|\d+%)/i, '未确认的三类供给比例不得写死');

console.log('social discovery route contract tests passed');
