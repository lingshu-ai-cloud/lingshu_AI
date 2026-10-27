export const CONTENT_GENERATION_AUTHORIZATION_VERSION = 'content-generation-metered-unlimited.v1' as const;

export interface ContentGenerationAuthorization {
  version: typeof CONTENT_GENERATION_AUTHORIZATION_VERSION;
  granted: true;
  /** Creative model usage has no locally enforced spend ceiling. Provider usage
   * and invoice evidence are still recorded after submission/completion. */
  spendPolicy: 'metered_unlimited';
}

export function contentGenerationAuthorization(value: unknown): ContentGenerationAuthorization | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Partial<ContentGenerationAuthorization>;
  return source.version === CONTENT_GENERATION_AUTHORIZATION_VERSION
    && source.granted === true
    && source.spendPolicy === 'metered_unlimited'
    ? {
        version: CONTENT_GENERATION_AUTHORIZATION_VERSION,
        granted: true,
        spendPolicy: 'metered_unlimited',
      }
    : null;
}

export function newContentGenerationAuthorization(): ContentGenerationAuthorization {
  return {
    version: CONTENT_GENERATION_AUTHORIZATION_VERSION,
    granted: true,
    spendPolicy: 'metered_unlimited',
  };
}
