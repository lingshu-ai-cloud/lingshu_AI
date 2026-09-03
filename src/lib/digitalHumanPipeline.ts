/**
 * Single cache/signature boundary for the V2 digital-human render path.
 * P1 adds the audited final-stage clarity treatment and preserves 1080x1920
 * through multi-beat assembly, so P0 output must never be reused for a P1
 * request.
 */
export const DIGITAL_HUMAN_PIPELINE_VERSION = 'digital-human-v2-p1.4' as const;

export function parseDigitalHumanPipelineVersion(value: unknown): typeof DIGITAL_HUMAN_PIPELINE_VERSION | undefined {
  const candidate = String(value ?? '').trim() || DIGITAL_HUMAN_PIPELINE_VERSION;
  return candidate === DIGITAL_HUMAN_PIPELINE_VERSION ? DIGITAL_HUMAN_PIPELINE_VERSION : undefined;
}
