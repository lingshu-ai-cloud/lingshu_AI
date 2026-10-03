import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

export type AcceptanceScene = 'product' | 'factory' | 'usage';
export type AcceptanceMode = 'clone' | 'free';
export interface AcceptanceCase {
  id: string;
  scene: AcceptanceScene;
  mode: AcceptanceMode;
  variant: string;
  products: string[];
  references: string[];
  requiredChecks: string[];
}
export interface AcceptanceMatrix { schemaVersion: 1; fixtureRoot: string; fixtureManifest?: string; cases: AcceptanceCase[] }
export interface AcceptanceAttempt {
  artifactPath: string;
  sha256: string;
  createdAt: string;
  latencyMs: number;
  estimatedCostCny: number;
  actualCostCny?: number;
  qaReportPath: string;
  humanReview: { reviewer: string; reviewedAt: string; decision: 'accept' | 'reject'; scores: Record<string, number>; failureReasons: string[] };
  adopted?: boolean;
}
export interface AcceptanceEvidenceCase {
  caseId: string;
  shotId: string;
  sourceShot?: { id: string; startSeconds: number; endSeconds: number; firstFramePath: string; sha256: string };
  firstFrames: AcceptanceAttempt[];
  videos: AcceptanceAttempt[];
}
export interface AcceptanceEvidence { schemaVersion: 1; cases: AcceptanceEvidenceCase[] }

const requiredScenes: AcceptanceScene[] = ['product', 'factory', 'usage'];
const requiredModes: AcceptanceMode[] = ['clone', 'free'];
const requiredVariants = ['tabletop', 'handheld', 'conveyor', 'equipment', 'production_line', 'worker', 'single_step', 'multi_step'];
const round = (n: number, digits = 3) => Number(n.toFixed(digits));
const rate = (a: number, b: number) => b ? round(a / b) : null;
const finiteNonnegative = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function resolveEvidenceFile(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative)) throw new Error(`Invalid relative artifact path: ${relative}`);
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error(`Artifact escapes evidence root: ${relative}`);
  return resolved;
}

function validateFile(root: string, relative: string, expectedHash?: string): string | null {
  let file: string;
  try { file = resolveEvidenceFile(root, relative); } catch (error) { return String(error); }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return `Missing file: ${relative}`;
  if (expectedHash && sha256(fs.readFileSync(file)) !== expectedHash.toLowerCase()) return `SHA-256 mismatch: ${relative}`;
  return null;
}

function mediaHeaderError(root: string, relative: string, phase: 'first_frame' | 'video'): string | null {
  try {
    const bytes = fs.readFileSync(resolveEvidenceFile(root, relative));
    let expectedFormat: string;
    if (phase === 'first_frame') {
      const png = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
      const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      if (!png && !jpeg && !webp) return `Artifact is not a PNG/JPEG/WebP image: ${relative}`;
      expectedFormat = 'image';
    } else {
      const mp4 = bytes.toString('ascii', 4, 8) === 'ftyp';
      const webm = bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'));
      if (!mp4 && !webm) return `Artifact is not an MP4/WebM video: ${relative}`;
      expectedFormat = 'video';
    }
    if (!ffmpegStatic) return 'FFmpeg unavailable; media evidence cannot be decoded';
    const decoded = spawnSync(ffmpegStatic, ['-hide_banner', '-xerror', '-nostdin',
      '-i', resolveEvidenceFile(root, relative), '-map', '0:v:0',
      ...(phase === 'first_frame' ? ['-frames:v', '1'] : []), '-f', 'null', '-'],
    { timeout: 120_000, maxBuffer: 1024 * 1024 });
    if (decoded.status !== 0) return `${expectedFormat === 'video' ? 'Video cannot be fully decoded' : 'Image cannot be decoded'}: ${relative}`;
    const dimensions = /Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(String(decoded.stderr || ''));
    if (!dimensions || Math.min(Number(dimensions[1]), Number(dimensions[2])) < 256)
      return `Media dimensions below 256px or unknown: ${relative}`;
    return null;
  } catch { return `Media cannot be inspected: ${relative}`; }
}

function inspectAttempt(attempt: AcceptanceAttempt, root: string, checks: string[], phase: 'first_frame' | 'video', humanScoreKeys: string[]): string[] {
  const errors: string[] = [];
  const artifact = validateFile(root, attempt.artifactPath, attempt.sha256);
  if (artifact) errors.push(artifact);
  else {
    const format = mediaHeaderError(root, attempt.artifactPath, phase);
    if (format) errors.push(format);
  }
  if (!/^[a-f0-9]{64}$/i.test(attempt.sha256 || '')) errors.push('Artifact SHA-256 is required');
  if (!Number.isFinite(Date.parse(attempt.createdAt))) errors.push('Invalid createdAt');
  if (!finiteNonnegative(attempt.latencyMs)) errors.push('Invalid latencyMs');
  if (!finiteNonnegative(attempt.estimatedCostCny)) errors.push('Invalid estimatedCostCny');
  if (attempt.actualCostCny !== undefined && !finiteNonnegative(attempt.actualCostCny)) errors.push('Invalid actualCostCny');
  const reportError = validateFile(root, attempt.qaReportPath);
  if (reportError) errors.push(reportError);
  else {
    try {
      const qa = JSON.parse(fs.readFileSync(resolveEvidenceFile(root, attempt.qaReportPath), 'utf8'));
      if (qa.version !== 'storyboard-aigc-qa-v1' || qa.phase !== phase) errors.push('QA report version or phase mismatch');
      if (typeof qa.reportId !== 'string' || !qa.reportId) errors.push('QA report ID missing');
      if (!qa.checks || typeof qa.checks !== 'object') errors.push('QA checks missing');
      if (!['passed', 'needs_review', 'retry_first_frame', 'retry_video', 'needs_assets'].includes(qa.status)) errors.push('QA report status invalid');
      if (!Array.isArray(qa.evidenceFrameLabels) || !qa.evidenceFrameLabels.length) errors.push('QA evidence frame labels missing');
      if (!Array.isArray(qa.reasonCodes)) errors.push('QA reason codes missing');
      for (const check of checks.filter(key => phase === 'video' || !['layout_continuity', 'contact_continuity', 'action_order', 'end_state'].includes(key))) {
        const key = phase === 'first_frame' ? check.replace('_continuity', '') : check;
        const observation = qa.checks?.[key];
        if (!observation) errors.push(`QA check missing: ${key}`);
        else {
          if (!['pass', 'fail', 'uncertain'].includes(observation.verdict)) errors.push(`QA check verdict invalid: ${key}`);
          if (!Array.isArray(observation.evidenceFrames) || !observation.evidenceFrames.length ||
            observation.evidenceFrames.some((label: unknown) => !qa.evidenceFrameLabels?.includes(label)))
            errors.push(`QA check evidence missing or unknown: ${key}`);
          if (phase === 'video' && observation.verdict === 'pass' &&
            ['product_identity', 'person_identity', 'environment_fidelity', 'layout_continuity', 'contact_continuity', 'action_order'].includes(key) &&
            new Set(observation.evidenceFrames).size < 2)
            errors.push(`QA temporal evidence insufficient: ${key}`);
        }
      }
      if (attempt.humanReview?.decision === 'accept' &&
        (qa.status !== 'passed' || qa.passed !== true || qa.reviewDecision !== 'accept' || !qa.reviewedBy || !qa.reviewedAt))
        errors.push('Human acceptance without reviewed, passed QA report');
    } catch { errors.push('QA report invalid JSON'); }
  }
  const human = attempt.humanReview;
  if (!human?.reviewer || !Number.isFinite(Date.parse(human.reviewedAt)) || !['accept', 'reject'].includes(human.decision)) errors.push('Human review missing or invalid');
  if (!human?.scores || !Object.values(human.scores).length || Object.values(human.scores).some(n => !Number.isInteger(n) || n < 1 || n > 5)) errors.push('Human rubric scores must be 1–5');
  for (const key of humanScoreKeys) if (!Number.isInteger(human?.scores?.[key])) errors.push(`Human rubric score missing: ${key}`);
  if (!Array.isArray(human?.failureReasons)) errors.push('Human failure reasons missing');
  if (attempt.adopted && (phase !== 'video' || human?.decision !== 'accept')) errors.push('Only a human-accepted video may be adopted');
  return errors;
}

export function evaluateStoryboardAcceptance(matrix: AcceptanceMatrix, evidence: AcceptanceEvidence, matrixDir: string, evidenceDir: string) {
  const matrixErrors: string[] = [];
  if (matrix.schemaVersion !== 1 || evidence.schemaVersion !== 1) matrixErrors.push('Unsupported schema version');
  const ids = new Set<string>();
  for (const item of matrix.cases) {
    if (!item.id || ids.has(item.id)) matrixErrors.push(`Duplicate or missing case ID: ${item.id}`);
    ids.add(item.id);
  }
  for (const scene of requiredScenes) for (const mode of requiredModes) {
    if (!matrix.cases.some(c => c.scene === scene && c.mode === mode)) matrixErrors.push(`Matrix missing ${scene}/${mode}`);
  }
  for (const variant of requiredVariants) if (!matrix.cases.some(c => c.variant === variant)) matrixErrors.push(`Matrix missing variant: ${variant}`);
  const fixtureRoot = path.resolve(matrixDir, matrix.fixtureRoot);
  const expectedHashes = new Map<string, string>();
  if (matrix.fixtureManifest) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.resolve(matrixDir, matrix.fixtureManifest), 'utf8')) as { files?: Array<{ path: string; sha256: string }> };
      for (const file of manifest.files || []) expectedHashes.set(file.path, file.sha256);
    } catch { matrixErrors.push('Fixture integrity manifest missing or invalid'); }
  }
  const byId = new Map<string, AcceptanceEvidenceCase>();
  for (const item of evidence.cases || []) {
    if (byId.has(item.caseId)) matrixErrors.push(`Duplicate evidence case: ${item.caseId}`);
    if (!ids.has(item.caseId)) matrixErrors.push(`Unknown evidence case: ${item.caseId}`);
    byId.set(item.caseId, item);
  }
  const cases = matrix.cases.map(item => {
    const inputErrors = [...item.products, ...item.references].map(p => {
      const manifestKey = path.posix.join('media/tenants/local_tenant_customer_aurelia_beauty', p.replaceAll('\\', '/'));
      const expected = matrix.fixtureManifest ? expectedHashes.get(manifestKey) : undefined;
      if (matrix.fixtureManifest && !expected) return `Asset missing from fixture integrity manifest: ${p}`;
      return validateFile(fixtureRoot, p, expected);
    }).filter((e): e is string => !!e);
    const record = byId.get(item.id);
    const gaps: string[] = [];
    if (!record?.shotId) gaps.push('Missing stable storyboard shot ID');
    if (item.mode === 'clone') {
      if (!record?.sourceShot?.id || !Number.isFinite(record.sourceShot.startSeconds) || !Number.isFinite(record.sourceShot.endSeconds) || record.sourceShot.endSeconds <= record.sourceShot.startSeconds) gaps.push('Missing exact clone shot ID/time range');
      if (!record?.sourceShot?.firstFramePath) gaps.push('Missing exact clone source first frame');
      else {
        if (!/^[a-f0-9]{64}$/i.test(record.sourceShot.sha256 || '')) gaps.push('Exact clone source first-frame SHA-256 missing');
        const error = validateFile(evidenceDir, record.sourceShot.firstFramePath, record.sourceShot.sha256);
        if (error) gaps.push(error);
        else {
          const format = mediaHeaderError(evidenceDir, record.sourceShot.firstFramePath, 'first_frame');
          if (format) gaps.push(format);
        }
      }
    }
    if (!record?.firstFrames?.length) gaps.push('Missing generated first-frame candidates');
    if (!record?.videos?.length) gaps.push('Missing generated video candidates');
    const firstFrameChecks = item.requiredChecks.map(key => key.replace('_continuity', '')).filter(key => !['action_order', 'end_state'].includes(key));
    if (item.requiredChecks.includes('end_state')) firstFrameChecks.push('start_state');
    const firstFrameScoreKeys = [item.products.length ? 'product_identity' : '', item.requiredChecks.includes('contact_continuity') ? 'contact' : ''].filter(Boolean);
    const videoScoreKeys = [...firstFrameScoreKeys, item.requiredChecks.includes('end_state') ? 'action_completion' : ''].filter(Boolean);
    const firstFrameErrors = (record?.firstFrames || []).flatMap((a, i) => inspectAttempt(a, evidenceDir, [...new Set(firstFrameChecks)], 'first_frame', firstFrameScoreKeys).map(e => `firstFrame[${i}]: ${e}`));
    const videoErrors = (record?.videos || []).flatMap((a, i) => inspectAttempt(a, evidenceDir, item.requiredChecks, 'video', videoScoreKeys).map(e => `video[${i}]: ${e}`));
    if ((record?.videos || []).filter(v => v.adopted).length > 1) videoErrors.push('Multiple adopted videos for one shot');
    if ((record?.videos || []).some(v => v.adopted) && !(record?.firstFrames || []).some(f => f.humanReview?.decision === 'accept'))
      videoErrors.push('Adopted video has no accepted first frame');
    const valid = !inputErrors.length && !gaps.length && !firstFrameErrors.length && !videoErrors.length;
    const first = record?.firstFrames?.[0];
    const adopted = record?.videos?.find(v => v.adopted);
    const qualityGaps = valid && !adopted ? ['No human-accepted video adopted for this case'] : [];
    const videoCandidates = record?.videos || [];
    const identityErrors = valid && item.products.length ? videoCandidates.filter(v => {
      const qa = JSON.parse(fs.readFileSync(resolveEvidenceFile(evidenceDir, v.qaReportPath), 'utf8')) as { reasonCodes?: string[] };
      return qa.reasonCodes?.includes('PRODUCT_IDENTITY_FAILED') || v.humanReview.failureReasons.includes('PRODUCT_IDENTITY_FAILED');
    }).length : 0;
    const actionCompletions = valid && item.requiredChecks.includes('end_state') ? videoCandidates.filter(v => {
      const qa = JSON.parse(fs.readFileSync(resolveEvidenceFile(evidenceDir, v.qaReportPath), 'utf8')) as { checks?: Record<string, { verdict?: string }> };
      return qa.checks?.action_order?.verdict === 'pass' && qa.checks?.end_state?.verdict === 'pass' && v.humanReview.scores?.action_completion >= 4;
    }).length : 0;
    return {
      id: item.id, scene: item.scene, mode: item.mode, variant: item.variant,
      inputAssetsPresent: !inputErrors.length, complete: valid, qualityGaps, inputErrors, gaps, firstFrameErrors, videoErrors,
      metrics: valid ? {
        firstFrameFirstPass: first?.humanReview.decision === 'accept',
        videoAdopted: !!adopted,
        videoCandidates: videoCandidates.length,
        adoptedCandidates: videoCandidates.filter(v => v.adopted).length,
        productIdentityEvaluatedCandidates: item.products.length ? videoCandidates.length : 0,
        productIdentityErrorCandidates: identityErrors,
        actionEvaluatedCandidates: item.requiredChecks.includes('end_state') ? videoCandidates.length : 0,
        actionCompletedCandidates: actionCompletions,
        redoes: Math.max(0, (record?.firstFrames?.length || 0) - 1) + Math.max(0, (record?.videos?.length || 0) - 1),
        elapsedSeconds: round([...(record?.firstFrames || []), ...(record?.videos || [])].reduce((n, a) => n + a.latencyMs, 0) / 1000),
        estimatedCostCny: round([...(record?.firstFrames || []), ...(record?.videos || [])].reduce((n, a) => n + a.estimatedCostCny, 0), 2),
        actualCostCny: [...(record?.firstFrames || []), ...(record?.videos || [])].every(a => a.actualCostCny !== undefined) ? round([...(record?.firstFrames || []), ...(record?.videos || [])].reduce((n, a) => n + (a.actualCostCny || 0), 0), 2) : null,
      } : null,
    };
  });
  const measured = cases.filter(c => c.complete && c.metrics);
  const sum = (key: 'videoCandidates' | 'adoptedCandidates' | 'productIdentityEvaluatedCandidates' | 'productIdentityErrorCandidates' | 'actionEvaluatedCandidates' | 'actionCompletedCandidates') => measured.reduce((n, c) => n + (c.metrics?.[key] || 0), 0);
  return {
    schemaVersion: 1 as const, status: matrixErrors.length || cases.some(c => !c.complete || c.qualityGaps.length) ? 'incomplete' as const : 'complete' as const,
    matrixErrors, cases,
    summary: {
      definedCases: cases.length, measuredCases: measured.length,
      firstFrameFirstPassRate: rate(measured.filter(c => c.metrics?.firstFrameFirstPass).length, measured.length),
      videoAdoptionRate: rate(sum('adoptedCandidates'), sum('videoCandidates')),
      productIdentityErrorRate: rate(sum('productIdentityErrorCandidates'), sum('productIdentityEvaluatedCandidates')),
      actionCompletionRate: rate(sum('actionCompletedCandidates'), sum('actionEvaluatedCandidates')),
      averageRedos: measured.length ? round(measured.reduce((n, c) => n + (c.metrics?.redoes || 0), 0) / measured.length, 2) : null,
      averageElapsedSeconds: measured.length ? round(measured.reduce((n, c) => n + (c.metrics?.elapsedSeconds || 0), 0) / measured.length, 2) : null,
      averageEstimatedCostCny: measured.length ? round(measured.reduce((n, c) => n + (c.metrics?.estimatedCostCny || 0), 0) / measured.length, 2) : null,
      averageActualCostCny: measured.length && measured.every(c => c.metrics?.actualCostCny !== null) ? round(measured.reduce((n, c) => n + (c.metrics?.actualCostCny || 0), 0) / measured.length, 2) : null,
    },
    note: 'Only cases with verified files, QA reports and human reviews enter the denominator. Null means unmeasured. Reference assets alone never prove generation quality.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const matrixPath = path.resolve(process.cwd(), 'fixtures/storyboard-aigc-acceptance/matrix.json');
  const evidenceFlag = process.argv.indexOf('--evidence');
  const outputFlag = process.argv.indexOf('--out');
  const evidencePath = evidenceFlag >= 0 ? path.resolve(process.argv[evidenceFlag + 1] || '') : '';
  const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8')) as AcceptanceMatrix;
  const evidence = evidencePath ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) as AcceptanceEvidence : { schemaVersion: 1 as const, cases: [] };
  const report = evaluateStoryboardAcceptance(matrix, evidence, path.dirname(matrixPath), evidencePath ? path.dirname(evidencePath) : process.cwd());
  const output = JSON.stringify(report, null, 2) + '\n';
  if (outputFlag >= 0) fs.writeFileSync(path.resolve(process.argv[outputFlag + 1] || ''), output);
  else process.stdout.write(output);
  process.exitCode = report.status === 'complete' ? 0 : 2;
}
