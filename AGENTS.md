# AGENTS.md

## Git rules

- **Commit freely. NEVER push.** The user pushes. Do not run `git push`, ever,
  unless the user explicitly asks in that same message.
- Do not force-push, amend a published commit, or rewrite history.
- Commit only when the user asks, or when a commit was the agreed next step.
- Before committing: run `git status` and `git diff`, stage only intended files,
  and never commit secrets, `.env` files, database URLs, or credentials.
- Leave scratch/diagnostic scripts uncommitted; delete them instead.

## Project

- Task scheduler (Next.js App Router + Postgres/Neon). See `handover.md` for
  current state, live URL, and known blockers.

## Conventions

- Migrations live in `scripts/migrate.mjs` and are additive-first. Never run a
  destructive statement without explicit approval.
- Role permissions are the baseline; per-user overrides in
  `user_permission_overrides` / `user_categories` take precedence, and `deny`
  always wins.