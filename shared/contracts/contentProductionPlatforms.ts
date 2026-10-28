/** New content-production plans target these platforms; discovery remains cross-platform. */
export const CONTENT_PRODUCTION_PLATFORMS = ['linkedin', 'facebook'] as const;

export type ContentProductionPlatform = typeof CONTENT_PRODUCTION_PLATFORMS[number];

export function isContentProductionPlatform(value: unknown): value is ContentProductionPlatform {
  return value === 'linkedin' || value === 'facebook';
}
