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
| `SUPERADMIN_USERNAME` | ✅ | Super admin login username (default: `admin`) |
| `SUPERADMIN_PASSWORD` | ✅ | Super admin login password (default: `changeme123`) |
| `RESEND_API_KEY` | Optional | From [resend.com](https://resend.com) — enables email notifications |
| `RESEND_FROM` | Optional | Verified sender for Resend (for example, `CFT <billing@yourdomain.com>`) |
| `CRON_SECRET` | Required for cron | Protects both reminder cron endpoints |
| `TASK_REMINDER_WINDOW_DAYS` | Optional | Days before task due date to send reminders (default: `2`) |
| `INVOICE_REMINDER_WINDOW_DAYS` | Optional | Days before invoice due date to send reminders (default: `2`) |
| `TASK_CAPACITY_PER_MEMBER` | Optional | Maximum active tasks per team member (default: `1`) |

> **Important:** The super admin account is created automatically on first authenticated run after the database migration if none exists.
> Change `SUPERADMIN_USERNAME` and `SUPERADMIN_PASSWORD` from their defaults before going live.

## Email notifications (optional)

If `RESEND_API_KEY` is set:
- Team members get emailed when a task is assigned or updated (requires email set on team member)
- Clients get emailed when their task status changes (requires client email set on task)

To enable:
1. Create a free account at [resend.com](https://resend.com)
2. Verify your sending domain (or use their test sender for development)
3. Set `RESEND_API_KEY` and `RESEND_FROM` in Vercel env vars

## Daily reminders cron (optional)

Vercel runs `/api/cron/task-reminders` at 03:00 UTC and `/api/cron/invoice-reminders` at 04:00 UTC. The jobs enqueue due-soon and overdue messages in the business timezone, claim deliveries safely, and retry failed sends.

To enable:
1. Set `CRON_SECRET` in Vercel env vars (any random string).
2. Configure `RESEND_API_KEY` and `RESEND_FROM` if email delivery is required.
3. Vercel automatically reads `vercel.json` and sends the secret as a Bearer token.

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

Permission names are stored in the `permissions` table and assigned to roles through `role_permissions`; the old `perm_*` fields remain only as compatibility columns.

## Deploy

1. Set `DATABASE_URL` locally and run `npm run db:migrate` before deploying.
2. Review the migration output and back up the production database before running it against production.
3. Push to GitHub, import to Vercel, and add Neon Postgres under **Storage**.
4. Set the environment variables above, including `APP_URL` and `CRON_SECRET`.
5. Deploy and verify the migration, login, task, invoice, and reminder flows.

The migration is idempotent for normal schema work, but rotating share tokens invalidates existing task, invoice, and client-portal links. Run it as an intentional one-time production operation.

## Invoice numbering

Invoices auto-number as `INV-{YEAR}-{NUMBER}` starting from `INV-2026-1005`.
The number always increments from the highest existing invoice across all years.
