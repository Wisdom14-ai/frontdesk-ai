# VPS Deploy Flow

This repository deploys automatically to the VPS when code is pushed to `main`.

## GitHub configuration

Repository secret:

- `VPS_SSH_KEY`

Repository variables:

- `VPS_HOST`
- `VPS_USER`
- `VPS_DEPLOY_PATH`

## Server behavior

The workflow syncs the repository into the deploy path, while preserving:

- `.env.local`
- `evolution-local/.env`

After sync, the VPS runs:

1. `npm ci`
2. `npm run build`
3. `pm2 startOrReload ecosystem.config.cjs --only frontdesk-ai --update-env`
4. local health check on `http://127.0.0.1:3000/login`

## Manual deploy

You can also run the workflow manually from the GitHub Actions tab with `workflow_dispatch`.
