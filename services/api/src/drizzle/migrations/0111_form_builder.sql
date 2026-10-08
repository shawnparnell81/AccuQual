-- Forms designed in the app. A filled copy is a separate row and does not change the template.

CREATE TABLE IF NOT EXISTS "built_forms" (
  "id" serial PRIMARY KEY,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "form_number" text,
  "revision" text NOT NULL DEFAULT 'A',
  "status" text NOT NULL DEFAULT 'draft',
  "structure" jsonb NOT NULL,
  "published_structure" jsonb,
  "folder_id" integer REFERENCES "document_folders"("id"),
  "created_by" integer REFERENCES "users"("id"),
  "updated_by" integer REFERENCES "users"("id"),
  "published_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "built_form_revisions" (
  "id" serial PRIMARY KEY,
  "form_id" integer NOT NULL REFERENCES "built_forms"("id") ON DELETE CASCADE,
  "revision" text NOT NULL,
  "structure" jsonb NOT NULL,
  "summary" text NOT NULL,
  "saved_by" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "built_form_fills" (
  "id" serial PRIMARY KEY,
  "form_id" integer NOT NULL REFERENCES "built_forms"("id"),
  "template_revision" text NOT NULL,
  "template_form_number" text,
  "structure" jsonb NOT NULL,
  "title" text NOT NULL,
  "answers" jsonb NOT NULL,
  "folder_id" integer REFERENCES "document_folders"("id"),
  "created_by" integer REFERENCES "users"("id"),
  "updated_by" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "built_form_revisions_form_idx" ON "built_form_revisions" ("form_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "built_form_fills_form_idx" ON "built_form_fills" ("form_id");
--> statement-breakpoint
-- Default department access. An administrator can change these rows. Existing choices are left alone.
INSERT INTO "department_permissions" ("department_name", "module_name", "access_level")
VALUES ('quality', 'form_builder', 'edit'), ('engineering', 'form_builder', 'edit')
ON CONFLICT ("department_name", "module_name") DO NOTHING;
--> statement-breakpoint
-- Named permission roles an administrator can edit or assign. Does not attach them to people.
INSERT INTO "permission_roles" ("role_name", "description", "hierarchy_level")
SELECT v.role_name, v.description, v.hierarchy_level
FROM (
  VALUES
    ('Quality Manager', 'Can build and revise forms.', 50),
    ('Engineering Manager', 'Can build and revise forms.', 50),
    ('Engineers', 'Can build and revise forms.', 70),
    ('Quality', 'Can build and revise forms.', 70),
    ('VP of Quality and Engineering', 'Can build and revise forms.', 30),
    ('Product Engineers', 'Can build and revise forms.', 70)
) AS v(role_name, description, hierarchy_level)
WHERE NOT EXISTS (SELECT 1 FROM "permission_roles" pr WHERE pr.role_name = v.role_name);
--> statement-breakpoint
INSERT INTO "permission_role_modules" ("role_id", "module_name", "access_level")
SELECT pr.id, 'form_builder', 'edit'
FROM "permission_roles" pr
WHERE pr.role_name IN (
  'Quality Manager',
  'Engineering Manager',
  'Engineers',
  'Quality',
  'VP of Quality and Engineering',
  'Product Engineers'
)
ON CONFLICT ("role_id", "module_name") DO NOTHING;
--> statement-breakpoint
-- System roles whose titles match those jobs start with Form Builder checked. A later edit of the role is kept.
UPDATE "roles"
SET "permissions" = COALESCE("permissions", '[]'::jsonb) || '["form_builder"]'::jsonb
WHERE NOT (COALESCE("permissions", '[]'::jsonb) @> '["form_builder"]'::jsonb)
AND (
  lower("name") IN (
    'quality_manager',
    'quality manager',
    'engineering manager',
    'engineering_manager',
    'engineer',
    'engineers',
    'quality',
    'product engineer',
    'product engineers',
    'product_engineer',
    'product_engineers',
    'vp of quality and engineering',
    'vice president of quality and engineering'
  )
  OR (
    lower("name") ~ '(^|[^a-z])(vp|vice[\s_-]*president)([^a-z]|$)'
    AND lower("name") ~ 'quality|engineering|engineer'
  )
  OR (lower("name") ~ 'quality' AND lower("name") ~ 'manager')
  OR (lower("name") ~ 'manager' AND lower("name") ~ 'engineer')
  OR lower("name") ~ '(^|[^a-z])engineers?([^a-z]|$)'
);
