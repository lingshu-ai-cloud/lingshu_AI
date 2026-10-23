import { useEffect } from 'react';
import { studioAutosaveFingerprint, studioDraftChanged } from '../../lib/studioAutosave';
import type { StudioProjectLifecyclePorts } from './studioProjectLifecyclePorts.js';

export function useStudioProjectAutosave(ports: Pick<StudioProjectLifecyclePorts,
  | 'currentProjectRef'
  | 'projectId'
  | 'projectTitle'
  | 'collectSpec'
  | 'lastSavedAutosaveFingerprintRef'
  | 'autosaveSnapshotRef'
>) {
  const {
    currentProjectRef, projectId, projectTitle,
    collectSpec,
  } = ports;
  const autosaveSnapshotFingerprint = studioAutosaveFingerprint(
    currentProjectRef.current ?? projectId,
    projectTitle,
    collectSpec(),
  );
  useEffect(() => {
    const {
      lastSavedAutosaveFingerprintRef, autosaveSnapshotRef,
    } = ports;

    if (!studioDraftChanged(lastSavedAutosaveFingerprintRef.current, autosaveSnapshotFingerprint)) return;
    // Persist only a semantically changed snapshot. The debounce absorbs a
    // burst of field edits and prevents object-identity-only rerenders from
    // becoming repeated network saves.
    const timer = window.setTimeout(() => {
      void autosaveSnapshotRef.current();
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [autosaveSnapshotFingerprint]);

  return { autosaveSnapshotFingerprint };
}

export function bindStudioProjectAutosave(ports: Pick<StudioProjectLifecyclePorts,
  | 'autosaveSnapshotRef'
  | 'saveProject'
>) {
  const {
    autosaveSnapshotRef,
  } = ports;
  autosaveSnapshotRef.current = async () => {
    const {
      saveProject,
    } = ports;
    await saveProject('draft', { silent: true }); };
}
