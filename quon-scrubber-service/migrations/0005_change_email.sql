-- 0005_change_email.sql - support the "change email" flow.
--
-- Reuses the single-use email_tokens table with purpose='change_email'. The
-- confirmation link goes to the new address; new_email holds the requested
-- address until the user confirms (then it is written to users.email). Nullable
-- because verify/reset tokens don't use it. Applied exactly once by the migration
-- runner (schema_migrations), so a bare ADD COLUMN is safe.
ALTER TABLE email_tokens ADD COLUMN new_email TEXT;
