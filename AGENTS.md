# Repository working agreements

## Deployment policy

- This repository is development-only unless the user explicitly requests deployment in the current task.
- Do not deploy, publish, release, promote, update production, or trigger a deployment workflow by default.
- Building, testing, committing, merging, and pushing are not deployment authorization.
- Before pushing to a branch that may auto-deploy, verify whether the push triggers deployment. If it may, stop and ask the user first.
- Do not run production migrations, production restores, production container pushes, or production infrastructure commands without explicit current-task authorization.
- Do not modify or bypass the global deployment guard for ordinary development.
- Local commands such as `npm test`, `npm run build`, and development servers are allowed and are not deployments.
