# Social weekly execution integration points

R3 was implemented from baseline `9a9e12b` without merging the parallel R1 or
R2 branches. The following are deliberate narrow seams for later integration.

## R1 consistency (`6c0b1e3`)

- `WeeklyOperatingPackage.executionTaskRefs` and `executionSummary` are
  optional on the shared package contract so existing R1 constructors and
  read models remain source-compatible.
- Runtime task mutations are serialized through
  `durable_operation_leases` using the
  `social-weekly-execution-mutation` scope. Worker ownership uses the separate
  `social-weekly-execution` scope and lease-token fencing.
- If R1 introduces a native compare-and-swap or transaction port, replace the
  mutation-lease wrapper in `server/socialPrograms/executionTasks.ts`; the
  worker contract and persisted task payload do not need to change.

## R2 authoritative planning (`23e3e5e`)

- Every execution task freezes `upstreamVersionRefs`; the current business
  goal, capacity plan, automation policy, enterprise profile and monthly plan
  references are copied from the exact weekly package version.
- `inputSnapshot` is immutable worker input. A worker must not resolve a newer
  R2 planning object implicitly. Replanning creates a new package version and
  a new idempotent task set.
- The existing `businessContentGoalRef` repository lookup remains the authority
  boundary. No R2 implementation module is imported by the worker runtime.

## Adapter boundary

`createSocialWeeklyExecutionWorker` is only a queue/lease/result-reference
port. Discovery, content production and real publishing adapters are
intentionally not registered here; they can consume claimed snapshots in
their owning changesets and return versioned result references.
