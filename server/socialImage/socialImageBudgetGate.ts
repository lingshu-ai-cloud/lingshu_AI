/** An image may enter the durable queue without a cap, but no paid stage may start until one is recorded. */
export function requireSocialImageBudgetLimit(rawBrief: unknown): number {
  let brief: unknown = rawBrief;
  if (typeof brief === 'string') {
    try { brief = JSON.parse(brief) as unknown; }
    catch { throw new Error('social_image_budget_required'); }
  }
  const limit = brief && typeof brief === 'object' && !Array.isArray(brief)
    ? (brief as Record<string, unknown>).perItemBudgetCny : null;
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0)
    throw new Error('social_image_budget_required');
  return limit;
}
