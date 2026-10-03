import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./local-preview-supervisor.mjs', import.meta.url), 'utf8');
const viteSource = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');

assert.doesNotMatch(source, /node_modules\/vite\/bin\/vite\.js'\),\s*'preview'/, '常驻本地预览不能依赖会被构建过程替换的 dist 哈希文件');
assert.match(source, /verifyModuleScripts: true/, '前端健康检查必须验证入口模块可读取，不能只检查空 root 容器');
assert.match(source, /moduleSources[^]*?modules\.every\(module => module\.ok\)/, '入口模块失败时必须触发前端自愈');
assert.match(source, /optimizedDependencies[^]*?dependencies\.every\(dependency => dependency\.ok\)/, '入口依赖优化失效时也必须判定白屏并自愈');
assert.match(source, /'--force'/, '常驻源码预览启动时必须重建依赖缓存，避免返回 Outdated Optimize Dep');
assert.match(viteSource, /optimizeDeps:\s*\{[^}]*exclude:\s*\['xlsx'\]/s, '本地预览不能给 vendored xlsx 生成会失效的优化哈希');

console.log('local preview supervisor contract passed');
