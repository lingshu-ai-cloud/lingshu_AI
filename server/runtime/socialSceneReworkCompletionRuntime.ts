import { store, dataBackend } from '../storage/index.js';
import { localFallbacksEnabled } from '../lib/localFallbackPolicy.js';
import { createStarter198Repository } from '../starter198/repository.js';
import { recoverSocialSceneReworkCompletions, type SceneReworkCompletionRecoveryCursor } from '../starter198/socialContentSceneReworkCompletionRecovery.js';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let cursor: SceneReworkCompletionRecoveryCursor | undefined;

/** Reconcile durable successful jobs; never claim or execute production here. */
export function initSocialSceneReworkCompletionRecovery(): void {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const report = await recoverSocialSceneReworkCompletions({
        repository: createStarter198Repository(store), cursor,
        ...(process.env.LINGSHU_LOCAL_PREVIEW === '1' && localFallbacksEnabled() && dataBackend === 'pocketbase'
          ? { dataAuthority: 'local' as const } : {}),
      });
      cursor = report.nextCursor ?? undefined;
      if (report.failed) console.error('[scene-rework-completion] reconciliation remains pending', report.errors);
    } catch (error) {
      console.error('[scene-rework-completion] scan failed', error instanceof Error ? error.message : 'scan_failed');
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => { void tick(); }, 30_000);
  timer.unref?.();
  void tick();
}
