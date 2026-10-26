import sharp from 'sharp';
import type { SocialImageReplicationRecipe } from '../../shared/contracts/socialImageCreation.js';
import { socialImageRectOverlapRatio } from '../../shared/contracts/socialImageLayerGraph.js';
import { connectedBorderToAlpha } from './layerRenderer.js';
import { normalizeSocialImageReferenceLayerBlueprints } from './socialImageTask.js';

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

function referenceMaskSvg(width: number, height: number, mask: NonNullable<SocialImageReplicationRecipe['referenceLayerBlueprints']>[number]['masks'][number]): Buffer {
  const color = mask.color || '#07121f';
  const blur = Math.round(Math.max(0, Math.min(1, mask.feather || 0)) * Math.min(width, height) * .08);
  const filter = blur ? `<filter id="soft"><feGaussianBlur stdDeviation="${blur}"/></filter>` : '';
  const filterRef = blur ? ' filter="url(#soft)"' : '';
  let shape = '';
  if (mask.shape === 'ellipse') shape = `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${color}" fill-opacity="${mask.opacity}"${filterRef}/>`;
  else if (mask.shape === 'polygon' && mask.points?.length) {
    const points = mask.points.map(point => `${Math.round(((point.x - mask.bounds.x) / mask.bounds.width) * width)},${Math.round(((point.y - mask.bounds.y) / mask.bounds.height) * height)}`).join(' ');
    shape = `<polygon points="${points}" fill="${color}" fill-opacity="${mask.opacity}"${filterRef}/>`;
  } else if (mask.shape === 'linear_gradient') {
    const radians = ((mask.angle || 0) * Math.PI) / 180, dx = Math.cos(radians), dy = Math.sin(radians);
    shape = `<defs><linearGradient id="fade" x1="${50 - dx * 50}%" y1="${50 - dy * 50}%" x2="${50 + dx * 50}%" y2="${50 + dy * 50}%"><stop stop-color="${color}" stop-opacity="${mask.opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#fade)"${filterRef}/>`;
  } else {
    const radius = mask.shape === 'rounded_rectangle' ? Math.round(Math.min(width, height) * Math.max(0, Math.min(1, mask.cornerRadius ?? .12))) : 0;
    shape = `<rect width="100%" height="100%" rx="${radius}" fill="${color}" fill-opacity="${mask.opacity}"${filterRef}/>`;
  }
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${filter}${shape}</svg>`);
}

/** Keeps identity and UI pixel-identical across GIF frames. */
export async function composeFixedSocialLayers(input: {
  background: Buffer;
  products: Buffer[];
  poster: PosterCopy;
  width: number;
  height: number;
  recipe?: SocialImageReplicationRecipe;
  productTreatment?: 'cutout' | 'framed_source';
}): Promise<Buffer> {
  const { width, height } = input;
  const stage = region(input.recipe, 'product-stage', { x: .08, y: .36, width: .84, height: .50 });
  const productCount = Math.max(1, input.products.length);
  const slotWidth = stage.width * width / productCount;
  const blueprint = normalizeSocialImageReferenceLayerBlueprints(input.recipe?.referenceLayerBlueprints)[0];
  const zFor = (role: 'mask' | 'product' | 'text', fallback: number) => blueprint?.layers.find(layer => layer.role === role)?.zIndex ?? fallback;
  const productZ = zFor('product', 30);
  for (const mask of blueprint?.masks || []) {
    if (mask.zIndex > productZ && socialImageRectOverlapRatio(stage, mask.bounds) > .12) {
      throw new Error(`前景蒙版 ${mask.id} 与产品重叠超过 12%`);
    }
  }
  const composites: Array<{ input: Buffer; left: number; top: number; zIndex: number }> = [];
  for (const mask of blueprint?.masks || []) {
    const maskWidth = Math.max(1, Math.round(mask.bounds.width * width));
    const maskHeight = Math.max(1, Math.round(mask.bounds.height * height));
    composites.push({ input: referenceMaskSvg(maskWidth, maskHeight, mask), left: Math.round(mask.bounds.x * width), top: Math.round(mask.bounds.y * height), zIndex: mask.zIndex });
  }
  for (let index = 0; index < input.products.length; index += 1) {
    const transparent = input.productTreatment === 'framed_source'
      ? input.products[index]!
      : await connectedBorderToAlpha(input.products[index]!);
    const productWidth = Math.round(Math.min(slotWidth * 1.18, stage.width * width * .7));
    const productHeight = Math.round(stage.height * height);
    const rendered = await sharp(transparent).resize(productWidth, productHeight, {
      fit: 'contain', background: input.productTreatment === 'framed_source'
        ? { r: 255, g: 255, b: 255, alpha: 255 } : { r: 0, g: 0, b: 0, alpha: 0 },
    }).png().toBuffer();
    composites.push({
      input: rendered,
      left: Math.round(stage.x * width + slotWidth * index + (slotWidth - productWidth) / 2),
      top: Math.round(stage.y * height),
      zIndex: zFor('product', 30),
    });
  }
  composites.push({ input: copyOverlaySvg(width, height, input.poster, input.recipe), left: 0, top: 0, zIndex: zFor('text', 40) });
  return sharp(input.background).rotate().resize(width, height, { fit: 'cover', position: 'attention' })
    .composite(composites.sort((a, b) => a.zIndex - b.zIndex).map(({ zIndex: _zIndex, ...item }) => item)).png({ compressionLevel: 9 }).toBuffer();
}
