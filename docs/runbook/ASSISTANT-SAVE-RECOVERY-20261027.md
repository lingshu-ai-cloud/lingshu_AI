# Assistant save compatibility recovery

Production starting point: `9b55428fd655cfb99d5a778bd34924686dc8f9ea`.

PocketBase text fields store an empty `focusedTaskId` as `""`. Normalize the submitted value before strict write verification and operation fingerprinting. Add the missing JSON field `pendingContentTaskBinding` with migration `1793062800`; otherwise PocketBase discards the receipt and strict verification fails.

Before production updates, preserve the current container images, environment and a consistent SQLite backup of the existing named volume. Rehearse migrations on a copy with PocketBase 0.39.5 and verify old table counts and integrity. Use the existing GitHub HTTPS checkout and `bash deploy/update.sh`; never replace the database volume.

After updating the schema and application, run `node --import tsx scripts/recover-assistant-pb-claims.ts` in the application container. Dry run is the default. It must report `committed_claim_proven` before applying recovery. With a private `RECOVERY_BACKUP_DIR` under `/app/data`, `--apply` backs up each proven claim and original thread before releasing only its claim. Unknown or concurrently changed writes remain fenced; do not delete claims manually or by age alone.

Verify `/api/overseas/ready`, service states, and successful save/reload in a separate test conversation. Check the original conversation remains available. Test clear/delete only on a disposable test conversation; historical business records must remain intact.

Local verification: real PocketBase 0.39.5 plus route/lifecycle regression 14/14; TypeScript; architecture guard and ratchet against `9b55428f`; 206 migration manifest entries; production build; `git diff --check`. These results do not establish production deployment or UI acceptance.
