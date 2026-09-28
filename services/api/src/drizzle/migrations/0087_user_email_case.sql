-- Sign-in already treats an email address as the same person regardless of capital letters.
-- Store one lowercase address, and stop a second account for that same inbox.
-- When two accounts already differ only by capital letters or surrounding spaces, the older
-- account keeps the address. The later one is marked so an administrator can tell them apart.

WITH ranked AS (
  SELECT id,
         lower(btrim(email)) AS normalized,
         row_number() OVER (PARTITION BY lower(btrim(email)) ORDER BY id) AS n
  FROM users
)
UPDATE users AS u
SET email = split_part(r.normalized, '@', 1) || '+duplicate' || u.id::text || '@' || split_part(r.normalized, '@', 2)
FROM ranked AS r
WHERE u.id = r.id
  AND r.n > 1;
--> statement-breakpoint
UPDATE users
SET email = lower(btrim(email))
WHERE email IS DISTINCT FROM lower(btrim(email));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_idx" ON "users" ((lower(btrim("email"))));
