import { type ShotProduction } from '../../lib/shotProduction';
import { effectiveDigitalHumanRequirements } from '../../../shared/contracts/digitalHumanRequirements';


export function normalizeExplicitPresenterMode(shot: ShotProduction): ShotProduction {
  const digitalHuman = effectiveDigitalHumanRequirements(shot.digitalHuman);
  return digitalHuman === shot.digitalHuman ? shot : { ...shot, digitalHuman };
}

export function applyManagedPresenterProduction(
  current: ShotProduction,
  managed: ShotProduction,
  input: { managedMode?: string; presenterConfirmed: boolean; sourceChoice?: string },
): ShotProduction {
  const { managedMode, presenterConfirmed, sourceChoice } = input;
  const shouldUseManagedPresenter = managedMode === 'one_click_managed' && presenterConfirmed
    && sourceChoice !== 'material' && sourceChoice !== 'shoot';
  if (!shouldUseManagedPresenter) return normalizeExplicitPresenterMode(current);
  const managedNarration = String(managed.narration || '').trim();
  return normalizeExplicitPresenterMode({
    ...current,
    source: 'avatar',
    sound: managed.digitalHuman?.presenterMode === 'video_twin' ? 'source' : managed.sound,
    presenterId: managed.presenterId,
    digitalHuman: managed.digitalHuman,
    narration: managedNarration && managedNarration !== '无' ? managedNarration : current.narration,
  });
}
