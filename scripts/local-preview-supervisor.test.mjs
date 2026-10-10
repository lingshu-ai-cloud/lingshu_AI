import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./local-preview-supervisor.mjs', import.meta.url), 'utf8');
const viteSource = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

assert.doesNotMatch(source, /node_modules\/vite\/bin\/vite\.js'\),\s*'preview'/, '常驻本地预览不能依赖会被构建过程替换的 dist 哈希文件');
assert.match(source, /verifyModuleScripts: true/, '前端健康检查必须验证入口模块可读取，不能只检查空 root 容器');
assert.match(source, /moduleSources[^]*?modules\.every\(module => module\.ok\)/, '入口模块失败时必须触发前端自愈');
assert.match(source, /optimizedDependencies[^]*?dependencies\.every\(dependency => dependency\.ok\)/, '入口依赖优化失效时也必须判定白屏并自愈');
assert.match(source, /LINGSHU_PREVIEW_FORCE_OPTIMIZE/, '只有显式诊断时才强制重建依赖缓存，避免延长每次冷启动');
assert.match(source, /!next \|\| next === repositoryRevision/, '临时无法读取提交 SHA 时不能把 unknown 当成版本变化并重启服务');
assert.match(source, /startupGraceMs/, '健康检查必须给 Vite 和后端留出冷启动宽限，避免启动中被误杀');
assert.match(source, /healthCheckTimeoutMs/, '大型页面首次编译时健康探测必须允许足够响应时间');
assert.match(source, /maxConsecutiveHealthFailures/, '短暂编译繁忙不能立即重启健康的预览进程');
assert.match(source, /for \(const service of services\) start\(service\)/, '后端冷启动期间也必须立即提供前端页面，不能让浏览器显示白屏或拒绝连接');
assert.match(source, /stableLocalAuthSecret/, '本地预览必须持久化独立签名密钥，后端重启不能让浏览器会话失效');
assert.match(source, /LOCAL_DEMO_TOKEN_SECRET: localAuthSecret/, '本地预览后端必须复用机器本地的稳定签名密钥');
assert.match(source, /LOCAL_DEMO_TOKEN_TTL_SECONDS: '86400'/, '本地预览登录应保持完整一天，不能在工作过程中提前失效');
assert.match(viteSource, /optimizeDeps:\s*\{[^}]*exclude:\s*\['xlsx'\]/s, '本地预览不能给 vendored xlsx 生成会失效的优化哈希');

console.log('local preview supervisor contract passed');
