import type { SocialImageReplicationRecipe } from '../../shared/contracts/socialImageCreation.js';

/** The paid call makes a visual plate; exact product pixels and copy are composited locally. */
export function buildSocialImagePosterPlatePrompt(input: {
  ratio: string;
  recipe?: SocialImageReplicationRecipe;
}): string {
  const regions = (input.recipe?.layoutRegions || []).slice(0, 12)
    .map(region => `${region.role}: x=${region.x}, y=${region.y}, width=${region.width}, height=${region.height}`)
    .join('; ');
  return [
    `Create one polished social product-advertising BACKGROUND PLATE with aspect ratio ${input.ratio}.`,
    'Use a refined dark-to-mid-tone color field, soft depth, restrained highlights and a quiet product stage. The upper headline area and bottom call-to-action area must be dark and uncluttered so white text remains legible.',
    'BACKGROUND ONLY. Do not draw any product, packaging, bottle, jar, person, logo, brand mark, headline, letter, number, badge, price, claim, CTA, watermark or interface element. The exact tenant-owned product and text are added after this plate is saved.',
    regions ? `Use these measured reference layout zones as generic geometry only: ${regions}. Do not copy benchmark identity, wording or product.` : '',
  ].filter(Boolean).join('\n\n');
}
