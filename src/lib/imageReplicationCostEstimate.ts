/** Non-binding GPT Image 2 model-stage estimate, never an admission limit.
 * Source: https://developers.openai.com/api/docs/guides/image-generation
 * Output prices (USD/image): low $0.005–$0.006, high up to $0.211 for standard sizes.
 * Input rates: image $4/M tokens, text $2.50/M tokens.
 */
export function imageReplicationModelCostRangeCny(outputCount = 1): { minimum: number; maximum: number } {
  const count = Math.max(1, Math.floor(outputCount));
  const assumedUsdCny = 7.2; // Display-only conversion assumption, not a live FX quote.
  const minimumUsd = 0.005 + 1_000 * 4 / 1_000_000 + 1_000 * 2.5 / 1_000_000;
  const maximumUsd = 0.211 + 20_000 * 4 / 1_000_000 + 5_000 * 2.5 / 1_000_000;
  return {
    minimum: Math.floor(minimumUsd * assumedUsdCny * count * 100) / 100,
    maximum: Math.ceil(maximumUsd * assumedUsdCny * count * 100) / 100,
  };
}
