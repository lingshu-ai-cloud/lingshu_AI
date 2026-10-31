import type { SocialImageReplicationRecipe } from '../../shared/contracts/socialImageCreation.js';
import { socialImageBuyerLayout, socialImageBuyerProductStage, type BuyerPosterCopy,
  type BuyerPosterTone } from './socialImageBuyerOverlay.js';
import type { ImageReferenceStyleElement } from '../../shared/contracts/imageReferenceProductionLabel.js';

/** Give the image model room to unify the product and scene; typography stays deterministic. */
export function buildSocialImagePosterPlatePrompt(input: {
  ratio: string;
  recipe?: SocialImageReplicationRecipe;
  buyerPoster?: BuyerPosterCopy;
  tone?: BuyerPosterTone;
  transferableStyle?: ImageReferenceStyleElement[];
  styleStrategy?: 'reference_emulation.v1' | 'advertising.v1' | 'advertising_fallback.v1';
  referencePalette?: string[];
  sceneDirection?: string;
  sceneVariant?: number;
}): string {
  const emulation = input.styleStrategy === 'reference_emulation.v1';
  const layout = input.buyerPoster ? socialImageBuyerLayout(input.buyerPoster) : null;
  const buyerStage = input.buyerPoster ? socialImageBuyerProductStage(input.buyerPoster, input.sceneVariant) : null;
  const productRegion = input.recipe?.layoutRegions.find(region => region.id === 'product-stage');
  const headlineRegion = input.recipe?.layoutRegions.find(region => region.id === 'headline-zone');
  const regionText = (region: typeof productRegion) => region
    ? `${Math.round(region.x * 100)}% left, ${Math.round(region.y * 100)}% top, ${Math.round(region.width * 100)}% wide and ${Math.round(region.height * 100)}% tall`
    : '';
  const palette = (input.referencePalette || input.recipe?.palette || [])
    .filter(color => /^#[0-9a-f]{6}$/i.test(color)).slice(0, 3);
  const descriptions: Record<ImageReferenceStyleElement,string> = { soft_light:'soft diffuse light', hard_light:'directional hard light', high_key:'bright high-key exposure', low_key:'restrained low-key exposure', centered:'centered composition', asymmetric:'asymmetric composition', close_up:'close-up framing', minimal:'minimal visual density', layered:'layered visual depth' };
  const transferable = (input.transferableStyle || []).filter(item => Object.hasOwn(descriptions,item)).map(item => descriptions[item]);
  return [
    `Create one polished ${input.ratio} ${emulation ? 'reference-inspired editorial or lifestyle' : 'product-photography'} BACKGROUND PLATE ONLY. The real enterprise product photo and approved copy will be composited later.`,
    'Do not draw any product, container, box, package, hand, person, logo, letters, numbers, text, sign, badge, CTA, or interface element. Keep the entire product stage empty.',
    layout && buyerStage ? `Leave a quiet, naturally light area in the left ${Math.round(layout.copyRight * 100)}% for dark buyer copy. Leave the product stage near ${Math.round(buyerStage.centerX * 100)}% width empty for our real product photo, centered vertically around ${Math.round(buyerStage.centerY * 100)}% height; keep the outer top-right clear for a badge and the bottom 16% for a footer.` : '',
    emulation && productRegion && headlineRegion ? `Follow the measured reference composition: reserve the product stage at ${regionText(productRegion)} and a readable headline zone at ${regionText(headlineRegion)}. Keep these zones separate. Recreate only the spatial rhythm; do not reproduce the original image, brand, product, words or people.` : '',
    transferable.length ? `Transfer only these general reference qualities where compatible with the product: ${transferable.join(', ')}. Product tone and truthful identity take priority. Do not invent people, factories, events or evidence.` : '',
    palette.length ? `The reference's measured color mood is ${palette.join(', ')}; adapt it to the product without copying the reference pixels.` : '',
    input.sceneDirection ? `Scene variation for this task: ${input.sceneDirection}.` : '',
    emulation
      ? `Build an original scene around the measured spatial hierarchy and transferable light qualities. Keep a ${input.tone || 'neutral'} product-compatible color family and natural contact-shadow space for the real product. Do not add advertising badges, information cards or a fixed CTA area. No broad fog, fade, white wash or text backing.`
      : `Use a ${input.tone || 'neutral'} product-compatible color family, a detailed setting and surface with natural light, depth, and contact-shadow space. No broad fog, fade, white wash, or text backing; the compositor decides whether localized contrast is needed.`,
  ].filter(Boolean).join('\n\n');
}
