# Clinic OS User Manual

## 1. What this app does

Clinic OS is a WhatsApp-first CRM for clinics.

Main jobs:
- capture inbound WhatsApp leads into the CRM
- let staff reply from the inbox
- move leads through the pipeline
- track bookings, visits, and revenue
- manage clinic activation and WhatsApp connection

## 2. System roles

There are two operator views:

### Clinic user
- Signs into the clinic workspace
- Uses Inbox, Pipeline, Dashboard, and Settings
- Connects the clinic WhatsApp by QR
- Invites and manages clinic staff

### Super admin
- Uses `/admin`
- Marks payment as received
- Reviews clinic health and metrics
- Edits commercial settings
- Can inspect or reset a clinic WhatsApp connection

## 3. Required setup before testing

You need all of these before the first real test:

1. Supabase project
2. Schema applied from `supabase-schema.sql`
3. Environment variables configured from `.env.example`
4. Evolution API running separately
5. At least one super admin user in `agency_admins`

### Minimum environment variables

Required:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_BASE_URL` for reliable WhatsApp webhook delivery
- `WHATSAPP_PLATFORM_EVOLUTION_API_URL`
- `WHATSAPP_PLATFORM_EVOLUTION_API_KEY`

Optional:
- `OPENAI_API_KEY` and `LEAD_MEMORY_MODEL` for automatic lead memory generation
- `AUTOMATION_RUNNER_SECRET`
- `CONTACT_MEMORY_RUNNER_SECRET`
- `CRON_SECRET`
- `SUPPORT_WHATSAPP_NUMBER`
- `NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER`

## 4. First-time technical setup

### Step 1. Configure environment variables

Copy values from [`.env.example`](/C:/Users/USER/Downloads/Clinic%20Whatsapp%20CRM/clinic-os/.env.example) into your local `.env.local`.

Important:
- `APP_BASE_URL` must be reachable by Evolution API
- if Evolution runs in Docker on Windows, `http://host.docker.internal:3000` is usually safer than `http://localhost:3000`

### Step 2. Apply the database schema

Run the SQL in [`supabase-schema.sql`](/C:/Users/USER/Downloads/Clinic%20Whatsapp%20CRM/clinic-os/supabase-schema.sql) in your Supabase SQL editor.

This creates:
- `clinics`
- `users`
- `contacts`
- `messages`
- `revenue_logs`
- `agency_admins`
- automation tables and helper RPCs

If this Supabase project already existed before the latest CRM rollout, rerun the full schema file again. It now includes cleanup for two legacy drifts:
- old `users.role = 'owner'` rows are normalized to `admin`
- old `messages.wa_message_id` data is copied into `provider_message_id`

### Step 3. Create your super admin access

1. Sign up once in the app at `/login`
2. Open Supabase table editor
3. Add your auth user ID to `agency_admins`

Required fields:
- `id` = your `auth.users.id`
- `email` = your login email
- `full_name` = your name

Without this, `/admin` will not allow super admin actions.

### Step 4. Start Evolution API

Run Evolution API as a separate service.

You need:
- a reachable base URL
- the API key
- persistent storage for WhatsApp sessions

Then set:
- `WHATSAPP_PLATFORM_EVOLUTION_API_URL`
- `WHATSAPP_PLATFORM_EVOLUTION_API_KEY`

### Step 5. Start the app

From the project root:

```bash
npm run dev
```

Open `http://localhost:3000`.

## 5. First self-test: full happy path

Use this flow before showing the app to a client.

### Phase A. Create a clinic

1. Go to `/login`
2. Click `Create workspace`
3. Enter:
   - full name
   - clinic name
   - clinic type
   - plan
   - email
   - password
4. Finish signup
5. If Supabase email confirmation is enabled, confirm the email
6. Sign in

Expected result:
- a clinic row is created
- your user becomes the clinic admin
- because payment is still pending, the app sends you to `/activate`

### Phase B. Unlock the workspace

1. Sign in with your super admin account
2. Open `/admin`
3. Open the clinic detail page
4. In `Subscription And Billing`:
   - keep `Subscription Status` as `active`
   - set `Payment Status` to `received`
   - set `Payment Received Date`
   - optionally set `Billing Cycle Anchor`
5. Save

Expected result:
- the clinic is no longer blocked on payment
- clinic users are redirected from `/activate` to `/connect-whatsapp`

### Phase C. Connect the clinic WhatsApp

1. Log back in as the clinic user
2. Open `/connect-whatsapp`
3. Click `Generate QR`
4. On the phone that owns the clinic WhatsApp:
   - open WhatsApp
   - open `Linked Devices`
   - scan the QR code

Expected result:
- the card status changes to `Connected`
- the app redirects into the main CRM
- clinic `whatsapp_status` becomes `connected`

### Phase D. Test inbound lead capture

1. From another phone, send a WhatsApp message to the connected clinic number
2. Open the clinic workspace inbox at `/inbox`
3. Confirm:
   - a new contact appears
   - the inbound message appears in the timeline
   - unread count increases

Expected result:
- a row is created in `contacts`
- a row is created in `messages` with direction `inbound`

### Phase E. Test outbound reply from CRM

1. Open that contact in `/inbox`
2. Type a reply in the composer
3. Click send

Expected result:
- the patient receives the message on WhatsApp
- a `messages` row is created with direction `outbound`
- `last_outbound_at` updates on the contact

### Phase F. Test pipeline movement

1. Open `/board`
2. Drag the lead between columns

Expected result:
- the contact status updates
- the change persists after refresh

### Phase G. Test settings and staff

1. Open `/settings`
2. Update clinic profile fields and save
3. Add a clinic AI prompt and save
4. Invite a staff member

Notes:
- invites need `SUPABASE_SERVICE_ROLE_KEY`
- role updates and staff disable/reactivate are managed here

## 6. Client demo checklist

Use this order in a live demo:

1. Show `/activate` and explain payment gate
2. Mark payment received from super admin
3. Show `/connect-whatsapp`
4. Scan QR live
5. Send a real test message from another phone
6. Open `/inbox` and reply
7. Open `/board` and move the lead
8. Open dashboard and settings

This is the shortest path from onboarding to visible value.

## 7. Daily workflow for clinic staff

### Inbox

Route: [`src/app/(app)/inbox/page.tsx`](/C:/Users/USER/Downloads/Clinic%20Whatsapp%20CRM/clinic-os/src/app/(app)/inbox/page.tsx)

Use Inbox to:
- open conversations
- read inbound messages
- send manual replies
- pause bot takeover when needed
- update lead details from the right sidebar

### Pipeline

Route: [`src/app/(app)/board/page.tsx`](/C:/Users/USER/Downloads/Clinic%20Whatsapp%20CRM/clinic-os/src/app/(app)/board/page.tsx)

Use Pipeline to move leads between:
- New Lead
- No Respond
- Booked Appointment
- Attended
- No Show
- Trash
- Patient

### Dashboard

Route: [`src/app/(app)/page.tsx`](/C:/Users/USER/Downloads/Clinic%20Whatsapp%20CRM/clinic-os/src/app/(app)/page.tsx)

Use Dashboard to monitor:
- lead volume
- bookings
- attended visits
- revenue
- response time
- handoff volume
- onboarding checklist

### Settings

Route: [`src/app/(app)/settings/page.tsx`](/C:/Users/USER/Downloads/Clinic%20Whatsapp%20CRM/clinic-os/src/app/(app)/settings/page.tsx)

Use Settings to:
- edit clinic profile
- review plan and usage
- reconnect or disconnect WhatsApp
- edit clinic AI prompt
- invite and manage staff

## 8. Important behavior to understand

### `/activate` does not connect WhatsApp

`/activate` means the workspace is still commercially locked.

It is controlled by:
- subscription status
- payment status

The support WhatsApp number shown there is only a contact button for admin support.

### `/connect-whatsapp` is the real WhatsApp setup screen

This page becomes available only after payment is marked received.

It creates or refreshes the Evolution instance and fetches the QR code.

### WhatsApp messages only send when the clinic is fully unlocked

Manual sends are blocked when:
- subscription is not active
- payment is still pending
- WhatsApp is not connected
- the monthly message limit has been reached

## 9. Common problems and fixes

### Problem: `/activate` has no WhatsApp contact button

Fix:
- add `SUPPORT_WHATSAPP_NUMBER`

### Problem: `/admin` says super admin access required

Fix:
- add your user to `agency_admins`

### Problem: `/admin` says service role required

Fix:
- add `SUPABASE_SERVICE_ROLE_KEY`

### Problem: QR page says platform WhatsApp credentials are not configured

Fix:
- add `WHATSAPP_PLATFORM_EVOLUTION_API_URL`
- add `WHATSAPP_PLATFORM_EVOLUTION_API_KEY`
- confirm Evolution API is reachable from the Next.js app

### Problem: QR appears but connection never turns connected

Fix:
- confirm the phone scanned the latest QR
- confirm Evolution API has persistent session storage
- check the webhook URL is reachable by Evolution
- check clinic `webhook_secret` and instance name were saved

### Problem: inbound message does not show in inbox

Fix:
- confirm the clinic number is connected
- confirm Evolution is sending webhooks to `/api/webhooks/whatsapp`
- confirm `APP_BASE_URL` points to a URL Evolution can reach
- confirm the token in the webhook URL matches the clinic `webhook_secret`
- confirm the message came from a direct chat, not a group or broadcast

## 10. Recommended test order before onboarding a real client

1. Self-test with two of your own phones
2. Repeat the same flow on a fresh clinic account
3. Test disconnect and reconnect
4. Test staff invite
5. Test one manual outbound message after reconnect
6. Only then onboard the first client

## 11. Key files for operators and developers

- [`.env.example`](/C:/Users/USER/Downloads/Clinic%20Whatsapp%20CRM/clinic-os/.env.example)
- [`supabase-schema.sql`](/C:/Users/USER/Downloads/Clinic%20Whatsapp%20CRM/clinic-os/supabase-schema.sql)
- [`src/app/activate/page.tsx`](/C:/Users/USER/Downloads/Clinic%20Whatsapp%20CRM/clinic-os/src/app/activate/page.tsx)
- [`src/app/connect-whatsapp/page.tsx`](/C:/Users/USER/Downloads/Clinic%20Whatsapp%20CRM/clinic-os/src/app/connect-whatsapp/page.tsx)
- [`src/app/api/clinic/whatsapp/route.ts`](/C:/Users/USER/Downloads/Clinic%20Whatsapp%20CRM/clinic-os/src/app/api/clinic/whatsapp/route.ts)
- [`src/app/api/webhooks/whatsapp/route.ts`](/C:/Users/USER/Downloads/Clinic%20Whatsapp%20CRM/clinic-os/src/app/api/webhooks/whatsapp/route.ts)
- [`src/app/api/messages/send/route.ts`](/C:/Users/USER/Downloads/Clinic%20Whatsapp%20CRM/clinic-os/src/app/api/messages/send/route.ts)
- [`src/lib/server/whatsapp.ts`](/C:/Users/USER/Downloads/Clinic%20Whatsapp%20CRM/clinic-os/src/lib/server/whatsapp.ts)

## 12. Current recommended next action

Do this now:

1. Fill `.env.local` using `.env.example`
2. Apply `supabase-schema.sql`
3. Add yourself to `agency_admins`
4. Start Evolution API
5. Run `npm run dev`
6. Do the full self-test in Section 5

After that, the app is ready for a controlled client pilot.
