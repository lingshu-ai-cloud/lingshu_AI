import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const root = process.cwd();
const assets = path.join(root, 'assets/reference/emphasis/v1');
const outputDir = path.join(root, 'desktop/remotion-overlay');
const files = ['burst-rays-yellow-static.png', 'burst-rays-yellow.gif', 'emphasis-rays-yellow.gif', 'lightning-orange.gif', 'megaphone-blue-yellow.gif'];
const crops: Record<string, unknown> = {};
const playback: Record<string, unknown> = {};

for (const name of files) {
  const image = sharp(path.join(assets, name), { animated: true });
  const metadata = await image.metadata();
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pages = metadata.pages || 1;
  const pageHeight = metadata.pageHeight || Math.floor(info.height / pages);
  const width = info.width;
  let left = width, top = pageHeight, right = 0, bottom = 0;
  const counts: number[] = [];
  for (let page = 0; page < pages; page++) {
    let count = 0;
    for (let y = 0; y < pageHeight; y++) for (let x = 0; x < width; x++) {
      const alpha = data[((page * pageHeight + y) * width + x) * info.channels + 3]!;
      if (alpha <= 8) continue;
      count++; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
    counts.push(count);
  }
  if (!counts.some(Boolean)) { left = 0; top = 0; right = width; bottom = pageHeight; }
  crops[name] = {
    sourceWidth: width, sourceHeight: pageHeight, frames: pages, left, top, right, bottom,
    x: Number((left / width).toFixed(6)), y: Number((top / pageHeight).toFixed(6)),
    width: Number(((right - left) / width).toFixed(6)), height: Number(((bottom - top) / pageHeight).toFixed(6)),
  };
  if (name.endsWith('.gif')) {
    const nonempty = counts.flatMap((count, index) => count ? [index] : []);
    const start = nonempty[0] ?? 0, end = nonempty.at(-1) ?? pages - 1;
    const delays = metadata.delay?.length ? metadata.delay : Array(pages).fill(100);
    // Prefer the most opaque frame from the latter half of the useful range.
    // This preserves the visual's resolved state instead of freezing an early
    // anticipation frame or trusting a potentially transparent final frame.
    const stableStart = Math.max(start, Math.floor(start + (end - start) * .55));
    let holdFrame = stableStart;
    for (let frame = stableStart + 1; frame <= end; frame++) if (counts[frame]! > counts[holdFrame]!) holdFrame = frame;
    const holdAsset = `hold-${name.replace(/\.gif$/i, '')}.png`;
    await sharp(path.join(assets, name), { animated: true, page: holdFrame, pages: 1 }).png().toFile(path.join(assets, holdAsset));
    playback[name] = {
      frameCount: pages, frameDelayMs: delays[start] || 100, effectiveStartFrame: start, effectiveEndFrame: end,
      alphaCoverage: counts.map(count => Number((count / (width * pageHeight)).toFixed(6))),
      holdFrame, holdAsset, durationMs: delays.slice(start, end + 1).reduce((sum, value) => sum + value, 0),
    };
  }
}

fs.writeFileSync(path.join(outputDir, 'asset-crops.json'), `${JSON.stringify({ schemaVersion: 'emphasis-asset-crops.v1', assets: crops }, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'asset-playback.json'), `${JSON.stringify({ schemaVersion: 'emphasis-asset-playback.v1', assets: playback }, null, 2)}\n`);
console.log(`generated emphasis crop/playback metadata for ${files.length} assets`);
