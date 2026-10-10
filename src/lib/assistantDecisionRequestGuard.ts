/** Invalidate on identity change/unmount; stale requests cannot release a newer lock. */
export function createAssistantDecisionRequestGuard(identity: () => string) {
  let generation = 0;
  let busy = false;
  let requestNumber = 0;
  return {
    reset() { generation += 1; busy = false; },
    begin() {
      if (busy) return null;
      busy = true;
      const number = ++requestNumber;
      const requestGeneration = generation;
      const requestIdentity = identity();
      const ownsLock = () => busy && requestGeneration === generation && number === requestNumber;
      const current = () => ownsLock() && requestIdentity === identity();
      return {
        current,
        finish() {
          if (!ownsLock()) return false;
          busy = false;
          return true;
        },
      };
    },
  };
}
