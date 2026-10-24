type PreviewEnvironment = { LINGSHU_LOCAL_PREVIEW?: string; CUSTOMER_SIMULATION_ENABLED?: string };
/** Customer simulations use action-scoped adapters. Never resume unrelated
 * saved channel/weekly jobs simply because their HTTP preview was opened. */
export function startPreviewSafeRecovery(start: () => () => void, env: PreviewEnvironment = {LINGSHU_LOCAL_PREVIEW:process.env.LINGSHU_LOCAL_PREVIEW,CUSTOMER_SIMULATION_ENABLED:process.env.CUSTOMER_SIMULATION_ENABLED}): () => void {
  if (env.LINGSHU_LOCAL_PREVIEW === '1' && env.CUSTOMER_SIMULATION_ENABLED === '1') return () => undefined;
  return start();
}
