-- 0008_terms_acceptance.sql — record which Nutzungsvereinbarung a user accepted.
--
-- At sign-up the client sends the accepted terms version (src/lib/legal.ts
-- TERMS_VERSION); the server stamps the acceptance time. Together these are the
-- proof of consent for a given account: WHICH wording, and WHEN. Both are
-- nullable so pre-existing accounts (and any future non-interactive path) simply
-- have no recorded acceptance rather than a wrong one; bump TERMS_VERSION on the
-- client whenever the wording changes materially. Applied exactly once by the
-- migration runner (schema_migrations), so bare ADD COLUMNs are safe.
ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER;
