-- "Zuletzt aktiv" must survive the session rows it was derived from: logout
-- DELETEs the session and the periodic purge drops expired ones, so a user
-- whose last action was a logout showed "—" in the admin table (reported
-- 2026-08-07 with a screenshot). The timestamp now lives on the user row,
-- updated (throttled) on every authenticated request; backfill from whatever
-- sessions still exist.
ALTER TABLE users ADD COLUMN last_active_at INTEGER;
UPDATE users SET last_active_at =
  (SELECT MAX(s.last_seen) FROM sessions s WHERE s.user_id = users.id);
