import sharp, { type Metadata } from 'sharp';

export interface SocialImageCanvasSpec {
  width: number;
  height: number;
  aspectRatio: number;
  providerRatio: '1:1' | '4:5' | '16:9';
}
function orientedDimensions(metadata: Metadata): { width: number; height: number } | null {
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null;
  return metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

function providerRatioFor(width: number, height: number): SocialImageCanvasSpec['providerRatio'] {
  const ratio = width / height;
  if (ratio < 0.92) return '4:5';
  if (ratio > 1.08) return '16:9';
  return '1:1';
}

/** The benchmark canvas, not a UI selection, is authoritative for replication. */
export async function socialImageCanvasFromBenchmark(bytes: Buffer): Promise<SocialImageCanvasSpec | null> {
  const dimensions = orientedDimensions(await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata());
  if (!dimensions) return null;
  const { width, height } = dimensions;
  if (width > 4096 || height > 4096 || width * height > 16_000_000) return null;
  return { width, height, aspectRatio: width / height, providerRatio: providerRatioFor(width, height) };
}

/**
 * Providers expose only a few coarse canvas sizes. The persisted deliverable is
 * therefore normalized after synthesis so its pixel ratio is exactly the same
 * as the benchmark, rather than merely looking portrait/square/landscape.
 */
export async function conformSocialImageToCanvas(bytes: Buffer, canvas: SocialImageCanvasSpec): Promise<Buffer> {
  return sharp(bytes, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(canvas.width, canvas.height, { fit: 'cover', position: 'attention' })
    .png()
    .toBuffer();
}
