import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../../scripts/digital-human-local-worker.ts', import.meta.url), 'utf8');

for (const symbol of [
  'parseExecutablePerformancePlan',
  'buildPerformanceExecutionRecipe',
  'buildPerformanceExecutionReceipt',
  'digitalHumanPerformanceShotGate',
]) {
  assert.match(worker, new RegExp(`\\b${symbol}\\b`), `Worker 必须接入 ${symbol}`);
}

assert.match(worker, /const filterComplex = performanceRecipe\?\.filterComplex/, '有表演计划时必须使用计划生成的渲染配方');
assert.match(worker, /buildDigitalHumanFinalFilterComplex\(DIGITAL_HUMAN_STANDARD_VERTICAL_BASE_FILTER_COMPLEX, treatmentId\)/,
  '无表演计划的数字人合成链必须使用可审计的单次最终处理构建器');
assert.match(worker, /'-filter_complex', filterComplex/, '生成的渲染配方必须传给 FFmpeg');
assert.match(worker, /'-vf', performanceRecipe\.multiBeatIntermediateVideo\.filter/,
  '多 beat 拼接必须执行回执内已指纹的1080p中间配方');
assert.doesNotMatch(worker, /scale=720:1280/,
  '数字人多 beat 中间链不得降样到720p后再放大');
assert.match(worker, /comment=\$\{performanceRecipe\.metadataComment\}/, '输出必须携带表演计划指纹');
assert.match(worker, /verifyPerformanceOutputMetadata\(outputPath, performanceRecipe\.metadataComment/, '执行回执必须在回读当次处理输出元数据后才生成');
assert.match(worker, /baseQualityPassed:\s*quality\.passed/, '表现力分镜门禁不得绕过基础音画门禁');
assert.match(worker, /if \(performanceGate && !performanceGate\.passed\) \{\s*throw new PerformanceQualityRejectedError/,
  '表现力分镜门禁必须用类型化拒绝 fail closed');
assert.match(worker, /performance-execution\.json/, '执行回执必须持久化便于审计');

assert.match(worker, /let executionTail:\s*Promise<void>\s*=\s*Promise\.resolve\(\)/, '8GB GPU 必须有全局串行队列');
assert.match(worker, /const scheduled = executionTail\.then\(async \(\) => \{[\s\S]*?await executeJob\(id, input\)/, '任务必须在全局串行链上执行');
assert.match(worker, /void enqueueJobExecution\(job\.id, input\)/, '直连 HTTP 任务也必须入串行队列');
assert.match(worker, /await enqueueJobExecution\(local\.id, input\)/, '拉取式任务也必须入串行队列');
assert.match(worker, /maxConcurrentGpuJobs:\s*1/, '健康检查必须公开 8GB 串行上限');
assert.equal((worker.match(/executeJob\(/g) || []).length, 2, '不得在串行入口之外直接启动 GPU 执行');

const attemptRenderer = worker.slice(
  worker.indexOf('async function renderFinalTreatmentAttempt'),
  worker.indexOf('async function renderMuseTalkProfileAttempt'),
);
const qualityIndex = attemptRenderer.indexOf('quality = await validateOutput');
const performanceGateIndex = attemptRenderer.lastIndexOf('const performanceGate = applyPerformanceShotGate');
const rejectionIndex = attemptRenderer.indexOf('throw new PerformanceQualityRejectedError', performanceGateIndex);
const promotionIndex = worker.indexOf('promoteMuseTalkProfileResult(result.paths.output, outputPath');
const completedIndex = worker.indexOf("status: 'completed', stage: 'completed'", promotionIndex);
assert.ok(qualityIndex >= 0 && performanceGateIndex > qualityIndex && rejectionIndex > performanceGateIndex,
  '每次最终处理必须按基础质检→表现回执门禁顺序执行');
assert.ok(promotionIndex >= 0 && completedIndex > promotionIndex,
  '只有已通过的档位产物提升为 result.mp4 后才能 completed');
assert.match(worker,
  /triggerFailureCodes:\s*\(error\.quality\.failureCodes \|\| \[\]\)\s*\.filter\(code => code === DIGITAL_HUMAN_MOUTH_JUMP_FAILURE_CODE\)/,
  '全帧时序兜底只能携带 mouth_jump 类型化触发证据，其他嘴部质量原因留给局部处理');
assert.match(worker, /profileFailureCodes:\s*error\.quality\.failureCodes \|\| \[\]/,
  '局部处理档位必须由基线原片质量决定，不能被全帧时序兜底自身产生的模糊误导');

console.log('digitalHumanPerformanceWorker contract tests passed');
