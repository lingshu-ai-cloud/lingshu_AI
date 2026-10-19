# Offline local-store lock reconciliation

Run `node node_modules/tsx/dist/cli.mjs scripts/reconcile-local-store-lock.ts` for a read-only snapshot. It does not stop processes, mutate tasks, release business leases or contact providers.

Only after stopping this workspace's writers, review the snapshot and run the same command with `--apply --expected-snapshot-hash <reviewed hash>`. Do not stop other projects. No elevation is needed when ownership evidence is sufficient. Apply otherwise refuses; a caller assertion or lock age cannot authorize recovery.

The fixed target is `data/local-store/durable_operation_leases.json.lock`. Apply requires a local filesystem, exact JSON hash and lock inode, complete OS process/open-file inventory, and no active store writer. An unprivileged macOS operator must additionally prove the store tree belongs to their UID, all ancestors exclude ordinary foreign-user writes, no symlink redirects exist, and ACLs grant no extra access (the standard everyone-deny-delete ACL is permitted). Privileged root is trusted OS administration, not falsely claimed visible in the owner-restricted scan. Unsupported ACL inspection fails closed.

Repository Node/tsx/Python executors remain potential writers even without currently open JSON handles. The exact recovery CLI launcher is exempt; Vite's known frontend executable and IDE working directories alone are not writers. Any store open handle is still a refusal. Unrelated checkout processes are outside this maintenance scope.

Apply creates a maintenance fence checked by all local CRUD paths, repeats ownership/process evidence, revalidates the snapshot and atomically moves the exact lock into an operation directory under `data/acceptance/local-store-lock-recovery`. It preserves `prepared.json`, then `committed.json` or `failed.json`. Business JSON bytes and SHA are checked unchanged; the isolated lock remains recoverable. Only its own token/inode-verified fence is released in `finally`. A changed fence, incomplete inventory or changed snapshot causes refusal, never timeout-based stealing.

After recovery, restart only this workspace normally. Unknown provider receipts, historical runs and charged/held amounts still require their existing reconciliation gates; filesystem recovery does not approve or retry them.
