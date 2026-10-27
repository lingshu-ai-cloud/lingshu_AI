import type { SocialImageReplicationRecipe } from '../../shared/contracts/socialImageCreation.js';
import { socialImageBuyerLayout, type BuyerPosterCopy } from './socialImageBuyerOverlay.js';

/** Give the image model room to unify the product and scene; typography stays deterministic. */
export function buildSocialImagePosterPlatePrompt(input: {
  ratio: string;
  recipe?: SocialImageReplicationRecipe;
  buyerPoster?: BuyerPosterCopy;
}): string {
  const layout = input.buyerPoster ? socialImageBuyerLayout(input.buyerPoster) : null;
  return [
    `Create one polished ${input.ratio} social poster scene. Image 1 is our real product; keep its package shape, color, logo and label faithful. Match the product's lighting, reflections and contact shadow to the scene.`,
    'If image 2 is provided, borrow its overall layout and visual rhythm, but create an original scene for our product. Do not copy its brand or claims.',
    'Only depict product views and packaging elements supported by the supplied enterprise image. If no open container or outer box is shown, keep the faithful closed product and use the visible texture as the secondary visual cue. Never invent a box, open jar, label, or formula.',
    layout ? `Reserve the left ${Math.round(layout.copyRight * 100)}% for the buyer headline and facts. Center the complete product near ${Math.round(layout.heroCenter * 100)}% width, clear of the top-right badge and left copy. Retain the reference layout rhythm and leave the bottom 16% for the inquiry footer.` : '',
    'Leave readable space for a headline near the top and a call to action near the bottom. Do not add new text outside the product packaging; our compositor adds the copy later.',
  ].filter(Boolean).join('\n\n');
}
