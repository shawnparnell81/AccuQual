-- Built-in Director, Lead, Staff, and Read-only, so the rank ladder matches the screen.
INSERT INTO roles (name, description, hierarchy_level, is_protected, permissions) VALUES
  ('director', 'Director — can view the quality system and approve work', 40, true, '[]'::jsonb),
  ('lead', 'Lead — supervises day-to-day work', 60, true, '[]'::jsonb),
  ('staff', 'Staff — day-to-day work', 80, true, '[]'::jsonb),
  ('read_only', 'Read-only — can view records but not change them', 90, true, '[]'::jsonb)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  hierarchy_level = EXCLUDED.hierarchy_level,
  is_protected = true;

-- A custom role whose name matches a built-in, ignoring case (President and president),
-- is the same role. People, sign-on defaults, and required training move onto the built-in.
-- "Vice President" does not match "vice_president", so those stay separate.
UPDATE users AS holder
SET role_id = builtin.id
FROM roles AS custom
JOIN roles AS builtin
  ON lower(builtin.name) = lower(custom.name)
 AND builtin.id <> custom.id
 AND builtin.is_protected = true
 AND custom.is_protected = false
WHERE holder.role_id = custom.id;

UPDATE sso_connections AS connection
SET default_role_id = builtin.id
FROM roles AS custom
JOIN roles AS builtin
  ON lower(builtin.name) = lower(custom.name)
 AND builtin.id <> custom.id
 AND builtin.is_protected = true
 AND custom.is_protected = false
WHERE connection.default_role_id = custom.id;

UPDATE training_courses AS course
SET required_for_role_id = builtin.id
FROM roles AS custom
JOIN roles AS builtin
  ON lower(builtin.name) = lower(custom.name)
 AND builtin.id <> custom.id
 AND builtin.is_protected = true
 AND custom.is_protected = false
WHERE course.required_for_role_id = custom.id;

DELETE FROM roles AS custom
USING roles AS builtin
WHERE lower(builtin.name) = lower(custom.name)
  AND builtin.id <> custom.id
  AND builtin.is_protected = true
  AND custom.is_protected = false;

-- Titles that start with VP or Vice President sit at the Vice President rank.
-- A later word such as engineer must not pull them down.
UPDATE roles
SET hierarchy_level = 30
WHERE is_protected = false
  AND (
    lower(name) ~ '^vp([^a-z0-9]|$)'
    OR lower(name) ~ '^vice[[:space:]_-]*president([^a-z0-9]|$)'
  );

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone text;
