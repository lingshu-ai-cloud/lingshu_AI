# TENANT_PLATFORM_APP_KEY

`TENANT_PLATFORM_APP_KEY` signs tenant OAuth state. Platform secrets and account tokens are encrypted with the independent `CREDENTIAL_ENCRYPTION_KEY`; do not reuse either value.

Production startup requires this variable. If `NODE_ENV=production` and `TENANT_PLATFORM_APP_KEY` is missing, the server will refuse to start.

## Generate

Run:

```bash
openssl rand -base64 32
```

Copy the output into the production server environment:

```bash
TENANT_PLATFORM_APP_KEY=replace-with-openssl-output
```

## Notes

- Do not commit this value to git.
- Do not share it in chat, screenshots, or customer-facing documents.
- Keep the same value across app restarts and deployments so outstanding OAuth state remains valid.
- Development keeps the existing local fallback behavior, so this variable is only mandatory in production.
