-- Per-user UI language preference (account-bound, follows the user to new
-- devices). NULL = no explicit account choice yet -> the client falls back to
-- its device preference (cookie/localStorage), which defaults to German.
ALTER TABLE users ADD COLUMN ui_language TEXT;  -- 'de' | 'en' | NULL
