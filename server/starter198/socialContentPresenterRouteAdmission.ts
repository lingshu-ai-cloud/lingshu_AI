import { presenterProductionRoute } from '../../shared/contracts/presenterProductionRoute.js';
import type { SocialAssetSupplyPlan } from '../../shared/contracts/socialContentWorkflow.js';

export function assertSocialPresenterRouteAvailable(plan: SocialAssetSupplyPlan | null | undefined, verifiedSilentShotIds: ReadonlySet<string> = new Set(), native?: { policy?: string; heyGenShotIds: ReadonlySet<string> }): void {
  for (const shot of plan?.shots ?? []) {
    const route = presenterProductionRoute({ sourceStrategy: shot.sourceStrategy,
      method: shot.digitalHumanPlan?.method,
      provider: native?.heyGenShotIds.has(shot.shotId) ? 'heygen' : undefined, speechReviewPolicy: native?.policy,
      silentMotion: verifiedSilentShotIds.has(shot.shotId) || (shot.digitalHumanPlan as { silentMotion?: boolean } | undefined)?.silentMotion });
    if (!route.executable) throw Error(`user_input_required:${route.code}:${shot.shotId}:${route.message} 可选处理：${route.nextActions.join('；')}。系统不会自动替换已确认路线。`);
  }
}
