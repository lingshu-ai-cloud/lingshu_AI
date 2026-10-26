import { useEffect, useRef } from 'react';
import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation';
import { productionNavigationIdentity } from '../../lib/productionNavigation';

/** Only the explicit final intake confirmation can request this one-time handoff. */
export function useImageReplicationAutoStart(input: {
  enabled: boolean; ready: boolean; task?: SocialImageCreationTask; start: () => Promise<void>;
}) {
  const started = useRef(false);
  const identity = useRef(productionNavigationIdentity());
  useEffect(() => {
    const task = input.task;
    if (!input.enabled || !input.ready || started.current || !task
      || identity.current !== productionNavigationIdentity()
      || task.creationPath !== 'viral_replication' || task.status !== 'draft' || task.step !== 'inputs'
      || task.generationJobs.length || task.outputs.length) return;
    started.current = true;
    void input.start();
  }, [input.enabled, input.ready, input.task, input.start]);
}
