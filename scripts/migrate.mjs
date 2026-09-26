import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const target = new URL(connectionString);
console.log(`Migration target: ${target.hostname} / ${target.pathname.replace(/^\//, '') || '(default db)'}`);

const sql = neon(connectionString);
const migrationName = '2026_09_25_security_and_integrity';
const migrationTable = await sql`SELECT to_regclass('public.app_migrations')::text AS table_name`;
const existingMigration = migrationTable[0]?.table_name
  ? await sql`SELECT 1 FROM app_migrations WHERE name = ${migrationName} LIMIT 1`
  : [];
const alreadyMigrated = existingMigration.length > 0;
const statements = [
  `SELECT pg_advisory_xact_lock(741902)`,
  `CREATE TABLE IF NOT EXISTS app_migrations (
    name VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    color VARCHAR(7) NOT NULL DEFAULT '#6B6760',
    perm_add_tasks BOOLEAN NOT NULL DEFAULT FALSE,
    perm_edit_tasks BOOLEAN NOT NULL DEFAULT FALSE,
    perm_delete_tasks BOOLEAN NOT NULL DEFAULT FALSE,
    perm_view_all_tasks BOOLEAN NOT NULL DEFAULT FALSE,
    perm_view_client_links BOOLEAN NOT NULL DEFAULT FALSE,
    perm_manage_availability BOOLEAN NOT NULL DEFAULT FALSE,
    perm_manage_invoices BOOLEAN NOT NULL DEFAULT FALSE,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150),
    username VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'staff',
    role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
    theme VARCHAR(20) NOT NULL DEFAULT 'auto',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    session_version INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    id SERIAL PRIMARY KEY,
    username VARCHAR(150) NOT NULL,
    ip VARCHAR(128) NOT NULL,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    position VARCHAR(150) NOT NULL DEFAULT '',
    email VARCHAR(254) NOT NULL UNIQUE,
    phone VARCHAR(50),
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    color VARCHAR(7) NOT NULL DEFAULT '#6c757d',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS role_categories (
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, category_id)
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    client_name VARCHAR(255) NOT NULL DEFAULT '',
    client_email VARCHAR(254) NOT NULL DEFAULT '',
    project_name VARCHAR(255) NOT NULL DEFAULT '',
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    assigned_to INTEGER REFERENCES team_members(id) ON DELETE SET NULL,
    start_date DATE NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'not_started',
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    progress INTEGER NOT NULL DEFAULT 0,
    payment_status VARCHAR(30) NOT NULL DEFAULT 'unpaid',
    amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
    client_visible BOOLEAN NOT NULL DEFAULT FALSE,
    share_token VARCHAR(255),
    created_by VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS task_activity (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    username VARCHAR(150) NOT NULL,
    action VARCHAR(50) NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    invoice_number VARCHAR(50) NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    client_email VARCHAR(254) NOT NULL,
    client_company VARCHAR(255) NOT NULL DEFAULT '',
    client_address TEXT NOT NULL DEFAULT '',
    project_name VARCHAR(255) NOT NULL DEFAULT '',
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'unpaid',
    payment_status VARCHAR(30) NOT NULL DEFAULT 'unpaid',
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
    tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount NUMERIC(14,2) NOT NULL DEFAULT 0,
    total NUMERIC(14,2) NOT NULL DEFAULT 0,
    amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
    share_token VARCHAR(255),
    notes TEXT NOT NULL DEFAULT '',
    terms TEXT NOT NULL DEFAULT '',
    client_visible BOOLEAN NOT NULL DEFAULT FALSE,
    created_by VARCHAR(150) NOT NULL DEFAULT '',
    created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_items (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC(12,2) NOT NULL,
    unit_price NUMERIC(14,2) NOT NULL,
    amount NUMERIC(14,2) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_payments (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount NUMERIC(14,2) NOT NULL,
    paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor TEXT NOT NULL,
    source VARCHAR(40) NOT NULL DEFAULT 'manual'
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_number_counters (
    year INTEGER PRIMARY KEY,
    last_value INTEGER NOT NULL CHECK (last_value >= 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS client_portals (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    client_name VARCHAR(255) NOT NULL DEFAULT '',
    client_email VARCHAR(254) NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    token VARCHAR(255) NOT NULL UNIQUE,
    created_by VARCHAR(150) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS task_reminder_deliveries (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
    scheduled_for DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 1,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    error TEXT,
    PRIMARY KEY (task_id, member_id, scheduled_for),
    CONSTRAINT task_reminder_status_check CHECK (status IN ('pending', 'sent', 'failed'))
  )`,
  `CREATE TABLE IF NOT EXISTS reminder_deliveries (
    id BIGSERIAL PRIMARY KEY,
    dedupe_key VARCHAR(255) NOT NULL UNIQUE,
    reminder_type VARCHAR(40) NOT NULL,
    entity_type VARCHAR(20) NOT NULL,
    entity_id BIGINT,
    scheduled_for DATE NOT NULL,
    recipient VARCHAR(254) NOT NULL,
    subject VARCHAR(200) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    next_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    provider_message_id TEXT,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT reminder_delivery_status_check CHECK (status IN ('pending', 'sending', 'retry', 'sent', 'cancelled', 'dead')),
    CONSTRAINT reminder_delivery_attempts_check CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 10)
  )`,
  `ALTER TABLE reminder_deliveries DROP CONSTRAINT IF EXISTS reminder_delivery_status_check`,
  `ALTER TABLE reminder_deliveries ADD CONSTRAINT reminder_delivery_status_check CHECK (status IN ('pending', 'sending', 'retry', 'sent', 'cancelled', 'dead'))`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS color VARCHAR(7) NOT NULL DEFAULT '#6B6760'`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS perm_add_tasks BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS perm_edit_tasks BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS perm_delete_tasks BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS perm_view_all_tasks BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS perm_view_client_links BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS perm_manage_availability BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS perm_manage_invoices BOOLEAN NOT NULL DEFAULT FALSE`,
  `UPDATE roles SET
     perm_add_tasks = COALESCE(perm_add_tasks, FALSE),
     perm_edit_tasks = COALESCE(perm_edit_tasks, FALSE),
     perm_delete_tasks = COALESCE(perm_delete_tasks, FALSE),
     perm_view_all_tasks = COALESCE(perm_view_all_tasks, FALSE),
     perm_view_client_links = COALESCE(perm_view_client_links, FALSE),
     perm_manage_availability = COALESCE(perm_manage_availability, FALSE),
     perm_manage_invoices = COALESCE(perm_manage_invoices, FALSE)
   WHERE perm_add_tasks IS NULL OR perm_edit_tasks IS NULL OR perm_delete_tasks IS NULL
      OR perm_view_all_tasks IS NULL OR perm_view_client_links IS NULL
      OR perm_manage_availability IS NULL OR perm_manage_invoices IS NULL`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE roles ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`,
  `UPDATE roles SET color = '#6B6760' WHERE color IS NULL OR color = ''`,
  `ALTER TABLE roles ALTER COLUMN color SET DEFAULT '#6B6760'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(20) NOT NULL DEFAULT 'auto'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(150)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL`,
  `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS position VARCHAR(150) NOT NULL DEFAULT ''`,
  `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`,
  `DO $$ BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'team_members' AND column_name = 'role'
     ) THEN
       EXECUTE format('UPDATE team_members SET position = COALESCE(NULLIF(position, %L), NULLIF(role, %L), %L) WHERE position = %L', '', '', '', '');
     END IF;
   END $$`,
  `ALTER TABLE categories ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `ALTER TABLE categories ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS title VARCHAR(255)`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_title VARCHAR(255)`,
  `UPDATE tasks SET title = COALESCE(NULLIF(title, ''), NULLIF(task_title, ''), 'Untitled task') WHERE title IS NULL OR title = ''`,
  `UPDATE tasks SET task_title = title WHERE task_title IS NULL OR task_title = ''`,
  `ALTER TABLE tasks ALTER COLUMN title SET NOT NULL`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS client_name VARCHAR(255) NOT NULL DEFAULT ''`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS client_email VARCHAR(254) NOT NULL DEFAULT ''`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_name VARCHAR(255) NOT NULL DEFAULT ''`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS client_visible BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by VARCHAR(150)`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`,
  `ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
  `ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS username VARCHAR(150) NOT NULL DEFAULT ''`,
  `ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS action VARCHAR(50) NOT NULL DEFAULT 'legacy'`,
  `ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS details TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE task_activity ADD COLUMN IF NOT EXISTS actor TEXT`,
  `ALTER TABLE task_activity ALTER COLUMN task_id DROP NOT NULL`,
  `CREATE TABLE IF NOT EXISTS task_assignees (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_id, member_id)
  )`,
  `CREATE INDEX IF NOT EXISTS task_assignees_member_index ON task_assignees (member_id, task_id)`,
  `INSERT INTO task_assignees (task_id, member_id, is_primary)
    SELECT id, assigned_to, TRUE FROM tasks WHERE assigned_to IS NOT NULL
    ON CONFLICT (task_id, member_id) DO NOTHING`,
  `UPDATE task_assignees SET is_primary = FALSE WHERE is_primary
    AND task_id NOT IN (SELECT id FROM tasks WHERE assigned_to = task_assignees.member_id)`,
  `WITH ranked AS (
    SELECT task_id, member_id,
      ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY created_at, member_id) AS position
    FROM task_assignees
    WHERE is_primary
  )
    UPDATE task_assignees SET is_primary = FALSE
    FROM ranked
    WHERE task_assignees.task_id = ranked.task_id
      AND task_assignees.member_id = ranked.member_id
      AND ranked.position > 1`,
  `CREATE UNIQUE INDEX IF NOT EXISTS task_assignees_one_primary_index ON task_assignees (task_id) WHERE is_primary`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issue_date DATE`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_date DATE`,
  `UPDATE invoices SET issue_date = COALESCE(issue_date, invoice_date, due_date, CURRENT_DATE) WHERE issue_date IS NULL`,
  `UPDATE invoices SET invoice_date = COALESCE(invoice_date, issue_date) WHERE invoice_date IS NULL`,
  `ALTER TABLE invoices ALTER COLUMN issue_date SET NOT NULL`,
  `ALTER TABLE invoices ALTER COLUMN invoice_date SET NOT NULL`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by VARCHAR(150) NOT NULL DEFAULT ''`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_company VARCHAR(255) NOT NULL DEFAULT ''`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_address TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS project_name VARCHAR(255) NOT NULL DEFAULT ''`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) NOT NULL DEFAULT 'unpaid'`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS status VARCHAR(30)`,
  `UPDATE invoices SET status = CASE WHEN payment_status = 'paid' THEN 'paid' WHEN payment_status IN ('partial', 'partially_paid', 'deposit_paid', 'part_paid') THEN 'partially_paid' ELSE 'unpaid' END WHERE status IS NULL OR status NOT IN ('unpaid', 'partially_paid', 'paid')`,
  `ALTER TABLE invoices ALTER COLUMN status SET DEFAULT 'unpaid'`,
  `ALTER TABLE invoices ALTER COLUMN status SET NOT NULL`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS terms TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2)`,
  `UPDATE invoice_items SET amount = ROUND(COALESCE(quantity, 0) * COALESCE(unit_price, 0), 2) WHERE amount IS NULL`,
  `ALTER TABLE invoice_items ALTER COLUMN amount SET DEFAULT 0`,
  `ALTER TABLE invoice_items ALTER COLUMN amount SET NOT NULL`,
  `ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'USD'`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subtotal NUMERIC(14,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS total NUMERIC(14,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`,
  `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_visible BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE client_portals ADD COLUMN IF NOT EXISTS name VARCHAR(255)`,
  `ALTER TABLE client_portals ADD COLUMN IF NOT EXISTS client_name VARCHAR(255) NOT NULL DEFAULT ''`,
  `ALTER TABLE client_portals ADD COLUMN IF NOT EXISTS client_email VARCHAR(254) NOT NULL DEFAULT ''`,
  `ALTER TABLE client_portals ADD COLUMN IF NOT EXISTS created_by VARCHAR(150) NOT NULL DEFAULT ''`,
  `ALTER TABLE client_portals ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`,
  `UPDATE tasks SET updated_at = COALESCE(updated_at, NOW())`,
  `UPDATE invoices SET updated_at = COALESCE(updated_at, NOW())`,
  `DO $$ BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'task_activity' AND column_name = 'username'
     ) THEN
       EXECUTE 'UPDATE task_activity SET actor = username WHERE actor IS NULL';
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'task_activity' AND column_name = 'message'
     ) THEN
        EXECUTE format('UPDATE task_activity SET details = jsonb_build_object(''message'', message)::text WHERE details = %L', '');
     END IF;
   END $$`,
  `UPDATE task_activity SET username = COALESCE(NULLIF(username, ''), NULLIF(actor, ''), 'legacy') WHERE username = ''`,
  `UPDATE task_activity SET actor = COALESCE(NULLIF(actor, ''), NULLIF(username, ''), 'legacy') WHERE actor IS NULL`,
  `UPDATE client_portals SET name = COALESCE(NULLIF(name, ''), NULLIF(client_name, ''), 'Legacy portal ' || id::text)`,
  `UPDATE client_portals SET created_by = 'migration' WHERE created_by = ''`,
  `UPDATE client_portals portal SET name = portal.name || ' ' || portal.id::text WHERE portal.id IN (
     SELECT id FROM (
       SELECT id, ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY id) AS position
       FROM client_portals WHERE archived_at IS NULL
     ) ranked WHERE ranked.position > 1
   )`,
  `ALTER TABLE client_portals ALTER COLUMN name SET NOT NULL`,
  `UPDATE invoices SET payment_status = CASE WHEN status = 'paid' THEN 'paid' WHEN status IN ('partial', 'partially_paid') THEN 'partially_paid' ELSE 'unpaid' END`,
  `UPDATE tasks SET status = 'done' WHERE status IN ('completed', 'complete', 'finished', 'closed')`,
  `UPDATE tasks SET status = 'in_progress' WHERE status IN ('in progress', 'in-progress', 'started', 'active', 'pending')`,
  `UPDATE tasks SET status = 'not_started' WHERE status IS NULL OR status NOT IN ('not_started', 'in_progress', 'review', 'done')`,
  `UPDATE tasks SET payment_status = CASE payment_status WHEN 'fully_paid' THEN 'paid' WHEN 'deposit_paid' THEN 'partially_paid' ELSE 'unpaid' END WHERE payment_status NOT IN ('unpaid', 'partially_paid', 'paid')`,
  `ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check`,
  `ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('not_started', 'in_progress', 'review', 'done'))`,
  `ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_payment_status_check`,
  `ALTER TABLE tasks ADD CONSTRAINT tasks_payment_status_check CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid'))`,
  `UPDATE invoices invoice SET subtotal = totals.subtotal, tax_amount = totals.tax_amount, total = totals.total FROM (
     SELECT target.id,
       COALESCE(SUM(items.amount), 0)::numeric AS subtotal,
       ROUND(COALESCE(SUM(items.amount), 0) * COALESCE(target.tax_rate, 0) / 100, 2) AS tax_amount,
       GREATEST(0, ROUND(COALESCE(SUM(items.amount), 0) * (1 + COALESCE(target.tax_rate, 0) / 100) - COALESCE(target.discount, 0), 2)) AS total
     FROM invoices target
     LEFT JOIN invoice_items items ON items.invoice_id = target.id
     GROUP BY target.id, target.tax_rate, target.discount
   ) totals WHERE invoice.id = totals.id`,
  `ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_date_order_check`,
  `ALTER TABLE tasks ADD CONSTRAINT tasks_date_order_check CHECK (start_date <= due_date) NOT VALID`,
  `ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_date_order_check`,
  `ALTER TABLE invoices ADD CONSTRAINT invoices_date_order_check CHECK (issue_date <= due_date) NOT VALID`,
  `ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_amounts_check`,
  `ALTER TABLE invoices ADD CONSTRAINT invoices_amounts_check CHECK (subtotal >= 0 AND tax_amount >= 0 AND total >= 0 AND tax_rate >= 0 AND tax_rate <= 100 AND discount >= 0 AND amount_paid >= 0 AND amount_paid <= total) NOT VALID`,
  `ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check`,
  `ALTER TABLE invoices ADD CONSTRAINT invoices_status_check CHECK (status IN ('unpaid', 'partially_paid', 'paid'))`,
  `ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_payment_status_check`,
  `ALTER TABLE invoices ADD CONSTRAINT invoices_payment_status_check CHECK (payment_status IN ('unpaid', 'partially_paid', 'paid'))`,
  `ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS invoice_items_values_check`,
  `ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_values_check CHECK (quantity > 0 AND unit_price >= 0 AND amount >= 0) NOT VALID`,
  `ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS invoice_payments_amount_check`,
  `ALTER TABLE invoice_payments ADD CONSTRAINT invoice_payments_amount_check CHECK (amount <> 0)`,
  `UPDATE tasks SET share_token = share_token || '-' || id::text WHERE id NOT IN (SELECT MIN(id) FROM tasks GROUP BY share_token)`,
  `UPDATE invoices SET share_token = share_token || '-' || id::text WHERE id NOT IN (SELECT MIN(id) FROM invoices GROUP BY share_token)`,
  `UPDATE client_portals SET token = token || '-' || id::text WHERE id NOT IN (SELECT MIN(id) FROM client_portals GROUP BY token)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS roles_name_unique ON roles (name)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique ON users (lower(username))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS invoices_invoice_number_unique ON invoices (invoice_number)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tasks_share_token_unique ON tasks (share_token) WHERE share_token IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS invoices_share_token_unique ON invoices (share_token) WHERE share_token IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_portals_token_unique ON client_portals (token)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_portals_name_active_unique ON client_portals (lower(name)) WHERE archived_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS tasks_listing_index ON tasks (archived_at, status, due_date)`,
  `CREATE INDEX IF NOT EXISTS tasks_dates_index ON tasks (start_date, due_date) WHERE archived_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS invoices_listing_index ON invoices (archived_at, status, due_date)`,
  `CREATE INDEX IF NOT EXISTS task_activity_task_index ON task_activity (task_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS task_activity_created_index ON task_activity (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS login_attempts_ip_index ON login_attempts (ip, success, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS task_reminder_due_index ON task_reminder_deliveries (status, scheduled_for)`,
  `CREATE INDEX IF NOT EXISTS reminder_delivery_dispatch_index ON reminder_deliveries (status, next_attempt, scheduled_for)`,
  `INSERT INTO permissions (name, description) VALUES
    ('view_tasks', 'View tasks'),
    ('view_all_tasks', 'View every task'),
    ('create_tasks', 'Create tasks'),
    ('edit_tasks', 'Edit all tasks'),
    ('edit_own_tasks', 'Edit assigned tasks'),
    ('delete_tasks', 'Delete tasks'),
    ('upload_files', 'Upload task files'),
    ('view_team', 'View team members'),
    ('manage_team', 'Manage team members'),
    ('view_invoices', 'View invoices'),
    ('create_invoices', 'Create invoices'),
    ('edit_invoices', 'Edit all invoices'),
    ('edit_own_invoices', 'Edit own invoices'),
    ('record_payments', 'Record invoice payments'),
    ('manage_invoices', 'Manage invoices'),
    ('view_dashboard', 'View operational dashboard'),
    ('view_activity', 'View activity history'),
    ('view_client_portal', 'View client portal'),
    ('view_client_links', 'Create and view client links'),
    ('manage_availability', 'Manage availability settings'),
    ('manage_roles', 'Manage roles and permissions'),
    ('manage_categories', 'Manage task categories'),
    ('manage_users', 'Manage users'),
    ('manage_settings', 'Manage application settings')
  ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description`,
  `INSERT INTO roles (name, description, is_system, perm_add_tasks, perm_edit_tasks, perm_delete_tasks, perm_view_all_tasks, perm_view_client_links, perm_manage_availability, perm_manage_invoices) VALUES
    ('superadmin', 'Full system access', TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE),
    ('admin', 'Operational administrator', TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE),
    ('staff', 'Team member', TRUE, TRUE, FALSE, FALSE, FALSE, TRUE, FALSE, TRUE),
    ('client', 'Client portal user', TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE)
  ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, is_system = TRUE`,
  `UPDATE users SET role_id = roles.id
   FROM roles
   WHERE users.role_id IS NULL AND lower(users.role) = lower(roles.name)`,
  `INSERT INTO role_permissions (role_id, permission_id)
  SELECT roles.id, permissions.id
  FROM roles
  CROSS JOIN permissions
  WHERE roles.name = 'superadmin'
  ON CONFLICT DO NOTHING`,
  `INSERT INTO role_permissions (role_id, permission_id)
  SELECT roles.id, permissions.id
  FROM roles
  CROSS JOIN permissions
  WHERE roles.name = 'admin'
    AND permissions.name NOT IN ('manage_users')
  ON CONFLICT DO NOTHING`,
  `INSERT INTO role_permissions (role_id, permission_id)
  SELECT roles.id, permissions.id
  FROM roles
  CROSS JOIN permissions
  WHERE roles.name = 'staff'
    AND permissions.name IN (
      'view_tasks', 'create_tasks', 'edit_own_tasks', 'upload_files', 'view_team',
      'view_invoices', 'create_invoices', 'edit_own_invoices', 'record_payments',
      'view_dashboard', 'view_activity', 'view_client_portal', 'view_client_links',
      'manage_availability'
    )
  ON CONFLICT DO NOTHING`,
  `INSERT INTO role_permissions (role_id, permission_id)
  SELECT roles.id, permissions.id
  FROM roles
  CROSS JOIN permissions
  WHERE roles.name = 'client' AND permissions.name = 'view_client_portal'
  ON CONFLICT DO NOTHING`,
  `INSERT INTO invoice_number_counters (year, last_value)
  SELECT substring(invoice_number FROM 5 FOR 4)::integer,
    GREATEST(1000, COALESCE(MAX((regexp_match(invoice_number, '^INV-[0-9][0-9][0-9][0-9]-([0-9]+)$'))[1]::integer), 1000))
  FROM invoices
  WHERE invoice_number ~ '^INV-[0-9][0-9][0-9][0-9]-[0-9]+$'
  GROUP BY substring(invoice_number FROM 5 FOR 4)
  ON CONFLICT (year) DO UPDATE SET last_value = GREATEST(invoice_number_counters.last_value, EXCLUDED.last_value)`,
  `INSERT INTO invoice_payments (invoice_id, amount, paid_at, actor, source)
  SELECT id, amount_paid, COALESCE(updated_at, created_at, NOW()), 'migration', 'migration_estimate'
  FROM invoices
  WHERE amount_paid <> 0
    AND NOT EXISTS (SELECT 1 FROM invoice_payments payment WHERE payment.invoice_id = invoices.id)
  ON CONFLICT DO NOTHING`,
];

const existingTables = await sql`
  SELECT to_regclass('public.invoices')::text AS invoices,
         to_regclass('public.users')::text AS users,
         to_regclass('public.roles')::text AS roles
`;
const duplicateInvoices = existingTables[0]?.invoices ? await sql`
  SELECT invoice_number, COUNT(*)::int AS count
  FROM invoices
  GROUP BY invoice_number
  HAVING COUNT(*) > 1
  LIMIT 10
` : [];
const duplicateUsernames = existingTables[0]?.users ? await sql`
  SELECT lower(username) AS username, COUNT(*)::int AS count
  FROM users
  GROUP BY lower(username)
  HAVING COUNT(*) > 1
  LIMIT 10
` : [];
const duplicateRoleNames = existingTables[0]?.roles ? await sql`
  SELECT lower(name) AS name, COUNT(*)::int AS count
  FROM roles
  GROUP BY lower(name)
  HAVING COUNT(*) > 1
  LIMIT 10
` : [];
if (duplicateRoleNames.length) {
  throw new Error(`Duplicate role names must be resolved before migration: ${duplicateRoleNames.map(row => row.name).join(', ')}`);
}
if (duplicateInvoices.length) {
  throw new Error(`Duplicate invoice numbers must be resolved before migration: ${duplicateInvoices.map(row => row.invoice_number).join(', ')}`);
}
if (duplicateUsernames.length) {
  throw new Error(`Duplicate usernames must be resolved before migration: ${duplicateUsernames.map(row => row.username).join(', ')}`);
}

await sql.transaction(statements.map(statement => sql(statement)), { isolationLevel: 'Serializable' });

if (!alreadyMigrated) {
  const tokenSets = [
    ['tasks', 'share_token', 'archived_at IS NULL'],
    ['invoices', 'share_token', 'archived_at IS NULL'],
    ['client_portals', 'token', 'archived_at IS NULL'],
  ];
  for (const [table, column, filter] of tokenSets) {
    const rows = await sql(
      `SELECT id::text FROM ${table} WHERE ${column} IS NOT NULL OR (${filter})`,
    );
    if (!rows.length) continue;
    const updates = rows.map(row => sql(
      `UPDATE ${table} SET ${column} = $1 WHERE id = $2`,
      [randomBytes(32).toString('base64url'), row.id],
    ));
    await sql.transaction(updates);
  }
  await sql`INSERT INTO app_migrations (name) VALUES (${migrationName}) ON CONFLICT DO NOTHING`;
}

const superadmins = await sql`
  SELECT id
  FROM users
  WHERE role = 'superadmin' AND active = TRUE AND archived_at IS NULL
  LIMIT 1
`;
if (!superadmins[0]) {
  const username = String(process.env.SUPERADMIN_USERNAME || '').trim().toLowerCase();
  const password = String(process.env.SUPERADMIN_PASSWORD || '');
  if (!/^[a-z0-9][a-z0-9._-]{2,149}$/.test(username)) {
    throw new Error('SUPERADMIN_USERNAME is required when no superadmin exists');
  }
  if (password.length < 12 || password.length > 1024) {
    throw new Error('SUPERADMIN_PASSWORD must contain 12 to 1024 characters');
  }
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(password, salt, 310000, 32, 'sha256');
  const hash = `pbkdf2_sha256$310000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
  const seeded = await sql`
    WITH lock AS MATERIALIZED (SELECT pg_advisory_xact_lock(741903))
    INSERT INTO users (name, username, password_hash, role, role_id, active)
    SELECT ${username}, ${username}, ${hash}, 'superadmin', roles.id, TRUE
    FROM roles, lock
    WHERE roles.name = 'superadmin'
      AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'superadmin')
    RETURNING id
  `;
  if (!seeded[0]) throw new Error('Unable to create the initial superadmin');
  console.log('Database migration completed and initial superadmin created.');
} else {
  console.log('Database migration completed.');
}
