#!/usr/bin/env node
/** Batch acceptance for the zh/en/es final MP4 deliverables. No GPU inference. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';
import {
  aggregateDigitalHumanSegmentQualityReports,
  assessDigitalHumanAcceptanceProbe,
  buildDigitalHumanAcceptanceItemResult,
  buildDigitalHumanTrilingualAcceptanceSummary,
  parseDigitalHumanAcceptanceManifest,
  validateDigitalHumanSegmentBounds,
  type DigitalHumanAcceptanceLanguage,
  type DigitalHumanAcceptanceManifestItem,
  type DigitalHumanAcceptanceItemResult,
  type DigitalHumanAcceptanceSegment,
} from '../server/lib/digitalHumanTrilingualAcceptance.js';
import { validateDigitalHumanHumanReview } from '../server/lib/digitalHumanTrustedAcceptance.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, '..');
const performanceValidator = path.join(scriptDir, 'validate-digital-human-performance.py');
const visualValidator = path.join(scriptDir, 'validate-digital-human.py');
const syncnetValidator = path.join(scriptDir, 'validate-syncnet.py');
const processTimeoutMs = Math.max(60_000, Number(process.env.DIGITAL_HUMAN_ACCEPTANCE_TIMEOUT_MS || 20 * 60_000));
const wslDistro = String(process.env.DIGITAL_HUMAN_VALIDATOR_WSL_DISTRO || 'Ubuntu-22.04').trim();
const wslUser = String(process.env.DIGITAL_HUMAN_VALIDATOR_WSL_USER || 'root').trim();
const validatorPython = String(process.env.DIGITAL_HUMAN_VALIDATOR_PYTHON || '/root/digital-human-lab/repos/MuseTalk/.venv/bin/python').trim();
const syncnetDir = String(process.env.DIGITAL_HUMAN_SYNCNET_DIR || '/syncnet_python').trim();
const freezeNoise = String(process.env.DIGITAL_HUMAN_FREEZE_NOISE || '0.0001').trim();
const freezeDuration = Math.max(0.3, Number(process.env.DIGITAL_HUMAN_FREEZE_DURATION_SECONDS || 0.8));
const strictSyncnetConfidence = 3.0;
const strictSyncnetMaxOffsetFrames = 3;

interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

function usage(): string {
  return [
    '用法:',
    '  npm run validate:digital-human-trilingual -- <trilingual.json> [report.json]',
    '  npx tsx scripts/validate-digital-human-trilingual.ts --manifest <trilingual.json> [--output <report.json>]',
    '  npx tsx scripts/validate-digital-human-trilingual.ts --server-batch-id <id> --base-url <url> [--output <report.json>]',
    '  可信模式从 DIGITAL_HUMAN_ACCEPTANCE_TOKEN（或 LINGSHU_ACCESS_TOKEN）读取 Bearer token。',
    '',
    '退出码: 0=全部通过，2=自动门禁失败，3=自动门禁通过但仍需真实人工复核。',
  ].join('\n');
}

function parseArgs(argv: string[]): { manifest?: string; serverBatchId?: string; baseUrl?: string; output?: string } {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    process.exit(0);
  }
  let manifest: string | undefined;
  let output: string | undefined;
  let serverBatchId: string | undefined;
  let baseUrl: string | undefined;
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--manifest') manifest = argv[++index];
    else if (argv[index] === '--server-batch-id') serverBatchId = argv[++index];
    else if (argv[index] === '--base-url') baseUrl = argv[++index];
    else if (argv[index] === '--output') output = argv[++index];
    else if (!argv[index]!.startsWith('-')) positional.push(argv[index]!);
  }
  manifest ||= positional[0];
  output ||= positional[1];
  if (Boolean(manifest) === Boolean(serverBatchId)) throw new Error(`必须且只能选择 --manifest 或 --server-batch-id\n${usage()}`);
  if (serverBatchId && !baseUrl) throw new Error(`--server-batch-id 必须同时提供 --base-url\n${usage()}`);
  return { manifest, serverBatchId, baseUrl, output };
}

function acceptanceEndpoint(baseUrl: string, batchId: string): string {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost', '::1'].includes(base.hostname)) {
    throw new Error('可信服务端验收只允许 HTTPS（或本机 loopback）');
  }
  const prefix = base.pathname.replace(/\/+$/, '');
  base.pathname = `${prefix.endsWith('/api/overseas/studio') ? prefix : `${prefix}/api/overseas/studio`}/render/batches/${encodeURIComponent(batchId)}/digital-human-acceptance`;
  base.search = '';
  base.hash = '';
  return base.toString();
}

async function fetchTrustedServerAcceptance(args: { serverBatchId: string; baseUrl: string; output?: string }): Promise<void> {
  const token = String(process.env.DIGITAL_HUMAN_ACCEPTANCE_TOKEN || process.env.LINGSHU_ACCESS_TOKEN || '').trim();
  if (!token) throw new Error('缺少 DIGITAL_HUMAN_ACCEPTANCE_TOKEN 或 LINGSHU_ACCESS_TOKEN');
  const response = await fetch(acceptanceEndpoint(args.baseUrl, args.serverBatchId), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error || `服务端验收请求失败 (${response.status})`));
  const acceptance = payload.acceptance && typeof payload.acceptance === 'object' && !Array.isArray(payload.acceptance)
    ? payload.acceptance as Record<string, unknown> : {};
  const summary = acceptance.summary && typeof acceptance.summary === 'object' && !Array.isArray(acceptance.summary)
    ? acceptance.summary as Record<string, unknown> : {};
  if (acceptance.schemaVersion !== 'digital-human-server-acceptance-v1'
    || acceptance.trust !== 'server_attested'
    || acceptance.productUse !== 'release_acceptance'
    || acceptance.batchId !== args.serverBatchId
    || !Array.isArray(acceptance.items)
    || acceptance.items.length !== 3) {
    throw new Error('服务端未返回完整的可信三语验收清单');
  }
  const report = { ...acceptance, retrievedAt: new Date().toISOString(), retrieval: { mode: 'authenticated_server', endpoint: acceptanceEndpoint(args.baseUrl, args.serverBatchId) } };
  const outputPath = args.output ? path.resolve(args.output) : path.resolve(`digital-human-acceptance-${args.serverBatchId}.json`);
  writeJson(outputPath, report);
  console.log(JSON.stringify({ report: outputPath, trust: acceptance.trust, validationStatus: summary.validationStatus, passed: summary.passed === true }, null, 2));
  process.exitCode = summary.passed === true ? 0 : summary.validationStatus === 'requires_human_review' ? 3 : 2;
}

function absoluteFrom(baseDir: string, value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(baseDir, value);
}

function toExecutionPath(value: string): string {
  if (process.platform !== 'win32') return value;
  const resolved = path.resolve(value);
  if (!/^[a-z]:[\\/]/i.test(resolved)) return resolved.replace(/\\/g, '/');
  return `/mnt/${resolved[0]!.toLowerCase()}/${resolved.slice(3).replace(/\\/g, '/')}`;
}

function runProcess(file: string, args: string[]): Promise<ProcessResult> {
  return new Promise(resolve => {
    execFile(file, args, {
      cwd: repositoryRoot,
      timeout: processTimeoutMs,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const rawCode = error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code !== 'undefined'
        ? (error as NodeJS.ErrnoException & { code?: unknown }).code
        : 0;
      resolve({
        code: typeof rawCode === 'number' ? rawCode : error ? 1 : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || error?.message || ''),
      });
    });
  });
}

function runValidationCommand(command: string, args: string[]): Promise<ProcessResult> {
  return process.platform === 'win32'
    ? runProcess('wsl.exe', ['-d', wslDistro, '-u', wslUser, '--', command, ...args])
    : runProcess(command, args);
}

function parseJsonOutput(value: string, label: string): Record<string, unknown> {
  const text = String(value || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`${label}未输出JSON`);
  const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label}输出不是JSON对象`);
  return parsed as Record<string, unknown>;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function jsonValidator(
  label: string,
  script: string,
  args: string[],
  reportFile: string,
  kind: 'performance' | 'generic',
): Promise<Record<string, unknown>> {
  const result = await runValidationCommand(validatorPython, [toExecutionPath(script), ...args]);
  try {
    const report = parseJsonOutput(result.stdout, label);
    if (![0, 2].includes(result.code)) {
      const failed = kind === 'performance'
        ? { ...report, passed: false, automated_passed: false, validation_status: 'failed', failures: [`${label}执行异常 (${result.code})`] }
        : { ...report, passed: false, failures: [`${label}执行异常 (${result.code})`] };
      writeJson(reportFile, failed);
      return failed;
    }
    writeJson(reportFile, report);
    return report;
  } catch (error) {
    const message = `${error instanceof Error ? error.message : String(error)}${result.stderr.trim() ? `: ${result.stderr.trim().slice(-1200)}` : ''}`;
    const failed = kind === 'performance'
      ? { passed: false, automated_passed: false, validation_status: 'failed', requires_human_review: false, failures: [message], human_review_reasons: [] }
      : { passed: false, failures: [message] };
    writeJson(reportFile, failed);
    return failed;
  }
}

function decimalSeconds(value: number): string {
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

async function extractMonoAudio(video: string, output: string, label: string): Promise<void> {
  if (!ffmpegStatic) throw new Error('ffmpeg-static 不可用');
  const extracted = await runProcess(String(ffmpegStatic), [
    '-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-i', video,
    '-map', '0:a:0', '-vn', '-ar', '16000', '-ac', '1', output,
  ]);
  if (extracted.code !== 0 || !fs.existsSync(output) || fs.statSync(output).size === 0) {
    throw new Error(`${label}音轨提取失败: ${extracted.stderr.trim().slice(-1000)}`);
  }
}

async function extractDigitalHumanSegment(
  video: string,
  segment: DigitalHumanAcceptanceSegment,
  output: string,
): Promise<void> {
  if (!ffmpegStatic) throw new Error('ffmpeg-static 不可用');
  const start = decimalSeconds(segment.start);
  const end = decimalSeconds(segment.end);
  const filter = `[0:v:0]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v];[0:a:0]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a]`;
  const extracted = await runProcess(String(ffmpegStatic), [
    '-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-i', video,
    '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output,
  ]);
  if (extracted.code !== 0 || !fs.existsSync(output) || fs.statSync(output).size === 0) {
    throw new Error(`数字人片段 ${segment.start}-${segment.end}s 裁切失败: ${extracted.stderr.trim().slice(-1000)}`);
  }
}

async function validateSegmentedFaceAndLipSync(input: {
  item: DigitalHumanAcceptanceManifestItem;
  video: string;
  languageDir: string;
  temporaryDir: string;
}): Promise<{ visual: Record<string, unknown>; syncnet: Record<string, unknown>; segmentReports: Record<string, unknown>[] }> {
  const entries: Array<{ segment: DigitalHumanAcceptanceSegment; visual: unknown; syncnet: unknown }> = [];
  for (const [index, segment] of input.item.digitalHumanSegments!.entries()) {
    const segmentName = `segment-${String(index + 1).padStart(2, '0')}`;
    const temporarySegmentDir = path.join(input.temporaryDir, `${input.item.language}-${segmentName}-${randomUUID()}`);
    const reportSegmentDir = path.join(input.languageDir, 'digital-human-segments', segmentName);
    fs.mkdirSync(temporarySegmentDir, { recursive: true });
    const clip = path.join(temporarySegmentDir, 'clip.mp4');
    const audio = path.join(temporarySegmentDir, 'audio.wav');
    await extractDigitalHumanSegment(input.video, segment, clip);
    await extractMonoAudio(clip, audio, `数字人片段${index + 1}`);
    const visual = await jsonValidator(
      `数字人片段${index + 1} MediaPipe口型门禁`, visualValidator,
      ['--video', toExecutionPath(clip), '--audio', toExecutionPath(audio), '--enforce'],
      path.join(reportSegmentDir, 'visual-mouth.json'), 'generic',
    );
    const syncnet = await jsonValidator(
      `数字人片段${index + 1} SyncNet门禁`, syncnetValidator,
      [
        '--video', toExecutionPath(clip),
        '--work-dir', toExecutionPath(path.join(temporarySegmentDir, 'syncnet')),
        '--syncnet-dir', syncnetDir,
        '--min-confidence', String(strictSyncnetConfidence),
        '--max-offset', String(strictSyncnetMaxOffsetFrames),
      ],
      path.join(reportSegmentDir, 'syncnet.json'), 'generic',
    );
    writeJson(path.join(reportSegmentDir, 'segment.json'), {
      index: index + 1,
      start: segment.start,
      end: segment.end,
      durationSeconds: segment.end - segment.start,
      source: 'acceptance_manifest',
    });
    entries.push({ segment, visual, syncnet });
  }
  const aggregated = aggregateDigitalHumanSegmentQualityReports(entries);
  writeJson(path.join(input.languageDir, 'visual-mouth.json'), aggregated.visual);
  writeJson(path.join(input.languageDir, 'syncnet.json'), aggregated.syncnet);
  return aggregated;
}

async function validateWholeVideoFaceAndLipSync(input: {
  item: DigitalHumanAcceptanceManifestItem;
  video: string;
  languageDir: string;
  temporaryDir: string;
}): Promise<{ visual: Record<string, unknown>; syncnet: Record<string, unknown>; segmentReports: Record<string, unknown>[] }> {
  const audio = path.join(input.temporaryDir, `${input.item.language}-${randomUUID()}.wav`);
  await extractMonoAudio(input.video, audio, '最终成片');
  const visual = await jsonValidator(
    'MediaPipe口型门禁', visualValidator,
    ['--video', toExecutionPath(input.video), '--audio', toExecutionPath(audio), '--enforce'],
    path.join(input.languageDir, 'visual-mouth.json'), 'generic',
  );
  const syncnet = await jsonValidator(
    'SyncNet门禁', syncnetValidator,
    [
      '--video', toExecutionPath(input.video),
      '--work-dir', toExecutionPath(path.join(input.temporaryDir, `syncnet-${input.item.language}`)),
      '--syncnet-dir', syncnetDir,
      '--min-confidence', String(strictSyncnetConfidence),
      '--max-offset', String(strictSyncnetMaxOffsetFrames),
    ],
    path.join(input.languageDir, 'syncnet.json'), 'generic',
  );
  return { visual, syncnet, segmentReports: [] };
}

async function validateItem(
  item: DigitalHumanAcceptanceManifestItem,
  manifestDir: string,
  reportDir: string,
  temporaryDir: string,
): Promise<DigitalHumanAcceptanceItemResult> {
  const video = absoluteFrom(manifestDir, item.video);
  const performanceManifestPath = absoluteFrom(manifestDir, item.performanceManifest);
  const humanReviewPath = item.humanReview ? absoluteFrom(manifestDir, item.humanReview) : undefined;
  if (!fs.existsSync(video) || !fs.statSync(video).isFile()) throw new Error(`成片不存在: ${video}`);
  if (!fs.existsSync(performanceManifestPath) || !fs.statSync(performanceManifestPath).isFile()) throw new Error(`表现力清单不存在: ${performanceManifestPath}`);
  if (humanReviewPath && (!fs.existsSync(humanReviewPath) || !fs.statSync(humanReviewPath).isFile())) throw new Error(`人工复核记录不存在: ${humanReviewPath}`);
  if (!ffmpegStatic) throw new Error('ffmpeg-static 不可用');
  const outputSha256 = await sha256File(video);
  let manualEvidence: Record<string, unknown> | undefined;
  if (humanReviewPath) {
    const rawReview = JSON.parse(fs.readFileSync(humanReviewPath, 'utf8')) as Record<string, unknown>;
    const sourceJobId = String(rawReview.sourceJobId || '').trim();
    const validated = validateDigitalHumanHumanReview({ value: rawReview, outputSha256, sourceJobId });
    if (!validated.valid) throw new Error(validated.failures.join('；'));
    manualEvidence = validated.review;
  }

  const languageDir = path.join(reportDir, item.language);
  fs.mkdirSync(languageDir, { recursive: true });
  const probeProcess = await runValidationCommand('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,width,height,duration',
    '-of', 'json', toExecutionPath(video),
  ]);
  let probe: Record<string, unknown>;
  try {
    if (probeProcess.code !== 0) throw new Error(probeProcess.stderr.trim() || `ffprobe exited ${probeProcess.code}`);
    probe = parseJsonOutput(probeProcess.stdout, 'ffprobe');
  } catch (error) {
    probe = { error: error instanceof Error ? error.message : String(error) };
  }
  writeJson(path.join(languageDir, 'ffprobe.json'), probe);

  if (item.digitalHumanSegments) {
    const duration = assessDigitalHumanAcceptanceProbe(probe).metadata.durationSeconds;
    const boundaryFailures = validateDigitalHumanSegmentBounds(
      item.digitalHumanSegments,
      typeof duration === 'number' ? duration : undefined,
    );
    if (boundaryFailures.length) throw new Error(boundaryFailures.join('；'));
  }

  const decode = await runProcess(String(ffmpegStatic), [
    '-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error', '-xerror', '-i', video,
    '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-',
  ]);
  writeJson(path.join(languageDir, 'decode.json'), { passed: decode.code === 0, error: decode.code === 0 ? undefined : decode.stderr.trim().slice(-2000) });

  const faceAndLipSync = item.digitalHumanSegments
    ? await validateSegmentedFaceAndLipSync({ item, video, languageDir, temporaryDir })
    : await validateWholeVideoFaceAndLipSync({ item, video, languageDir, temporaryDir });
  const performanceArgs = [
    '--video', toExecutionPath(video),
    '--manifest', toExecutionPath(performanceManifestPath),
    '--chroma-key', item.chromaKey || 'auto',
    '--enforce',
  ];
  // Human-review data is passed only when the caller supplies a real record.
  // The batch runner never creates or auto-approves review decisions.
  if (humanReviewPath) performanceArgs.push('--human-review', toExecutionPath(humanReviewPath));
  const performance = await jsonValidator(
    '表现力门禁', performanceValidator, performanceArgs,
    path.join(languageDir, 'performance.json'), 'performance',
  );

  const freezeProcess = await runProcess(String(ffmpegStatic), [
    '-hide_banner', '-nostdin', '-nostats', '-i', video,
    '-vf', `freezedetect=n=${freezeNoise}:d=${freezeDuration}`, '-an', '-f', 'null', '-',
  ]);
  const freezeLog = `${freezeProcess.stdout}\n${freezeProcess.stderr}`;
  fs.writeFileSync(path.join(languageDir, 'freezedetect.log'), freezeLog, 'utf8');

  const result = buildDigitalHumanAcceptanceItemResult({
    language: item.language,
    probe,
    decodePassed: decode.code === 0,
    visual: faceAndLipSync.visual,
    syncnet: faceAndLipSync.syncnet,
    performance,
    freezeValidated: freezeProcess.code === 0,
    freezeLog,
    outputSha256,
  });
  result.technical = {
    ...(result.technical || {}),
    videoPath: video,
    performanceManifestPath,
    humanReviewPath: humanReviewPath || null,
    manualEvidence: manualEvidence || null,
    rawReportDirectory: languageDir,
    faceAndLipSyncValidationScope: item.digitalHumanSegments ? 'digital_human_segments' : 'whole_video',
    digitalHumanSegments: item.digitalHumanSegments || null,
    digitalHumanSegmentReports: faceAndLipSync.segmentReports,
    strictSyncnetThresholds: {
      minConfidence: strictSyncnetConfidence,
      maxOffsetFrames: strictSyncnetMaxOffsetFrames,
    },
  };
  writeJson(path.join(languageDir, 'summary.json'), result);
  return result;
}

function failedItem(language: DigitalHumanAcceptanceLanguage, error: unknown): DigitalHumanAcceptanceItemResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    language,
    automatedPassed: false,
    requiresHumanReview: false,
    passed: false,
    validationStatus: 'failed',
    failures: [message],
    humanReviewReasons: [],
    technical: { validatorError: message },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.serverBatchId && args.baseUrl) {
    await fetchTrustedServerAcceptance({ serverBatchId: args.serverBatchId, baseUrl: args.baseUrl, output: args.output });
    return;
  }
  const manifestPath = path.resolve(args.manifest!);
  const manifestDir = path.dirname(manifestPath);
  const manifest = parseDigitalHumanAcceptanceManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  const outputPath = args.output
    ? path.resolve(args.output)
    : path.join(manifestDir, 'trilingual-acceptance-report.json');
  const reportDir = path.join(path.dirname(outputPath), `${path.basename(outputPath, path.extname(outputPath))}.items`);
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-trilingual-acceptance-'));
  const items: DigitalHumanAcceptanceItemResult[] = [];
  try {
    for (const item of manifest.items) {
      console.log(`[${item.language}] 开始验收 ${item.video}`);
      try {
        items.push(await validateItem(item, manifestDir, reportDir, temporaryDir));
      } catch (error) {
        const failed = failedItem(item.language, error);
        items.push(failed);
        writeJson(path.join(reportDir, item.language, 'summary.json'), failed);
      }
      console.log(`[${item.language}] ${items.at(-1)!.validationStatus}`);
    }
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
  const technicalSummary = buildDigitalHumanTrilingualAcceptanceSummary(items);
  const summary = {
    ...technicalSummary,
    trust: 'untrusted_offline',
    productUse: 'internal_only',
    technicalPassed: technicalSummary.passed,
    technicalValidationStatus: technicalSummary.validationStatus,
    passed: false,
    validationStatus: technicalSummary.validationStatus === 'failed' ? 'failed' : 'untrusted_internal_only',
    generatedAt: new Date().toISOString(),
    manifestPath,
    reportDirectory: reportDir,
    manualReviewPolicy: '未提供真实可审计的 humanReview 文件时，双嘴、复杂手部和声音匹配始终保持待人工复核。',
    evidence: {
      automated: items.map(item => ({ language: item.language, passed: item.automatedPassed, technical: item.technical })),
      manual: items.map(item => ({ language: item.language, evidence: item.technical?.manualEvidence || null })),
    },
  };
  writeJson(outputPath, summary);
  console.log(JSON.stringify({
    report: outputPath,
    automatedPassed: summary.automatedPassed,
    validationStatus: summary.validationStatus,
    passed: summary.passed,
  }, null, 2));
  process.exitCode = technicalSummary.validationStatus === 'failed' ? 2 : 3;
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
