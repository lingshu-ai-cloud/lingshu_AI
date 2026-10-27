import type { SocialImageReplicationRecipe } from '../../shared/contracts/socialImageCreation.js';

/** Give the image model room to unify the product and scene; typography stays deterministic. */
export function buildSocialImagePosterPlatePrompt(input: {
  ratio: string;
  recipe?: SocialImageReplicationRecipe;
  buyerLayout?: boolean;
}): string {
  return [
    `Create one polished ${input.ratio} social poster scene. Image 1 is our real product; keep its package shape, color, logo and label faithful. Make the product, lighting and surroundings feel like one photograph.`,
    'If image 2 is provided, borrow its overall layout and visual rhythm, but create an original scene for our product. Do not copy its brand or claims.',
    'Only depict product views and packaging elements supported by the supplied enterprise image. If no open container or outer box is shown, keep the faithful closed product and use the visible texture as the secondary visual cue. Never invent a box, open jar, label, or formula.',
    input.buyerLayout ? 'Reserve the left 40% for bold buyer-facing headline and verified facts. Place the unobscured product hero in the right half, while retaining the reference image’s visual rhythm. Leave the bottom 16% open for a B2B inquiry footer.' : '',
    'Leave readable space for a headline near the top and a call to action near the bottom. Do not add new text outside the product packaging; our compositor adds the copy later.',
  ].filter(Boolean).join('\n\n');
}
