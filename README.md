# CFT Task Scheduler

A Next.js task scheduling and invoicing app for CoreFusion Technologies.

## Environment Variables

Set these in **Vercel → Settings → Environment Variables** before deploying.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon Postgres connection string (auto-set by Vercel Neon integration) |
| `APP_URL` | ✅ in production | Public HTTPS origin used in email links |
| `APP_TIMEZONE` | Optional | IANA timezone for business dates and reminders (default: `Asia/Karachi`) |
| `SESSION_SECRET` | ✅ | Long random string for signing session cookies |
| `SESSION_TTL_SECONDS` | Optional | Session cookie lifetime in seconds (default: `28800`, clamped to 300–604800) |
| `SUPERADMIN_USERNAME` | Required on first migrate | Seeds the first super admin when the `users` table has none. No default. |
| `SUPERADMIN_PASSWORD` | Required on first migrate | Password for that seeded super admin, 12–1024 characters. No default. |
| `RESEND_API_KEY` | Optional | From [resend.com](https://resend.com) — enables email notifications |
| `RESEND_FROM` | Optional | Verified sender for Resend (for example, `CFT <billing@yourdomain.com>`) |
| `RESEND_FROM_EMAIL` | Optional | Address used as `replyTo` when set |
| `CRON_SECRET` | Required for cron | Protects both reminder cron endpoints |
| `TASK_REMINDER_WINDOW_DAYS` | Optional | Days before task due date to send reminders (default: `2`) |
| `INVOICE_REMINDER_WINDOW_DAYS` | Optional | Days before invoice due date to send reminders (default: `2`) |
| `TASK_CAPACITY_PER_MEMBER` | Optional | Maximum active tasks per team member (default: `1`) |
| `REMINDER_SEND_BUDGET_MS` | Optional | Soft time budget for one reminder cron run (default: `45000`, clamped to 5000–240000) |

> **Important:** The super admin is seeded by `npm run db:migrate` **only when no active
> super admin exists**. That run throws unless `SUPERADMIN_USERNAME` matches
> `^[a-z0-9][a-z0-9._-]{2,149}$` and `SUPERADMIN_PASSWORD` is 12–1024 characters — there is
> no default password. Later runs ignore both variables while an active super admin exists,
> so changing them does not reset an existing account.

## Email notifications (optional)

Email is **reminder-only** today. If `RESEND_API_KEY` is set, the reminder cron jobs send:

- **Task reminders** to the assignee of a task that is due soon or overdue (requires an email on the team member)
- **Invoice reminders** to the client contact of an unpaid invoice that is due soon or overdue (requires `client_email` on the invoice and `client_visible` enabled)

There is currently **no** email on task assignment, task update, or status change.

To enable:
1. Create a free account at [resend.com](https://resend.com)
2. Verify your sending domain (or use their test sender for development)
3. Set `RESEND_API_KEY` and `RESEND_FROM` in Vercel env vars

Both reminder routes return **503 and do nothing** if either variable is missing. If the
variables are set but Resend rejects them (unverified sender, revoked key), the job still runs
and each failure is recorded in `reminder_deliveries` with the Resend error message.

### Testing the email integration

Because a misconfigured sender fails silently in a cron job, there is a guarded diagnostic
endpoint. It requires `CRON_SECRET` and **refuses to send in production** unless
`ALLOW_TEST_EMAIL=1` is set deliberately.

```powershell
# status only - safe, sends nothing
curl http://localhost:3000/api/test-email -H "Authorization: Bearer $env:CRON_SECRET"

# actually send one message
curl -X POST "http://localhost:3000/api/test-email?to=you@example.com" `
     -H "Authorization: Bearer $env:CRON_SECRET"
```

`GET` reports which variables are missing and whether sending is currently permitted. `POST`
sends one real message and returns Resend's own error text on failure, so a bad key or an
unverified sender is visible immediately instead of being discovered by a client.

Note that a Resend account with no verified domain can only send to the account owner's own
address. Client-facing reminders and invoices require a domain you control.

## Daily reminders cron (optional)

Vercel runs `/api/cron/task-reminders` at 03:00 UTC and `/api/cron/invoice-reminders` at 04:00 UTC. The jobs enqueue due-soon and overdue messages in the business timezone, claim deliveries safely, and retry failed sends.

To enable:
1. Set `CRON_SECRET` in Vercel env vars (any random string). Vercel automatically reads
   `vercel.json` and sends it as an `Authorization: Bearer <CRON_SECRET>` header; the routes
   compare it with a timing-safe check.
2. Configure `RESEND_API_KEY` and `RESEND_FROM` — both reminder routes return **503 without
   running** if the email config is incomplete, so set these first or the crons no-op.
3. Each route caps its own runtime at 60s and stops issuing new sends once
   `REMINDER_SEND_BUDGET_MS` is exhausted, releasing anything still in flight so the next run
   can retry it.

## Roles & Permissions

- **Super Admin** — Full access, bypasses all role restrictions, can access `/admin`
- **Members** — Permissions controlled by their assigned role

### Available permissions per role
| Permission | Description |
|---|---|
| `view_tasks` / `view_all_tasks` | View assigned tasks, or every task |
| `create_tasks` | Create tasks |
| `edit_tasks` / `edit_own_tasks` | Edit any task, or only assigned tasks |
| `delete_tasks` | Move tasks to trash |
| `view_invoices` / `manage_invoices` | View invoices, or manage the full invoice lifecycle |
| `create_invoices` / `edit_invoices` / `edit_own_invoices` | Create or edit invoices |
| `record_payments` | Record partial or full payments |
| `view_client_links` / `view_client_portal` | Share tasks and view client-facing views |
| `view_team` / `manage_team` | View or manage team members |
| `manage_availability` | Manage availability settings |
| `manage_categories` / `manage_roles` / `manage_users` / `manage_settings` | Manage application configuration |
| `view_dashboard` | View the operational dashboard |
| `view_activity` | View activity history (enforced on `GET /api/activity`) |
| `upload_files` | Upload task files |

Permission names are stored in the `permissions` table and assigned to roles through
`role_permissions`. The `roles.perm_*` boolean columns are legacy compatibility mirrors: the
role admin APIs keep them in sync with the real permissions via a fixed mapping
(`perm_add_tasks` → `create_tasks`, `perm_edit_tasks` → `edit_tasks`, and so on), and the
dashboard's `perm_*` identifiers are client-side flag names, not column reads. Authorization
is enforced server-side from the session's permission list, not from those columns.

## Deploy

1. Set `DATABASE_URL` locally and run `npm run db:migrate` before deploying.
2. Review the migration output and back up the production database before running it against production.
3. Push to GitHub, import to Vercel, and add Neon Postgres under **Storage**.
4. Set the environment variables above, including `APP_URL` and `CRON_SECRET`.
5. Deploy and verify the migration, login, task, invoice, and reminder flows.

`npm run build` now runs `npm run db:migrate` first via a `prebuild` hook, so Vercel applies
migrations on deploy. The script is idempotent - it records applied migrations in
`app_migrations` and skips them afterwards - so re-running it is safe.

The migration is idempotent for normal schema work, with one exception: on the **first** run
against a database it replaces every existing `share_token` on tasks, invoices, and client
portals with a fresh 32-byte random value, which invalidates all currently shared links. It
then records the migration so later runs leave tokens alone. Treat that first run as an
intentional one-time production operation.

## Invoice numbering

Invoice numbers are `INV-{YEAR}-{NUMBER}` and the sequence is tracked **per year** in
`invoice_number_counters`.

- The first invoice created in a year with no counter row is `INV-{YEAR}-1001`.
- Each subsequent invoice in that year increments by one.
- `npm run db:migrate` seeds a counter for every year that already has invoices, using that
  year's highest existing number (floor `1000`), and never moves a counter backwards.

## Security notes and current limitations

- **Public rate limiting** — enforced in `proxy.js` for `/client/[token]`, `/client-portal/[token]`,
  `/invoice/[token]`, and `/availability`: 60 requests per minute per client IP (60-second window).
  Exceeding the limit returns a real **HTTP 429** with `Retry-After`, `Cache-Control: no-store`, and
  `X-Robots-Tag: noindex` before the page renders. Tracked **in memory per server instance**, so it is
  not shared across instances and resets on deploy. `/` and `/login` are not throttled here, since the
  login form has its own persistent limiter.
- **Login rate limiting** is separate and persistent: 8 attempts per 15 minutes per IP/username,
  tracked in the `login_attempts` table.
- **Share tokens never expire** and there is no dedicated "regenerate/revoke link" action.
  Tokens are issued on create, and a token is nulled when the item is archived and a **new**
  token is issued when it is restored. The only way to rotate a live link without archiving is
  the first-run token rotation inside `npm run db:migrate`.
- **Legacy table** — `task_reminder_deliveries` is still created by the migration but is not
  used by any code. Task reminder delivery state lives in `reminder_deliveries`. It is kept
  only to avoid dropping data; it can be deleted in a later migration once you confirm nothing
  external reads it.
- Migrations are **not** run by the Vercel build. `npm run db:migrate` must be run manually
  against the target database, and it is the step that seeds the first super admin.
