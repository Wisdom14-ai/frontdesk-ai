# Production Checklist

This file covers the remaining launch work after the schema is applied.

## 1. Set production environment variables

Set these in your deployment platform before the next production deploy:

Required:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_BASE_URL`
- `WHATSAPP_PLATFORM_EVOLUTION_API_URL`
- `WHATSAPP_PLATFORM_EVOLUTION_API_KEY`
- `AUTOMATION_RUNNER_SECRET`
- `OPENAI_API_KEY`
- `LEAD_MEMORY_MODEL`
- `WHATSAPP_CHATBOT_MODEL`

Recommended:
- `CONTACT_MEMORY_RUNNER_SECRET`
- `CAMPAIGN_RUNNER_SECRET`
- `CRON_SECRET`
- `SUPPORT_WHATSAPP_NUMBER`

Notes:
- If you omit `CONTACT_MEMORY_RUNNER_SECRET`, lead-memory cron falls back to `AUTOMATION_RUNNER_SECRET`.
- If you omit `CAMPAIGN_RUNNER_SECRET`, campaign cron falls back to `AUTOMATION_RUNNER_SECRET`.
- If you use Vercel Cron Jobs, set `CRON_SECRET`. Vercel sends it as `Authorization: Bearer <CRON_SECRET>`.
- `APP_BASE_URL` must be a public HTTPS URL in production so WhatsApp webhooks can reach the app.
- Use the app status keys in `supabase-schema.sql`: `no_respond` and `attended_visit`.

## 2. Deploy with cron enabled

This repo now includes [`vercel.json`](../vercel.json) with production cron schedules:
- `/api/automation/run-due` every 5 minutes
- `/api/campaigns/run-due` every 5 minutes
- `/api/contact-memory/run-due` every 15 minutes

If you deploy on Vercel:
1. Add the environment variables in the Vercel project dashboard.
2. Redeploy production so Vercel reads the new `vercel.json`.
3. In Vercel, confirm both cron jobs are listed for the production deployment.

If you do not deploy on Vercel:
1. Keep the same endpoint schedule.
2. Call `GET /api/automation/run-due` and `GET /api/contact-memory/run-due` from your scheduler.
3. Send either:
   - `Authorization: Bearer <CRON_SECRET>`
   - or `x-runner-secret: <AUTOMATION_RUNNER_SECRET / CONTACT_MEMORY_RUNNER_SECRET>`

## 3. Verify ops visibility

After deploy, check these screens:

Automation:
- Open `/settings`
- Review `Automation Control Center`
- Confirm pending jobs, overdue jobs, failed jobs, and last runner activity all load

Lead memory:
- Open `/admin`
- Open the clinic detail page
- Review `Super Admin Lead Memory Drafting`
- Confirm pending jobs, overdue jobs, failed jobs, last generated memory, and last runner activity all load

Manual controls now available:
- `Run Due Jobs Now` in automation settings
- `Run Due Jobs Now` in the super-admin lead-memory card
- `Queue Backfill` in the super-admin lead-memory card

## 4. Run one real clinic end-to-end

Use one clinic and one real WhatsApp number.

1. Confirm payment is marked received for the clinic.
2. Connect the clinic WhatsApp on `/connect-whatsapp`.
3. Send a real inbound message from another phone.
4. Send one manual cold DM from the connected WhatsApp phone and confirm it appears as an outbound CRM message.
5. Confirm the contact, inbound reply, and bot reply appear in `/inbox` when chatbot env vars are configured.
6. Pause the bot from the conversation panel and send one manual reply from the CRM.
7. Open `/settings` and click `Run Due Jobs Now` in automation if you want to force due follow-ups for testing.
8. Open the clinic in `/admin` and click `Run Due Jobs Now` in the lead-memory card.
9. Confirm:
   - `contacts.last_inbound_at` updated
   - `contacts.last_outbound_at` updated
   - `contact_memory_jobs` rows are moving out of `pending`
   - `automation_jobs` rows are moving out of `pending`
   - `contacts.lead_memory_last_generated_at` updates after a successful lead-memory run
   - `automation_runner_runs` and `contact_memory_runner_runs` show recent activity

## 5. Regression checks before launch

Run these from the project root:

```bash
npm run lint
npm run test:e2e
npm run test:server
```

What they cover now:
- public runner routes fail closed if no runner secret exists
- both runner routes accept authenticated cron-style GET requests
- contact-memory queue dedupes pending jobs per contact
- missing AI config no longer drops queued lead-memory work
