import {
  FIXED_YIELD_CAPABILITY_MAP,
  FIXED_YIELD_PATH_IDS,
  type FixedYieldPathId,
  type FixedYieldProductionMode,
} from './fixedYieldCapabilityMap.js';
import { fixedYieldSha256 } from './fixedYieldHash.js';

export const FIXED_YIELD_RUNTIME_SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;

export interface FixedYieldPathRuntimeState {
  pathId: FixedYieldPathId;
  state: 'available' | 'degraded' | 'unavailable';
  allowedModes: FixedYieldProductionMode[];
  reasonCodes: string[];
  checkedAt: string;
}

export interface FixedYieldRuntimeReadinessSnapshot {
  schemaVersion: 'fixed-yield-runtime-readiness.v2';
  snapshotId: string;
  capabilityMapVersion: 'fixed-yield-capability.v2';
  states: Record<FixedYieldPathId, FixedYieldPathRuntimeState>;
  checkedAt: string;
}

export interface FixedYieldPathRegistryEntry {
  pathId: FixedYieldPathId;
  declaredModes: FixedYieldProductionMode[];
  executableModes: FixedYieldProductionMode[];
  runtimeState: FixedYieldPathRuntimeState['state'];
  reasonCodes: string[];
}

export function fixedYieldRuntimeSnapshotId(
  snapshot: Omit<FixedYieldRuntimeReadinessSnapshot, 'snapshotId'>,
): string {
  return fixedYieldSha256(snapshot);
}

export function fixedYieldRuntimeSnapshotIssues(
  snapshot: FixedYieldRuntimeReadinessSnapshot,
  evaluatedAt = new Date().toISOString(),
): string[] {
  const issues: string[] = [];
  if (snapshot.schemaVersion !== 'fixed-yield-runtime-readiness.v2') issues.push('runtime_snapshot_schema_invalid');
  if (snapshot.capabilityMapVersion !== 'fixed-yield-capability.v2') issues.push('runtime_snapshot_capability_version_invalid');
  const checkedAt = Date.parse(snapshot.checkedAt);
  const evaluated = Date.parse(evaluatedAt);
  if (!Number.isFinite(checkedAt) || !Number.isFinite(evaluated)) issues.push('runtime_snapshot_time_invalid');
  else if (checkedAt > evaluated || evaluated - checkedAt > FIXED_YIELD_RUNTIME_SNAPSHOT_MAX_AGE_MS) issues.push('runtime_snapshot_stale');
  const { snapshotId: _snapshotId, ...core } = snapshot;
  if (!/^[a-f0-9]{64}$/.test(snapshot.snapshotId) || fixedYieldRuntimeSnapshotId(core) !== snapshot.snapshotId) {
    issues.push('runtime_snapshot_hash_invalid');
  }
  for (const pathId of FIXED_YIELD_PATH_IDS) {
    const state = snapshot.states[pathId];
    if (!state || state.pathId !== pathId) issues.push(`runtime_snapshot_path_missing:${pathId}`);
    else if (state.checkedAt !== snapshot.checkedAt) issues.push(`runtime_snapshot_path_time_mismatch:${pathId}`);
  }
  return [...new Set(issues)];
}

/** Joins static capability with one server-frozen runtime snapshot. A missing
 * or stale path is unavailable, never optimistically available. */
export function fixedYieldPathRegistry(
  snapshot: FixedYieldRuntimeReadinessSnapshot,
  evaluatedAt = new Date().toISOString(),
): Record<FixedYieldPathId, FixedYieldPathRegistryEntry> {
  const snapshotIssues = fixedYieldRuntimeSnapshotIssues(snapshot, evaluatedAt);
  return Object.fromEntries(FIXED_YIELD_PATH_IDS.map(pathId => {
    const declaredModes = FIXED_YIELD_CAPABILITY_MAP[pathId].productionModes;
    const state = snapshot.states[pathId];
    const valid = snapshotIssues.length === 0 && state?.pathId === pathId;
    const executableModes = valid
      ? state.allowedModes.filter(mode => declaredModes.includes(mode))
      : [];
    const runtimeState = valid && executableModes.length ? state.state : 'unavailable';
    return [pathId, {
      pathId, declaredModes: [...declaredModes], executableModes,
      runtimeState,
      reasonCodes: valid ? [...state.reasonCodes] : snapshotIssues.length ? snapshotIssues : ['runtime_snapshot_path_missing'],
    }];
  })) as Record<FixedYieldPathId, FixedYieldPathRegistryEntry>;
}

export function fixedYieldPathReadinessIssues(input: {
  snapshot: FixedYieldRuntimeReadinessSnapshot;
  requirements: Array<{ pathId: FixedYieldPathId; productionMode: FixedYieldProductionMode }>;
  evaluatedAt?: string;
}): string[] {
  const registry = fixedYieldPathRegistry(input.snapshot, input.evaluatedAt);
  return [...new Set(input.requirements.flatMap(requirement => {
    const entry = registry[requirement.pathId];
    if (entry.runtimeState === 'unavailable') return [`${requirement.pathId}:runtime_unavailable:${entry.reasonCodes.join(',') || 'unknown'}`];
    if (!entry.executableModes.includes(requirement.productionMode)) return [`${requirement.pathId}:${requirement.productionMode}:mode_unavailable`];
    return [];
  }))];
}
