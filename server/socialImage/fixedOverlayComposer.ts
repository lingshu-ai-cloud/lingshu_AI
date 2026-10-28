import sharp from 'sharp';
import type { SocialImageReplicationRecipe } from '../../shared/contracts/socialImageCreation.js';
import { socialImageRectOverlapRatio } from '../../shared/contracts/socialImageLayerGraph.js';
import { connectedBorderToAlpha } from './layerRenderer.js';
import { isVerifiedTransparentProductCutout } from '../lib/productIdentityPreparation.js';
import { normalizeSocialImageReferenceLayerBlueprints } from './socialImageTask.js';
import { isSocialImageBuyerPoster, socialImageBuyerLayout, socialImageBuyerOverlaySvg } from './socialImageBuyerOverlay.js';
import type { BuyerCopyBacking, BuyerPosterTone } from './socialImageBuyerOverlay.js';

/** Pick a broad color family from the selected product pixels, not from the benchmark brand. */
export async function buyerPosterTone(bytes: Buffer): Promise<BuyerPosterTone> {
  const { data } = await sharp(bytes).rotate().resize(80, 80, { fit: 'inside' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const scores = { cool: 0, warm: 0, botanical: 0 };
  for (let index = 0; index < data.length; index += 3) {
    const r = data[index]! / 255, g = data[index + 1]! / 255, b = data[index + 2]! / 255;
    const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
    if (delta < .16 || max < .2 || max > .95) continue;
    const sector = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    const hue = (sector * 60 + 360) % 360;
    if (hue >= 300 || hue < 40) scores.warm += delta;
    else if (hue >= 40 && hue < 170) scores.botanical += delta;
    else scores.cool += delta;
  }
  const winner = Object.entries(scores).sort((left, right) => right[1] - left[1])[0];
  return winner && winner[1] > 0 ? winner[0] as BuyerPosterTone : 'cool';
}

type PosterCopy = {
  headline?: string;
  subheadline?: string;
  originBadge?: string;
  cta?: string;
  sellingPoints?: string[];
  bottomBar?: string[];
};

type ReferenceTextRegion = 'top_left' | undefined;

const escapeXml = (value: string) => String(value || '').replace(/[<>&"']/g, character => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
}[character]!));

function region(recipe: SocialImageReplicationRecipe | undefined, id: string, fallback: { x: number; y: number; width: number; height: number }) {
  const value = recipe?.layoutRegions.find(item => item.id === id);
  return value || fallback;
}

function wrapCopy(value: string, maxCharacters: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    const words = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(paragraph)
      ? [...paragraph.trim()] : paragraph.trim().split(/\s+/).filter(Boolean);
    const joiner = words.length && words[0]!.length === 1 ? '' : ' ';
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line}${joiner}${word}` : word;
      if (candidate.length <= maxCharacters) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      if (word.length <= maxCharacters) { line = word; continue; }
      for (let index = 0; index < word.length; index += maxCharacters) {
        const chunk = word.slice(index, index + maxCharacters);
        if (chunk.length === maxCharacters) lines.push(chunk);
        else line = chunk;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function copyOverlaySvg(width: number, height: number, poster: PosterCopy, recipe?: SocialImageReplicationRecipe,
  referenceTextRegion?: ReferenceTextRegion, highContrast = false): Buffer {
  const headlineZone = referenceTextRegion === 'top_left'
    ? { x: .045, y: .045, width: .39, height: .30 }
    : region(recipe, 'headline-zone', { x: .06, y: .055, width: .88, height: .27 });
  const bottom = region(recipe, 'bottom-bar', { x: .05, y: .89, width: .9, height: .075 });
  const badge = region(recipe, 'corner-badge', { x: .055, y: .035, width: .28, height: .07 });
  const headlineBaseSize = Math.max(28, Math.round(height * (referenceTextRegion === 'top_left' ? .043 : .053)));
  const subBaseSize = Math.max(17, Math.round(height * (referenceTextRegion === 'top_left' ? .026 : .024)));
  const badgeSize = Math.max(15, Math.round(height * .018));
  const x = Math.round(headlineZone.x * width);
  const y = Math.round(headlineZone.y * height);
  let headlineSize = headlineBaseSize, subSize = subBaseSize;
  let headlineLines: string[] = [], subheadlineLines: string[] = [];
  let headlineLineHeight = 0, subLineHeight = 0, copyHeight = Infinity;
  for (let scale = 1; scale >= .35; scale -= .05) {
    headlineSize = Math.max(14, Math.round(headlineBaseSize * scale));
    subSize = Math.max(12, Math.round(subBaseSize * scale));
    headlineLines = wrapCopy(poster.headline || '', Math.max(5, Math.floor(headlineZone.width * width / (headlineSize * .68))));
    subheadlineLines = wrapCopy(poster.subheadline || '', Math.max(5, Math.floor(headlineZone.width * width / (subSize * .55))));
    headlineLineHeight = Math.round(headlineSize * 1.12);
    subLineHeight = Math.round(subSize * 1.32);
    copyHeight = headlineLines.length * headlineLineHeight + (subheadlineLines.length ? Math.round(subSize * .35)
      + subheadlineLines.length * subLineHeight : 0);
    if (copyHeight <= headlineZone.height * height) break;
  }
  if (copyHeight > headlineZone.height * height) throw new Error('social_image_fixed_copy_overflow');
  const headline = headlineLines.map((line, index) => `<text x="${x}" y="${y + headlineSize + index * headlineLineHeight}" font-family="Arial, PingFang SC, sans-serif" font-size="${headlineSize}" font-weight="800" fill="#fff" filter="url(#shadow)">${escapeXml(line)}</text>`).join('');
  const subTop = y + headlineLines.length * headlineLineHeight + Math.round(subSize * .35);
  const subheadline = subheadlineLines.map((line, index) => `<text x="${x}" y="${subTop + subSize + index * subLineHeight}" font-family="Arial, PingFang SC, sans-serif" font-size="${subSize}" font-weight="${referenceTextRegion === 'top_left' ? 600 : 500}" fill="#fff">${escapeXml(line)}</text>`).join('');
  const originBadge = escapeXml(poster.originBadge || '');
  const cta = escapeXml(poster.cta || '');
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity=".32"/></filter></defs>
    ${highContrast ? `<rect x="${x - 14}" y="${y - 12}" width="${headlineZone.width * width + 28}" height="${Math.min(headlineZone.height * height + 24, copyHeight + 34)}" rx="16" fill="#07121f" fill-opacity=".90"/>` : ''}
    ${originBadge ? `<rect x="${badge.x * width}" y="${badge.y * height}" width="${badge.width * width}" height="${badge.height * height}" rx="${badge.height * height * .25}" fill="rgba(5,20,35,.74)"/><text x="${(badge.x + .018) * width}" y="${(badge.y + badge.height * .66) * height}" font-family="Arial, PingFang SC, sans-serif" font-size="${badgeSize}" font-weight="700" fill="#fff">${originBadge}</text>` : ''}
    ${headline}
    ${referenceTextRegion === 'top_left' && subheadlineLines.length ? `<rect x="${x - 10}" y="${subTop - 4}" width="${headlineZone.width * width + 20}" height="${subheadlineLines.length * subLineHeight + 14}" rx="10" fill="rgba(3,16,23,.76)"/>` : ''}
    ${subheadline}
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

async function softenFramedProductEdges(bytes: Buffer): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(bytes).metadata();
  if (!width || !height) return bytes;
  const inset = Math.max(8, Math.round(Math.min(width, height) * .055));
  const blur = Math.max(5, Math.round(inset * .8));
  const mask = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="feather" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${blur}"/></filter></defs>
    <rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}"
      rx="${inset}" fill="white" filter="url(#feather)"/>
  </svg>`);
  return sharp(bytes).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

/** Preserve an existing alpha channel; it is not evidence that a cutout passed review. */
async function hasTransparentPixels(bytes: Buffer): Promise<boolean> {
  const image = sharp(bytes);
  if (!(await image.metadata()).hasAlpha) return false;
  const stats = await image.stats();
  const alpha = stats.channels.at(-1);
  return Boolean(alpha && alpha.min < 255 && alpha.max > 0);
}

/** Source-photo borders fade to zero; the label and center pixels stay unchanged. */
async function featherBuyerPhotoEdges(bytes: Buffer): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(bytes).metadata();
  if (!width || !height) return bytes;
  const horizontal = Math.max(1, Math.round(width * .15));
  const vertical = Math.max(1, Math.round(height * .12));
  const mask = Buffer.alloc(width * height * 4, 255);
  const ease = (value: number) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const border = Math.min(ease(x / horizontal), ease((width - 1 - x) / horizontal),
      ease(y / vertical), ease((height - 1 - y) / vertical));
    mask[(y * width + x) * 4 + 3] = Math.round(border * 255);
  }
  return sharp(bytes).ensureAlpha().composite([{ input: mask,
    raw: { width, height, channels: 4 }, blend: 'dest-in' }]).png().toBuffer();
}

/** Choose typography backing from the actual copy-zone pixels, not a prompt or SKU. */
async function buyerCopyBacking(scene: Buffer, width: number, height: number,
  repairContrast: boolean): Promise<{ mode: BuyerCopyBacking; color: string }> {
  const left = Math.round(width * .04), top = Math.round(height * .03);
  const { data } = await sharp(scene).extract({ left, top,
    width: Math.round(width * .40), height: Math.round(height * .45) })
    .resize(32, 32).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const brightness: number[] = [];
  const channels: number[][] = [[], [], []];
  let edgeSum = 0, edgeCount = 0;
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
    const i = (y * 32 + x) * 3;
    for (let channel = 0; channel < 3; channel += 1) channels[channel]!.push(data[i + channel]!);
    const value = (.2126 * data[i]! + .7152 * data[i + 1]! + .0722 * data[i + 2]!) / 255;
    brightness.push(value);
    if (x > 0) {
      const previous = i - 3;
      edgeSum += Math.abs(value - (.2126 * data[previous]! + .7152 * data[previous + 1]!
        + .0722 * data[previous + 2]!) / 255);
      edgeCount += 1;
    }
  }
  const tenth = brightness.sort((a, b) => a - b)[Math.floor(brightness.length * .1)]!;
  const detail = edgeSum / Math.max(1, edgeCount);
  const median = channels.map(channel => channel.sort((a, b) => a - b)[Math.floor(channel.length / 2)]!);
  const level = (.2126 * median[0]! + .7152 * median[1]! + .0722 * median[2]!);
  const lift = level >= 205 ? 0 : (205 - level) / (255 - level);
  const color = `#${median.map(value => Math.round(value + (255 - value) * lift).toString(16).padStart(2, '0')).join('')}`;
  const mode: BuyerCopyBacking = repairContrast ? 'local'
    : tenth >= .62 && detail <= .075 ? 'none'
      : tenth >= .38 && detail <= .13 ? 'local' : 'solid';
  return { mode, color };
}

/** Keeps identity and UI pixel-identical across GIF frames. */
export async function composeFixedSocialLayers(input: {
  background: Buffer;
  products: Buffer[];
  poster: PosterCopy;
  width: number;
  height: number;
  recipe?: SocialImageReplicationRecipe;
  productTreatment?: 'cutout' | 'framed_source' | 'integrated_scene';
  referenceTextRegion?: ReferenceTextRegion;
  repairContrast?: boolean;
}): Promise<Buffer> {
  const { width, height } = input;
  // A caller selecting the cutout route must supply an already separated
  // transparent asset. Never turn an opaque product photo into a purported
  // cutout by border removal or rectangular feathering at composition time.
  if (input.productTreatment === 'cutout' && (!input.products.length
    || !(await Promise.all(input.products.map(isVerifiedTransparentProductCutout))).every(Boolean))) {
    throw new Error('social_image_reviewed_product_cutout_required');
  }
  if (input.productTreatment === 'integrated_scene') {
    const overlay = isSocialImageBuyerPoster(input.poster)
      ? socialImageBuyerOverlaySvg(width, height, input.poster, Boolean(input.repairContrast),
        await buyerPosterTone(input.products[0] || input.background))
      : copyOverlaySvg(width, height, input.poster, input.recipe, input.referenceTextRegion, input.repairContrast);
    return sharp(input.background).rotate().resize(width, height, { fit: 'cover', position: 'attention' })
      .composite([{ input: overlay, left: 0, top: 0 }])
      .png({ compressionLevel: 9 }).toBuffer();
  }
  if (isSocialImageBuyerPoster(input.poster) && ['framed_source', 'cutout'].includes(input.productTreatment || '')) {
    const source = input.products[0];
    if (!source) throw new Error('social_image_buyer_product_source_missing');
    const scene = await sharp(input.background).rotate().resize(width, height,
      { fit: 'cover', position: 'attention' }).png().toBuffer();
    const layout = socialImageBuyerLayout(input.poster);
    const heroWidth = Math.round(width * Math.min(.55, .97 - layout.copyRight - .01));
    const heroHeight = Math.round(height * .58);
    const fitted = await sharp(source).rotate().resize(heroWidth, heroHeight, { fit: 'inside' }).png().toBuffer();
    const hero = input.productTreatment === 'cutout' || await hasTransparentPixels(source)
      ? fitted : await featherBuyerPhotoEdges(fitted);
    const size = await sharp(hero).metadata();
    const left = Math.max(Math.round(width * (layout.copyRight + .01)),
      Math.min(width - (size.width || heroWidth),
        Math.round(width * layout.heroCenter - (size.width || heroWidth) / 2)));
    const top = Math.round(height * .53 - (size.height || heroHeight) / 2);
    const withProduct = await sharp(scene).composite([{ input: hero, left, top }]).png().toBuffer();
    const backing = await buyerCopyBacking(scene, width, height, Boolean(input.repairContrast));
    const overlay = socialImageBuyerOverlaySvg(width, height, input.poster,
      Boolean(input.repairContrast), await buyerPosterTone(source), backing.mode, backing.color);
    return sharp(withProduct).composite([{ input: overlay, left: 0, top: 0 }])
      .png({ compressionLevel: 9 }).toBuffer();
  }
  const stage = input.referenceTextRegion === 'top_left'
    ? { x: .46, y: .32, width: .50, height: .54 }
    : region(input.recipe, 'product-stage', { x: .08, y: .36, width: .84, height: .50 });
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
    const transparent = input.productTreatment === 'framed_source' || input.productTreatment === 'cutout'
      ? input.products[index]!
      : await connectedBorderToAlpha(input.products[index]!);
    const productWidth = Math.round(Math.min(slotWidth * 1.18, stage.width * width * (input.referenceTextRegion === 'top_left' ? .65
      : input.productTreatment === 'framed_source' ? .85 : .7)));
    const productHeight = Math.round(stage.height * height);
    // Keep the source aspect ratio. A square product photo in a tall slot used
    // to acquire large synthetic white bars above and below the package.
    const fitted = await sharp(transparent).resize(productWidth, productHeight, { fit: 'inside' }).png().toBuffer();
    const rendered = input.productTreatment === 'framed_source' && !await hasTransparentPixels(input.products[index]!)
      ? await softenFramedProductEdges(fitted) : fitted;
    const renderedSize = await sharp(rendered).metadata();
    composites.push({
      input: rendered,
      left: Math.round(stage.x * width + slotWidth * index + (slotWidth - (renderedSize.width || productWidth)) / 2),
      top: Math.round(stage.y * height + (productHeight - (renderedSize.height || productHeight)) / 2),
      zIndex: zFor('product', 30),
    });
  }
  composites.push({ input: copyOverlaySvg(width, height, input.poster, input.recipe, input.referenceTextRegion, input.repairContrast), left: 0, top: 0, zIndex: zFor('text', 40) });
  return sharp(input.background).rotate().resize(width, height, { fit: 'cover', position: 'attention' })
    .composite(composites.sort((a, b) => a.zIndex - b.zIndex).map(({ zIndex: _zIndex, ...item }) => item)).png({ compressionLevel: 9 }).toBuffer();
}
