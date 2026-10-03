# Handover — Task Scheduler (appv5)

**Date:** 2026-10-01
**Repo:** `C:\Users\ADMIN\Desktop\CFT\Core Things\task-scheduler-v5-fixed\appv5`
**Branch:** `master`
**Live URL:** https://task-scheduler-cft.vercel.app — ⚠ **not deployed.** Verified 2026-10-03: every path, including `/`, returns an *empty 404* from Vercel's edge rather than a 500. No deployment is serving that hostname, so there is no application error to debug; the project needs deploying. Nothing in the working tree can be responsible, because all of it is uncommitted. The Neon database behind it is reachable and healthy.
**Local login page:** http://localhost:3100/login (`npx next start -p 3100`)

---

## Where things stand

Latest pushed commit at time of writing: **`00f2feb`** plus one uncommitted
change set described under "In flight" below.

Phase status:

| Phase | State |
|---|---|
| 0 — hardening | Done (14 bugs fixed) |
| 1 — UX / public behaviour | Done |
| 2 — UI refresh | Done |
| 3 — product decisions | Partial. Manual share-link revoke/regenerate shipped. Time-based token expiry still an open decision. |
| 4 — launch readiness | Code done and pushed. Production deploy blocked on Vercel access (see Blocked). |
| 5 — optional features | Not started. Attachments, payments, OAuth, 2FA, password reset. |

The app is a task/invoice tracker for a small agency: tasks have a client,
category, assignee, due date, status and optional share link; invoices track
payment status. Public client portals exist at `/client/<token>`.

---

## In flight (uncommitted, verified, ready to push)

### Board view was broken — fixed

`BoardView` threw a `ReferenceError` on open because the `BOARD_COLUMNS`
constant had been deleted in an earlier edit. Restored at
`app/dashboard/page.js`:

```js
const BOARD_COLUMNS = ['not_started', 'in_progress', 'review', 'done'];
```

Also fixed the board cards reading `task.title` when the field is
`task_title`. The same wrong-name bug appeared in four other places (share
link prompts, trash restore confirm/toast) — all corrected. Note the DB has
*both* `title` and `task_title` columns and the API aliases them, so
`item.title` in the activity feed at `page.js:1296` is correct and was left
alone.

### Theme reverted to orange

The blue/navy palette from the previous turn is gone. `--navy*` tokens were
renamed to `--rail*` and given warm values so the sidebar follows the light
and dark themes instead of staying navy:

- `--accent: #B84F24`, `--accent-dark: #963B18`, `--accent-soft: #F9EDE5`
- `--bg: #F3EEE6`, `--card: #FFFFFF`, `--line: #E4DED5`
- `--rail: #F7F2EA` light / `#14120F` dark, `--rail-active` tracks `--accent`
- Dark mode: `--accent: #E8733D`, `--bg: #171513`

The navy→rail rename was done by string replacement across all 18
references. **If you reintroduce a navy sidebar, add `--rail*` values rather
than `--navy*`.**

### Session bug: password/email change logged you out

`lib/session.js` `signSession()` read `user.session_version`, but every
caller passes `sessionVersion` (camelCase). Result: the renewed token was
stamped `sv: 0`, `getFreshSession` compared it against the real DB value, and
returned 401 — the user was kicked out immediately after changing their
password. Now accepts either casing:

```js
const sessionVersion = user.session_version ?? user.sessionVersion ?? 0;
```

This bug existed before this work. It only showed up once identity changes
became reachable from the UI.

### Self-service settings

New page `app/settings/page.js`, linked from the sidebar's Workspace group.
Two cards: Profile (display name, email, username, theme) and Password.

`PUT /api/me` was rewritten in `app/api/me/route.js`:

- Every signed-in user may change their own name, email, username, password,
  theme.
- `role`, `role_id` and `active` are still rejected with 403 — those stay
  superadmin-only.
- Changing email, username or password requires `current_password`
  (400 if absent, 403 if wrong). Name and theme alone do not.
- Identity changes bump `session_version`, invalidating other devices.
- Email and username uniqueness are checked and return 409 with a
  field-level message.
- New password must be ≥12 chars and differ from the current one.
- Opportunistically upgrades a weak stored hash while the plaintext password
  is in hand.

New `email VARCHAR(254)` column on `users` plus a partial unique index on
`LOWER(email)` where non-empty (`scripts/migrate.mjs`). Runs automatically on
`prebuild`. `normalizeEmail()` added to `lib/validation.js`.

`lib/auth.js` now selects `email` and `name` so they appear on the session.

---

## Verification performed

```
npm run typecheck   clean
npm run lint        0 errors, 0 warnings
npm test            8/8 passed
npm run build       compiled, 17/17 static pages
```

Authenticated smoke test against `next start -p 3100`, real superadmin login:
21 assertions covering board render, orange tokens in the shipped CSS
bundle, settings page 200, email change accepted, and rejection of
no-password (400), wrong-password (403), malformed email (400), role
escalation (403) and short password (400). **All passed.**

The smoke-test email was cleared afterwards; `users.email` for the
superadmin is now `NULL`, and `users.name` is back to `admin`. No other data
was touched. Encoding verified clean (0 mojibake) on all eight changed
files. Secret scan clean.

---

## Completed 2026-10-03 (uncommitted)

**Per-user permission overrides.** Roles stay the baseline; one person can now
be widened or narrowed without inventing a role. `allow` adds, `deny` removes,
deny wins, implied permissions are re-applied then re-denied. Stored in
`user_permission_overrides` + `user_categories`. Resolved in
`getFreshSession()` on every request, so a change is live on the target's next
request — `session_version` is deliberately *not* bumped, which would have
signed them out. Overrides on a superadmin are rejected outright rather than
stored inert. UI: three-state control (From role / Always allow / Never) plus
category chips, with a `Custom` badge on affected accounts.

**Completed tasks are locked.** `status = 'done'` freezes title, description,
notes, client, dates, category, assignees and progress. Two exceptions, both
needed in practice: reopening by moving the status off `done`, and payment
settlement (`payment_status` / `amount_paid`), because money usually arrives
after the work is done. Enforced in the API — `PUT` is refused with 409 — and
mirrored in the edit modal, which disables the frozen fields and offers
Reopen.

**Public booking requests.** The availability page now has clickable open days
and a request form (honeypot + two rate limits), posting to
`/api/booking-requests` into a new `booking_requests` table. Confirmed with a
dashboard → Requests tab behind the new `manage_booking_requests` permission.
Gotcha: `proxy.js` gates every `/api/*` path behind a session cookie, so that
route had to be added to `PUBLIC_PATHS` — the page rendered while the POST
returned 401, which is exactly the kind of thing a build cannot catch.

**Role audit.** Least-privilege defaults now enforced by DELETE statements
(the `INSERT ... ON CONFLICT` seeds could only ever add). `superadmin` 24/24,
`admin` 23/24 (no `manage_users`), `staff` 11/24, `client` 1/24. Removed the
phantom `upload_files` permission — it was seeded and advertised in the admin
UI but no upload feature has ever existed.

**Visual fixes.** Button gradients replaced with a flat solid fill (also
`.btn-link`, which would otherwise have stayed gradient). The public status
badge was failing contrast badly — `not_started` measured **2.55:1** on
`--accent-soft`, and the 1px border made the pill read as a box on the card.
Added per-status `--status-*-bg/fg` pairs; all four statuses now pass AA in
both themes (light 5.9–6.5:1, dark 7.9–8.6:1). Applied to both the client link
and the client portal.

**Three pre-existing bugs found and fixed**, all the same root cause:
`db.transaction` returns one result-set *per statement*, so
`const [row] = await db.transaction(...)` yields the row **array**, not the
row. `PUT /api/admin/users/[id]` tested `if (!updated)`, which is always false
for `[]` — the "last active superadmin cannot be removed" guard never fired and
would have reported success while silently refusing the change. `POST
/api/admin/users` and `POST /api/admin/roles` returned `{"user":{"0":{...}}}`.
All three now index the first element correctly.

---

## Blocked / needs you

1. **Vercel deploy — now the top blocker.** The documented live URL serves no
   deployment (empty 404 from the edge on every path). Until it is deployed,
   none of the work below is reachable by clients, including the public
   booking form. `npm i -g vercel` → `vercel link` → `vercel env pull .env.local` → `vercel --prod`.
2. **Email delivery.** Parked. `RESEND_API_KEY` is a placeholder,
   `RESEND_FROM` is `billing@yourdomain.com`, no domain verified,
   `reminder_deliveries` has 0 rows. The new `users.email` column is now
   available to send to.
3. **Secret rotation.** `SESSION_SECRET` and the superadmin password were
   exposed in an earlier shared screenshot. Both should be rotated. Requires
   Vercel/account access.
4. **Share-link expiry.** Manual revoke/regenerate works. Automatic
   time-based expiry is still a product decision.
5. **`TASK_CAPACITY_PER_MEMBER=1`** unchanged, awaiting your call.
6. **Staff lost three permissions in the 2026-10-03 audit**
   (`create_invoices`, `record_payments`, and the never-implemented
   `upload_files`). This was deliberate least-privilege tightening, but it is
   a behaviour change for existing staff accounts. If anyone was raising
   invoices or booking payments, restore it per person in
   Admin → Permissions, or put it back on the `staff` role.
7. **Four archived test users remain** in `users`: `ovtest_allow_*` and
   `ovtest_deny_*` (two pairs, `active = false`). They were created by the
   permission-override test runs and kept for audit. Say the word and they
   can be deleted; nothing references them.
8. **Two custom roles exist** that were not seeded by the migration:
   `Special role` (id 22, 8 read-only permissions, 0 users) and an archived
   `Developer` (id 9, 0 users). Left untouched — they are your data.

Do not purchase domains, deploy to production, rotate secrets, or delete data
without explicit approval. Preserve the `Website Dev` account and never
blanket-delete `login_attempts`.

---

## Gotchas worth knowing

- **`task_title` vs `title`.** Tasks have both columns in the DB; the task
  list API aliases `t.title AS task_title`. New UI code should use
  `task_title`.
- **Board drag is optimistic.** `moveTaskToStatus` relocates the card
  immediately, PATCHes with the `updated_at` timestamp the server expects,
  and rolls back with a toast on 409. Cards open on click, Enter or Space.
- **Never edit these files via PowerShell `Get-Content`/`Set-Content`.**
  PS 5.1 defaults to a different encoding and corrupted `page.js` once
  already. Use the editor tool, or `node` with explicit `'utf8'`. Verify with
  the mojibake regex after.
- **Board markup is client-rendered.** The served HTML only contains the
  loading skeleton, so curl-style assertions on the dashboard page report
  false negatives. Assert against `.next/static/chunks/*.js` instead.
- **Smoke tests mutate data.** Board drags and settings tests write to the
  DB. Always snapshot the original values and restore them, and re-check
  `updated_at` / audit rows afterwards.
- **Login endpoint is `/api/login`**, not `/api/auth/login`.
- The design brief you supplied asked for a header search field; it was
  omitted on purpose because you asked to remove search entirely.