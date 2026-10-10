import { MotionGlobalConfig, visualElementStore } from 'motion/react';

type MotionPolicyConfig = { skipAnimations?: boolean };

/** Keep one effective policy across independently mounted application roots. */
export function createMotionPolicyManager(config: MotionPolicyConfig) {
  const owners = new Map<symbol, boolean>();
  let previousPolicy: boolean | undefined;
  return (reducedMotion: boolean): (() => void) => {
    const owner = Symbol('lingshu-motion-policy');
    if (!owners.size) previousPolicy = config.skipAnimations;
    owners.set(owner, reducedMotion);
    config.skipAnimations = [...owners.values()].some(Boolean);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      owners.delete(owner);
      config.skipAnimations = owners.size ? [...owners.values()].some(Boolean) : previousPolicy;
    };
  };
}

export const registerMotionPolicy = createMotionPolicyManager(MotionGlobalConfig);

/**
 * The global flag applies to new animations. Complete existing Motion values
 * inside this root too, so a mid-transition preference change settles on the
 * next animation frame instead of waiting for a spring to run out.
 * Ant/CSS portals are handled by their theme and the global media query.
 */
export function settleMotionRoot(root: HTMLElement | null): number {
  if (!root) return 0;
  let completed = 0;
  for (const element of [root, ...root.querySelectorAll('*')]) {
    const visual = visualElementStore.get(element);
    if (!visual) continue;
    visual.values.forEach(value => {
      const animation = value.animation;
      if (!animation || animation.state === 'finished') return;
      try {
        animation.complete();
      } catch {
        // A native infinite decoration cannot be finished; stop it in place.
        animation.stop();
      }
      completed += 1;
    });
    visual.projection?.currentAnimation?.complete();
  }
  return completed;
}
