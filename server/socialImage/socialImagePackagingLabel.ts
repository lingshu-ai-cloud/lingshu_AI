import sharp from 'sharp';
import { recognizeProductImageLocally } from '../lib/localProductOcr.js';

/** OCR is only a label hint from the bound product pixels, never a new business fact. */
export async function socialImagePackagingLabelHint(bytes: Buffer): Promise<string> {
  try {
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height) return '';
    const left = Math.floor(metadata.width * .24), top = Math.floor(metadata.height * .23);
    const width = Math.max(1, Math.floor(metadata.width * .52));
    const height = Math.max(1, Math.floor(metadata.height * .40));
    const crop = await sharp(bytes).extract({ left, top, width, height })
      .resize({ width: 1200 }).png().toBuffer();
    const observed = await recognizeProductImageLocally({ bytes: crop, mimeType: 'image/png' });
    return observed.split(/\r?\n/).map(line => line.replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim())
      .filter(line => line.length >= 4 && line.length <= 60).slice(0, 8).join(' ').slice(0, 240);
  } catch {
    return '';
  }
}

/** A new English product title cannot silently contradict a readable package label. */
export function socialImageEnglishTitleMatchesPackaging(headline: string, packagingHint: string): boolean {
  const phrase = packagingHint.match(/\bcleansing\s+([a-z]{4,20})\b/i);
  if (!phrase) return true;
  const category = phrase[1]!.toLowerCase();
  const headlinePhrase = headline.match(/\bcleansing\s+([a-z]{4,20})\b/i);
  return !headlinePhrase || headlinePhrase[1]!.toLowerCase() === category;
}
