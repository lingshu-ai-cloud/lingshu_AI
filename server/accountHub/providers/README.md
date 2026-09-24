# Member-local Provider boundary

The account hub never logs a member into Codex or Claude and never invokes a
Provider logout. Provider credentials remain in the member's normal local
client storage.

This directory contains only:

- a shell-free, allowlisted process runner with bounded output and redaction;
- a JSON-RPC transport used for read-only Codex account and quota methods;
- parsers that select credential-free identity and usage fields.

The member connector launches the official local CLI without overriding
`CODEX_HOME` or `CLAUDE_CONFIG_DIR`. It reports only the strict state schema to
the token-authenticated telemetry endpoint. Passwords, cookies, OAuth tokens,
API keys, `auth.json`, prompts, code, and tool output are rejected by the
server-side state store.
