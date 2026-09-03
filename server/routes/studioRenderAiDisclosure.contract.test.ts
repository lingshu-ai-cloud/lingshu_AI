import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../lib/renderAuthorizationStore.test.js';

const studio = readFileSync(new URL('../../src/components/AiCreateStudio.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../../src/lib/studioApi.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('./studio.ts', import.meta.url), 'utf8');
const finalQuality = readFileSync(new URL('../lib/digitalHumanFinalRenderQuality.ts', import.meta.url), 'utf8');

assert.match(api, /digitalHumanGenerated\?: boolean/, 'RenderSpec/Manifest 必须携带数字人来源');
assert.match(api, /aiDisclosure\?: RenderAiDisclosure/, 'RenderManifest 必须支持可审计披露块');
assert.doesNotMatch(api, /function localManifest|source:\s*'local',\s*token:\s*null/, '授权、额度或服务失败不得降级为未授权渲染');
assert.match(api, /authorizationToken:\s*data\.token/, '服务端渲染令牌必须随授权 manifest 交给客户端');
assert.match(api, /'X-Render-Token': renderToken/, '网页本地渲染必须携带短期令牌');
assert.match(api, /body:\s*JSON\.stringify\(\{ jobId: manifest\.jobId \}\)/, '网页不得回传可篡改的完整 manifest');
assert.match(api, /anchor\.click\(\)/, '网页必须触发真实成片下载');

assert.match(studio, /const digitalHumanGenerated = shotMediaModes\[slot\.id\] === 'digital'/, '分镜数字人选择必须进入渲染时间线');
assert.match(studio, /sourceType: digitalHumanGenerated \? 'digital-human' : clip\.sourceType/, '数字人分镜必须强制传递来源');
assert.match(studio, /renderPipelineVersion: RENDER_AI_DISCLOSURE_PIPELINE_VERSION/, '渲染签名必须区分披露版本');
assert.match(studio, /desktop\?\.available && auth\.manifest\.aiDisclosure\?\.containsDigitalHuman !== true/, '桌面端数字人成片不得绕过服务端完成门禁');
assert.match(studio, /sourceType: item\.sourceType \|\| 'project-snapshot'/, '项目快照不得覆盖数字人来源');
assert.doesNotMatch(studio, /\{ \.\.\.item, sourceType: 'project-snapshot' \}/, '恢复项目时不得覆盖已保存的来源');

assert.match(route, /isDigitalHumanGeneratedTimelineItem\(material\)/, '服务端必须用租户可见素材二次核验');
assert.match(route, /manifest\.aiDisclosure = buildRenderAiDisclosure\(jobId, timeline\)/, '服务端 manifest 必须生成披露块');
assert.match(route, /renderManifestSha256\(manifest as unknown as StoredRenderManifest\)/, '签发时必须绑定服务端 manifest 摘要');
assert.match(route, /tenantId,[\s\S]*?ratio: manifest\.spec\.ratio,[\s\S]*?duration: manifest\.spec\.duration,[\s\S]*?manifestSha256/, '令牌必须绑定租户、任务画幅、时长与摘要');
assert.match(route, /rememberRenderAuthorization\(/, '签发后必须冻结服务端渲染快照');
assert.match(route, /const jobId = String\(req\.body\?\.jobId \|\| ''\);[\s\S]*?resolveRenderAuthorization\(\{[\s\S]*?req\.get\('x-render-token'\)[\s\S]*?jobId,/, '本地渲染必须核验 token 并且只接受 jobId');
assert.match(route, /const manifest = authorization\.manifest as unknown as RenderManifest;[\s\S]*?composite\(manifest/, '合成器只能消费服务端冻结快照');
assert.match(
  route,
  /containsDigitalHuman[\s\S]*?validateDigitalHumanFinalRenderFile\(outputPath, manifest\.spec\.duration(?:,\s*\{[\s\S]*?\})?\)/,
  '数字人最终成片必须执行服务端媒体门禁',
);
assert.match(route, /DIGITAL_HUMAN_FINAL_MEDIA_REJECTED[\s\S]*?fs\.rmSync\(outputPath, \{ force: true \}\)/, '门禁失败必须删除不合格输出');
assert.doesNotMatch(finalQuality, /(?:execFile|spawn)[^;\n]*syncnet|from\s+['"][^'"]*syncnet/i, '混合 B-roll 的最终整片不得执行 SyncNet');
assert.match(finalQuality, /syncNetApplied: false/, '结构化质检必须明确记录未套用全片 SyncNet');
assert.match(route, /render\/assets\/:kind\/:id/, '渲染素材必须经过同源租户代理');
assert.match(route, /render\/download\/:filename/, '网页端必须提供下载路由');
assert.match(route, /Content-Disposition', `attachment;/, '成片下载必须返回 attachment Content-Disposition');

const localRenderRoute = route.slice(route.indexOf("studioRouter.post('/render/local'"), route.indexOf('/* ── 素材库'));
assert.doesNotMatch(localRenderRoute, /req\.body[^\n]*(?:timeline|voiceover|bgm|subtitles)|explorer\.exe|xdg-open|open', \['-R'/, '网页渲染不得信任浏览器素材或依赖服务器文件管理器');

console.log('studio secure render and AI disclosure contract tests passed');
