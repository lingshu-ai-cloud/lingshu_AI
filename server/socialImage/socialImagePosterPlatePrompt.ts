import type { SocialImageReplicationRecipe } from '../../shared/contracts/socialImageCreation.js';

/** Give the image model room to unify the product and scene; typography stays deterministic. */
export function buildSocialImagePosterPlatePrompt(input: {
  ratio: string;
  recipe?: SocialImageReplicationRecipe;
}): string {
  return [
    `Create one polished ${input.ratio} social poster scene. Image 1 is our real product; keep its package shape, color, logo and label faithful. Make the product, lighting and surroundings feel like one photograph.`,
    'If image 2 is provided, borrow its overall layout and visual rhythm, but create an original scene for our product. Do not copy its brand or claims.',
    'Leave readable space for a headline near the top and a call to action near the bottom. Do not add new text outside the product packaging; our compositor adds the copy later.',
  ].filter(Boolean).join('\n\n');
}
