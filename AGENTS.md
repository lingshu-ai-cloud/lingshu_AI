# Repository working agreements

## Deployment policy

- This repository is development-only unless the user explicitly requests deployment in the current task.
- Do not deploy, publish, release, promote, update production, or trigger a deployment workflow by default.
- Building, testing, committing, merging, and pushing are not deployment authorization.
- Before pushing to a branch that may auto-deploy, verify whether the push triggers deployment. If it may, stop and ask the user first.
- Do not run production migrations, production restores, production container pushes, or production infrastructure commands without explicit current-task authorization.
- Do not modify or bypass the global deployment guard for ordinary development.
- Local commands such as `npm test`, `npm run build`, and development servers are allowed and are not deployments.

## Canonical deployment path

- When the user explicitly requests deployment, use only an interactive SSH terminal to the existing Ubuntu server, then update the existing server checkout over GitHub HTTPS, and run `bash deploy/update.sh` from that checkout.
- Do not use CloudBase, a GitHub Actions deployment, GHCR/release-image deployment, `deploy/release.sh`, PM2, `scp`, `rsync`, or another deployment path unless the user explicitly overrides this rule in the current task.
- The canonical Git remote is `https://github.com/lingshu-ai-cloud/lingshu_AI.git`. Verify the server checkout's `origin`, branch, cleanliness, and divergence before pulling. Do not stash, reset, overwrite, or silently deploy an older revision.
- Use an interactive PTY and `git pull --ff-only`. Disable credential caching for the pull and pause at GitHub's credential prompt so the user can type the GitHub username and personal access token in the SSH terminal. GitHub's `Password` prompt requires a personal access token, not the account password.
- Never ask the user to paste a GitHub credential into chat, put a credential in a command or URL, echo it, save it, or cache it. Do not continue through an alternate path if interactive authentication is unavailable.
- On failure, preserve the current state, identify the first failing command and its specific log evidence, fix that cause, and resume from the failed checkpoint. Do not restart the whole procedure or revisit a previously failed path unless its blocking condition changed.
- A deployment is complete only after reporting the deployed commit, `docker compose` service state, and the exact `/api/overseas/ready` result.
