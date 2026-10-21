import sharp from 'sharp';
import type { SocialImageReplicationRecipe } from '../../shared/contracts/socialImageCreation.js';
import { connectedBorderToAlpha } from './layerRenderer.js';

type PosterCopy = {
  headline?: string;
  subheadline?: string;
  originBadge?: string;
  cta?: string;
};

const escapeXml = (value: string) => String(value || '').replace(/[<>&"']/g, character => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
}[character]!));

function region(recipe: SocialImageReplicationRecipe | undefined, id: string, fallback: { x: number; y: number; width: number; height: number }) {
  const value = recipe?.layoutRegions.find(item => item.id === id);
  return value || fallback;
}

function copyOverlaySvg(width: number, height: number, poster: PosterCopy, recipe?: SocialImageReplicationRecipe): Buffer {
  const headlineZone = region(recipe, 'headline-zone', { x: .06, y: .055, width: .88, height: .27 });
  const bottom = region(recipe, 'bottom-bar', { x: .05, y: .89, width: .9, height: .075 });
  const badge = region(recipe, 'corner-badge', { x: .055, y: .035, width: .28, height: .07 });
  const headlineSize = Math.max(28, Math.round(height * .053));
  const subSize = Math.max(17, Math.round(height * .024));
  const badgeSize = Math.max(15, Math.round(height * .018));
  const x = Math.round(headlineZone.x * width);
  const y = Math.round(headlineZone.y * height);
  const headline = escapeXml(poster.headline || '');
  const subheadline = escapeXml(poster.subheadline || '');
  const originBadge = escapeXml(poster.originBadge || '');
  const cta = escapeXml(poster.cta || '');
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity=".32"/></filter></defs>
    ${originBadge ? `<rect x="${badge.x * width}" y="${badge.y * height}" width="${badge.width * width}" height="${badge.height * height}" rx="${badge.height * height * .25}" fill="rgba(5,20,35,.74)"/><text x="${(badge.x + .018) * width}" y="${(badge.y + badge.height * .66) * height}" font-family="Arial, PingFang SC, sans-serif" font-size="${badgeSize}" font-weight="700" fill="#fff">${originBadge}</text>` : ''}
    ${headline ? `<text x="${x}" y="${y + headlineSize}" font-family="Arial, PingFang SC, sans-serif" font-size="${headlineSize}" font-weight="800" fill="#fff" filter="url(#shadow)">${headline}</text>` : ''}
    ${subheadline ? `<text x="${x}" y="${y + headlineSize + subSize * 1.75}" font-family="Arial, PingFang SC, sans-serif" font-size="${subSize}" font-weight="500" fill="#fff" filter="url(#shadow)">${subheadline}</text>` : ''}
    ${cta ? `<rect x="${bottom.x * width}" y="${bottom.y * height}" width="${bottom.width * width}" height="${bottom.height * height}" rx="${bottom.height * height / 2}" fill="rgba(5,20,35,.76)"/><text x="${(bottom.x + bottom.width / 2) * width}" y="${(bottom.y + bottom.height * .64) * height}" text-anchor="middle" font-family="Arial, PingFang SC, sans-serif" font-size="${subSize}" font-weight="700" fill="#fff">${cta}</text>` : ''}
  </svg>`);
}

/** Keeps identity and UI pixel-identical across GIF frames. */
export async function composeFixedSocialLayers(input: {
  background: Buffer;
  products: Buffer[];
  poster: PosterCopy;
  width: number;
  height: number;
  recipe?: SocialImageReplicationRecipe;
}): Promise<Buffer> {
  const { width, height } = input;
  const stage = region(input.recipe, 'product-stage', { x: .08, y: .36, width: .84, height: .50 });
  const productCount = Math.max(1, input.products.length);
  const slotWidth = stage.width * width / productCount;
  const composites: Array<{ input: Buffer; left: number; top: number }> = [];
  for (let index = 0; index < input.products.length; index += 1) {
    const transparent = await connectedBorderToAlpha(input.products[index]!);
    const productWidth = Math.round(Math.min(slotWidth * 1.18, stage.width * width * .7));
    const productHeight = Math.round(stage.height * height);
    const rendered = await sharp(transparent).resize(productWidth, productHeight, {
      fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).png().toBuffer();
    composites.push({
      input: rendered,
      left: Math.round(stage.x * width + slotWidth * index + (slotWidth - productWidth) / 2),
      top: Math.round(stage.y * height),
    });
  }
  composites.push({ input: copyOverlaySvg(width, height, input.poster, input.recipe), left: 0, top: 0 });
  return sharp(input.background).rotate().resize(width, height, { fit: 'cover', position: 'attention' })
    .composite(composites).png({ compressionLevel: 9 }).toBuffer();
}
