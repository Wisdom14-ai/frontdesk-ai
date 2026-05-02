# FrontdeskAI

WhatsApp CRM SaaS for Malaysian dental and aesthetic clinics.

## Canonical URLs

Use these raw URLs when sharing with AI tools, deploy scripts, or browser checks:

```text
Repository: https://github.com/Wisdom14-ai/frontdesk-ai
Production app: https://app.frontdesk-ai.cloud
Root redirect: https://frontdesk-ai.cloud -> https://app.frontdesk-ai.cloud
Local dev: http://localhost:3000
```

Avoid wrapping URLs in extra Markdown formatting like `__https://...__` when a tool expects a plain URL input. Humans can read it, but some fetch tools pass the underscores through as part of the URL.

## Product Surface

The authenticated app has exactly five sidebar screens:

- Inbox: `/inbox`
- CRM: `/crm`
- Blast: `/campaigns`
- Stats: `/analytics`
- Setup: `/settings`

The app landing route `/` redirects to `/inbox`; unauthenticated users are redirected to `/login`.

## Local Development

Create `.env.local` from `.env.example`, then run:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

Do not use `https://localhost:3000` unless you have explicitly configured local HTTPS. The default Next.js dev server is HTTP.

## Required Environment

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

APP_BASE_URL=https://app.frontdesk-ai.cloud
NEXT_PUBLIC_APP_URL=https://app.frontdesk-ai.cloud
ROOT_REDIRECT_DOMAIN=frontdesk-ai.cloud

EVOLUTION_API_URL=
EVOLUTION_API_KEY=
N8N_WEBHOOK_SECRET=
CRON_SECRET=
```

Evolution API credentials can also be stored per clinic in Supabase.

## Supabase Auth URL Settings

Set Supabase Auth URL configuration to:

```text
Site URL: https://app.frontdesk-ai.cloud
Redirect URLs:
https://app.frontdesk-ai.cloud/auth/callback
https://app.frontdesk-ai.cloud/login
```

## Database

Production schema is maintained in:

```text
supabase-schema.sql
```

Apply schema changes in Supabase before testing new screens that depend on new tables. The rebuild uses `message_templates` for both Inbox quick replies and Campaign templates.

## AI Cap Reset Cron

AI usage caps reset on calendar-month boundaries. Configure an external cron runner, such as cron-job.org or a VPS crontab, to call:

```text
POST https://app.frontdesk-ai.cloud/api/cron/ai-cap-reset
Authorization: Bearer <CRON_SECRET>
```

Recommended schedule:

```text
5 0 1 * *
```

This runs on day 1 of each month at 00:05 UTC. The endpoint is idempotent and only resets clinics paused for `cap_exceeded` whose `billing_cycle_start_at` is older than the current UTC month.

## Deploy

Pushing to `main` triggers:

```text
.github/workflows/deploy-vps.yml
```

The workflow syncs the repo to the VPS and runs:

```text
scripts/deploy-vps.sh
```

The deploy script keeps `app.frontdesk-ai.cloud` as the app domain and redirects `frontdesk-ai.cloud` to the app domain with Let's Encrypt certificates for both hostnames.

## Verification

Useful checks:

```bash
npm run build
npm run test:server
```

Public smoke URLs:

```text
https://app.frontdesk-ai.cloud/login
https://frontdesk-ai.cloud/login
https://app.frontdesk-ai.cloud/auth/callback?next=/inbox
```
