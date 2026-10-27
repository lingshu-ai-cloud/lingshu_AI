import type { SocialImageReplicationRecipe } from '../../shared/contracts/socialImageCreation.js';
import { socialImageBuyerLayout, type BuyerPosterCopy, type BuyerPosterTone } from './socialImageBuyerOverlay.js';

/** Give the image model room to unify the product and scene; typography stays deterministic. */
export function buildSocialImagePosterPlatePrompt(input: {
  ratio: string;
  recipe?: SocialImageReplicationRecipe;
  buyerPoster?: BuyerPosterCopy;
  tone?: BuyerPosterTone;
}): string {
  const layout = input.buyerPoster ? socialImageBuyerLayout(input.buyerPoster) : null;
  return [
    `Create one polished ${input.ratio} product-photography BACKGROUND PLATE ONLY. The enterprise product photo, its original label, all copy, badge, and footer will be composited later.`,
    'Do not draw any product, container, box, package, hand, person, logo, letters, numbers, text, sign, badge, CTA, or interface element. Keep the entire product stage empty.',
    layout ? `Leave a quiet, naturally light area in the left ${Math.round(layout.copyRight * 100)}% for dark buyer copy. Leave the central-right stage near ${Math.round(layout.heroCenter * 100)}% width empty for our real product photo; keep the outer top-right clear for a badge and the bottom 16% for a footer.` : '',
    `Scene rhythm: ${input.recipe?.contentArchetype || 'premium product photography'}. Use a ${input.tone || 'neutral'} color family, a detailed setting and surface with natural light, depth, and contact-shadow space. No broad fog, fade, white wash, or text backing; the compositor decides whether localized contrast is needed.`,
  ].filter(Boolean).join('\n\n');
}
