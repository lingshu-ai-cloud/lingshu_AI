import type { DataAuthority } from '../storage/dataAuthority.js';

/**
 * The local preview owns a persisted local data plane. Scheduler bootstrap
 * must read scopes and scheduled tasks from that same authority; an empty but
 * healthy PocketBase response must not hide local active scopes after restart.
 */
export function schedulerBootstrapAuthority(
  env: NodeJS.ProcessEnv = process.env,
  localFallbackEnabled: boolean,
): DataAuthority {
  return env.LINGSHU_LOCAL_PREVIEW === '1' && localFallbackEnabled ? 'local' : 'pocketbase';
}
