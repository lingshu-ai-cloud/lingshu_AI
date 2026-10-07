#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeSubtitleCues, cuesToAss, resolution, ffmpegPath } = require('../desktop/render.cjs');
const { normalizeEmphasisPlan } = require('../desktop/emphasis-composition.cjs');
const { RENDERER_VERSION, advancedEvents, intersects } = require('../desktop/remotion-overlay.cjs');

type Box = { x: number; y: number; width: number; height: number };
type Failure = { check: string; detail: string };
const args = process.argv.slice(2);
const value = (flag: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
const manifestPath = value('--manifest');
const videoPath = value('--video');
if (!manifestPath || !videoPath) {
  console.error('Usage: pnpm exec tsx scripts/verify-studio-emphasis-output.ts --manifest manifest.json --video output.mp4 [--report report.json] [--extract-dir frames] [--previous-report previous.json]');
  process.exit(2);
}
const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8')) as any;
const video = path.resolve(videoPath);
if (!fs.existsSync(video)) throw new Error(`成片不存在：${video}`);
const duration = Number(manifest.spec?.duration || 0);
if (!(duration > 0)) throw new Error('manifest.spec.duration 无效');
const [baseW, baseH] = resolution(manifest.spec?.ratio || '9:16');
const scale = manifest.spec?.resolution === '720p' ? 2 / 3 : 1;
const width = Math.round(baseW * scale / 2) * 2, height = Math.round(baseH * scale / 2) * 2;
const style = manifest.subtitles?.style || {};
const fontSize = Math.round(Math.min(width, height) / 18 * Math.max(.7, Math.min(1.4, Number(style.fontScale) || 1)));
const maxUnitsPerLine = Math.min(12, (width - Math.round(width * .085) * 2) / fontSize, Math.max(8, Number(style.lineWidth) || 10));
const cues = Array.isArray(manifest.subtitles?.cues) ? manifest.subtitles.cues : [];
const spoken = cues.filter((cue: any) => cue?.kind !== 'screen');
const normalizedCues = normalizeSubtitleCues(spoken, { maxUnitsPerLine, maxUnitsPerPage: 16 });
const plan = normalizeEmphasisPlan(manifest.emphasisPlan || manifest.emphasis, duration);
const events = advancedEvents(plan);
const failures: Failure[] = [];
const unit = (char: string) => /\s/.test(char) ? .35 : /[ilI.,!:'`|]/.test(char) ? .28 : /[frt()]/.test(char) ? .36
  : /[MWmw@]/.test(char) ? .82 : /[A-Z]/.test(char) ? .66 : /[\x00-\xff]/.test(char) ? .54 : 1;
const units = (text: string) => Array.from(text).reduce((sum, char) => sum + unit(char), 0);

for (const [index, cue] of normalizedCues.entries()) {
  const lines = String(cue.text).split('\\N');
  if (lines.length > 2) failures.push({ check: 'subtitle_max_two_lines', detail: `cue ${index + 1} has ${lines.length} lines` });
  lines.forEach((line: string, lineIndex: number) => {
    if (units(line) > maxUnitsPerLine + .01) failures.push({ check: 'subtitle_line_length', detail: `cue ${index + 1} line ${lineIndex + 1} exceeds ${maxUnitsPerLine.toFixed(2)} units` });
  });
}
const ass = cuesToAss(cues, width, height, '', duration, style, plan);
const defaultStyle = ass.split('\n').find((line: string) => line.startsWith('Style: Default,'));
if (!defaultStyle || Number(defaultStyle.split(',')[2]) !== fontSize) failures.push({ check: 'subtitle_font_size', detail: 'Default ASS style font size does not match the single manifest-derived size' });
const styleSizes = new Map(ass.split('\n').filter((line: string) => line.startsWith('Style: ')).map((line: string) => {
  const fields = line.split(',');
  return [fields[0]!.slice('Style: '.length), Number(fields[2])] as const;
}));
const subtitleDialogues = ass.split('\n').filter((entry: string) => /^Dialogue: 0,/.test(entry));
for (const line of ass.split('\n').filter((entry: string) => /^Dialogue: [01],/.test(entry))) {
  if (/\\fs\d+/.test(line)) failures.push({ check: 'subtitle_font_consistency', detail: 'A primary/screen subtitle overrides the global font size' });
}
for (const line of subtitleDialogues) {
  const dialogueStyle = line.split(',')[3];
  if (styleSizes.get(dialogueStyle) !== fontSize) failures.push({ check: 'subtitle_font_consistency', detail: `spoken subtitle style ${dialogueStyle} does not use the global ${fontSize}px size` });
}

const timedWords = spoken.flatMap((cue: any, cueIndex: number) => (Array.isArray(cue?.words) ? cue.words : []).flatMap((word: any, wordIndex: number) => {
  const start = Number.isFinite(Number(word?.startMs)) ? Number(word.startMs) / 1_000 : Number(word?.start);
  const end = Number.isFinite(Number(word?.endMs)) ? Number(word.endMs) / 1_000 : Number(word?.end);
  if (!String(word?.text || '').trim() || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    failures.push({ check: 'word_timing_valid', detail: `cue ${cueIndex + 1} word ${wordIndex + 1} has invalid timing` });
    return [];
  }
  if (start < Number(cue.start) - .001 || end > Number(cue.end) + .001) failures.push({ check: 'word_timing_bounds', detail: `cue ${cueIndex + 1} word ${wordIndex + 1} falls outside its cue` });
  return [{ text: String(word.text).trim(), start, end }];
}));
const wordHighlightDialogues = ass.split('\n').filter((entry: string) => /^Dialogue: 1,[^,]+,[^,]+,WordHighlight,,/.test(entry));
if (/\\(?:kf|ko|K)\d+/.test(ass)) failures.push({ check: 'word_highlight_mode', detail: 'letter-sweep karaoke tags are forbidden; highlights must switch whole words' });
if (timedWords.length && wordHighlightDialogues.length !== timedWords.length) failures.push({ check: 'word_highlight_coverage', detail: `expected ${timedWords.length} whole-word highlights, found ${wordHighlightDialogues.length} WordHighlight events` });
if (wordHighlightDialogues.some((line: string) => !line.includes('{\\alpha&H00&}'))) failures.push({ check: 'word_highlight_visibility', detail: 'a word highlight event does not expose exactly one visible span' });
const dialogueKeys = subtitleDialogues.map((line: string) => {
  const fields = line.split(',');
  return `${fields[1]}:${fields[2]}:${fields.slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/g, ' ').trim().toLocaleLowerCase()}`;
});
if (new Set(dialogueKeys).size !== dialogueKeys.length) failures.push({ check: 'duplicate_subtitle_dialogue', detail: 'ASS contains duplicate spoken subtitle dialogues' });
if (subtitleDialogues.length !== normalizedCues.length) failures.push({ check: 'subtitle_dialogue_count', detail: `expected one spoken Dialogue per normalized cue page (${normalizedCues.length}), found ${subtitleDialogues.length}` });
const sourceHasBurnedCaptions = manifest.acceptance?.sourceHasBurnedCaptions === true;
if (sourceHasBurnedCaptions && timedWords.length
  && manifest.acceptance?.burnedCaptionsRemoved !== true
  && manifest.acceptance?.burnedCaptionsCovered !== true) failures.push({
  check: 'source_burned_caption_duplication',
  detail: 'source contains moving burned-in captions; a project word-highlight layer cannot guarantee a single visible subtitle track',
});
if (manifest.acceptance?.burnedCaptionCleanupReviewRequired === true
  && manifest.acceptance?.burnedCaptionCleanupAccepted !== true) failures.push({
  check: 'burned_caption_cleanup_visual_review',
  detail: 'burned-caption cleanup requires visual review and has not been accepted',
});

const inside = (box: Box) => box.x >= 0 && box.y >= 0 && box.x + box.width <= 1 && box.y + box.height <= .71;
const subtitleReserve: Box = { x: .04, y: .72, width: .92, height: .26 };
for (const event of events) {
  for (const [kind, value] of Object.entries(event.layout || {})) {
    const box = value as Partial<Box>;
    if (![box.x, box.y, box.width, box.height].every(item => Number.isFinite(Number(item)))) continue;
    const normalizedBox = box as Box;
    if (!inside(normalizedBox)) failures.push({ check: 'overlay_bounds', detail: `${event.id}.${kind} is outside the upper safe frame` });
    if (intersects(normalizedBox, subtitleReserve)) failures.push({ check: 'overlay_subtitle_overlap', detail: `${event.id}.${kind} overlaps the subtitle reserve` });
  }
  if (intersects(event.layout.asset, event.layout.label, .006)) failures.push({ check: 'asset_text_overlap', detail: `${event.id} asset overlaps its label` });
}
for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
  const left = events[i]!, right = events[j]!;
  if (!(left.startMs < right.endMs && right.startMs < left.endMs)) continue;
  for (const a of [left.layout.asset, left.layout.label]) for (const b of [right.layout.asset, right.layout.label]) {
    if (intersects(a, b, .008)) failures.push({ check: 'event_rectangle_overlap', detail: `${left.id} overlaps ${right.id}` });
  }
}
const overlayRoot = fs.readFileSync(new URL('../desktop/remotion-overlay/root.tsx', import.meta.url), 'utf8');
if (!/(?:event\.layout\.(?:asset|label)|\{\s*asset:\s*\w+\s*,\s*label:\s*\w+\s*\}\s*=\s*event\.layout)/.test(overlayRoot)) failures.push({ check: 'layout_contract_consumed', detail: 'Remotion overlay computes independent rectangles but root.tsx does not consume event.layout' });

const assetByKind: Record<string, string> = { key_fact: 'burst-rays-yellow-static.png', reveal: 'burst-rays-yellow.gif', warning: 'emphasis-rays-yellow.gif', urgency: 'lightning-orange.gif', cta: 'megaphone-blue-yellow.gif' };
const ffmpeg = String(ffmpegPath || '');
const chromaEvidence = (at: number, kind: string, box: Box) => {
  const frameWidth = 180, frameHeight = 320;
  const run = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', at.toFixed(3), '-i', video, '-frames:v', '1', '-vf', 'scale=180:320', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 16 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(String(run.stderr || 'ffmpeg frame extraction failed'));
  const left = Math.max(0, Math.floor(box.x * frameWidth));
  const right = Math.min(frameWidth, Math.ceil((box.x + box.width) * frameWidth));
  const top = Math.max(0, Math.floor(box.y * frameHeight));
  const bottom = Math.min(frameHeight, Math.ceil((box.y + box.height) * frameHeight));
  let yellow = 0, orange = 0, blue = 0;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const offset = (y * frameWidth + x) * 3;
    const r = run.stdout[offset]!, g = run.stdout[offset + 1]!, b = run.stdout[offset + 2]!;
    const isYellow = r > 190 && g > 145 && b < 135;
    const isOrange = r > 175 && g > 45 && g < 150 && b < 100;
    const isBlue = b > 150 && g > 125 && r < 210;
    if (isYellow) yellow++;
    if (isOrange) orange++;
    if (isBlue) blue++;
  }
  const passed = kind === 'cta' ? blue >= 8 && yellow >= 8 : kind === 'urgency' ? orange >= 12 : yellow >= 12;
  return { passed, yellow, orange, blue, sampleRect: { left, top, right, bottom } };
};
const assetEvidence = events.map((event: any) => {
  const spanSeconds = (event.endMs - event.startMs) / 1_000;
  const samples = [.1, .3, .5, .7, .9].map(position => {
    const at = Math.min(duration - .05, Math.max(.05, event.startMs / 1_000 + spanSeconds * position));
    const evidence = chromaEvidence(at, event.assetKind, event.layout.asset);
    const score = event.assetKind === 'cta' ? Math.min(evidence.yellow, evidence.blue)
      : event.assetKind === 'urgency' ? evidence.orange : evidence.yellow;
    return { position, at: Number(at.toFixed(3)), score, ...evidence };
  });
  const best = samples.reduce((left, right) => right.score > left.score ? right : left);
  const passed = samples.some(sample => sample.passed);
  if (!passed) failures.push({ check: 'original_asset_visible', detail: `${event.id} (${assetByKind[event.assetKind]}) has insufficient asset-specific pixels in all five samples inside its asset rectangle; best at ${best.at.toFixed(3)}s (yellow=${best.yellow}, orange=${best.orange}, blue=${best.blue})` });
  return { eventId: event.id, assetKind: event.assetKind, file: assetByKind[event.assetKind], passed, bestEvidence: best, samples };
});

const assetDir = new URL('../assets/reference/emphasis/v1/', import.meta.url);
const cacheSourceHash = crypto.createHash('sha256').update([
  fs.readFileSync(new URL('../desktop/remotion-overlay/root.tsx', import.meta.url)),
  fs.readFileSync(new URL('../desktop/remotion-overlay/semantic-assets.tsx', import.meta.url)),
  ...Object.values(assetByKind).sort().map(file => fs.readFileSync(new URL(file, assetDir))),
].map(bytes => crypto.createHash('sha256').update(bytes).digest('hex')).join(':')).digest('hex').slice(0, 16);
const cacheSignature = crypto.createHash('sha256').update(JSON.stringify({ rendererVersion: RENDERER_VERSION, cacheSourceHash, width: Math.round(width / 2), height: Math.round(height / 2), duration, fps: 15, profile: plan.profile, events })).digest('hex');
const previousPath = value('--previous-report');
if (previousPath) {
  const previous = JSON.parse(fs.readFileSync(path.resolve(previousPath), 'utf8'));
  const inputsChanged = previous.cache?.inputHash !== crypto.createHash('sha256').update(JSON.stringify({ plan: manifest.emphasisPlan, style, cues })).digest('hex');
  if (inputsChanged && previous.cache?.signature === cacheSignature) failures.push({ check: 'cache_version_change', detail: 'inputs changed but overlay cache signature did not' });
}
const bestEvidenceTimes = assetEvidence.map((evidence: any) => evidence.bestEvidence.at);
const wordEvidenceTimes = spoken.flatMap((cue: any) => {
  const words = Array.isArray(cue?.words) ? cue.words : [];
  const word = words[Math.floor(words.length / 2)];
  if (!word) return [];
  const start = Number.isFinite(Number(word.startMs)) ? Number(word.startMs) / 1_000 : Number(word.start);
  const end = Number.isFinite(Number(word.endMs)) ? Number(word.endMs) / 1_000 : Number(word.end);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? [(start + end) / 2] : [];
});
const frameTimes = [...new Set([...events.flatMap((event: any) => [event.startMs / 1_000 + .12, (event.startMs + event.endMs) / 2_000, event.endMs / 1_000 - .12]), ...bestEvidenceTimes, ...wordEvidenceTimes]
  .map(value => Math.max(.05, Math.min(duration - .05, Number(value.toFixed(3))))))].sort((a, b) => a - b);
const extractDir = value('--extract-dir');
if (extractDir) {
  fs.mkdirSync(path.resolve(extractDir), { recursive: true });
  frameTimes.forEach((at, index) => {
    const output = path.join(path.resolve(extractDir), `${String(index + 1).padStart(2, '0')}-${at.toFixed(3)}s.jpg`);
    const run = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', at.toFixed(3), '-i', video, '-frames:v', '1', '-q:v', '2', '-y', output]);
    if (run.status !== 0) failures.push({ check: 'frame_extraction', detail: `${at}s: ${String(run.stderr)}` });
  });
}
const inputHash = crypto.createHash('sha256').update(JSON.stringify({ plan: manifest.emphasisPlan, style, cues })).digest('hex');
const report = { schemaVersion: 'studio-emphasis-output-acceptance.v1', passed: failures.length === 0, manifest: path.resolve(manifestPath), video,
  subtitle: { fontSize, cueCount: normalizedCues.length, maxLines: 2, maxUnitsPerLine,
    timedWordCount: timedWords.length, wordHighlightCount: wordHighlightDialogues.length, dialogueCount: subtitleDialogues.length,
    generatedDialogueUnique: new Set(dialogueKeys).size === dialogueKeys.length, sourceHasBurnedCaptions }, overlay: { eventCount: events.length, assetEvidence },
  cache: { rendererVersion: RENDERER_VERSION, sourceHash: cacheSourceHash, signature: cacheSignature, inputHash }, frameTimes, failures };
const reportPath = value('--report');
if (reportPath) fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
