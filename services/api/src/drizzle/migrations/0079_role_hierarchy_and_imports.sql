ALTER TABLE "roles" ADD COLUMN "hierarchy_level" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "is_protected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "permissions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "roles" SET "hierarchy_level" = 15, "is_protected" = true, "permissions" = '["import_data"]'::jsonb WHERE "name" = 'admin';--> statement-breakpoint
UPDATE "roles" SET "hierarchy_level" = 50, "is_protected" = true WHERE "name" = 'quality_manager';--> statement-breakpoint
UPDATE "roles" SET "hierarchy_level" = 80, "is_protected" = true WHERE "name" = 'operator';--> statement-breakpoint
UPDATE "roles" SET "hierarchy_level" = 92, "is_protected" = true WHERE "name" = 'auditor';--> statement-breakpoint
UPDATE "roles" SET "hierarchy_level" = 95, "is_protected" = true WHERE "name" = 'supplier';--> statement-breakpoint
UPDATE "roles" SET "hierarchy_level" = 100, "is_protected" = true WHERE "name" = 'customer';--> statement-breakpoint
UPDATE "roles" SET "hierarchy_level" = CASE
  WHEN lower("name") IN ('vp', 'vice_president', 'vice president') OR lower("name") LIKE '%vice president%' OR lower("name") LIKE '%vice_president%' THEN 30
  WHEN lower("name") LIKE '%president%' THEN 20
  WHEN lower("name") LIKE '%owner%' THEN 10
  WHEN lower("name") IN ('admin', 'administrator') THEN 15
  WHEN lower("name") LIKE '%director%' THEN 40
  WHEN lower("name") LIKE '%manager%' THEN 50
  WHEN lower("name") LIKE '%supervisor%' OR lower("name") LIKE '%lead%' THEN 60
  WHEN lower("name") LIKE '%engineer%' OR lower("name") LIKE '%specialist%' OR lower("name") LIKE '%inspector%' OR lower("name") LIKE '%technician%' THEN 70
  WHEN lower("name") LIKE '%auditor%' THEN 92
  WHEN lower("name") LIKE '%supplier%' THEN 95
  WHEN lower("name") LIKE '%customer%' THEN 100
  WHEN lower("name") LIKE '%viewer%' OR lower("name") LIKE '%read_only%' OR lower("name") LIKE '%read only%' OR lower("name") LIKE '%guest%' THEN 90
  ELSE 80
END
WHERE "is_protected" = false;--> statement-breakpoint
INSERT INTO "roles" ("name", "description", "hierarchy_level", "is_protected", "permissions") VALUES
  ('owner', 'Owner — full access to everything', 10, true, '["import_data"]'::jsonb),
  ('president', 'President — can view the quality system and approve work', 20, true, '[]'::jsonb),
  ('vice_president', 'Vice President — can view the quality system and approve work', 30, true, '[]'::jsonb)
ON CONFLICT ("name") DO UPDATE SET
  "is_protected" = true,
  "description" = COALESCE("roles"."description", EXCLUDED."description"),
  "hierarchy_level" = EXCLUDED."hierarchy_level",
  "permissions" = CASE
    WHEN EXCLUDED."name" IN ('owner', 'admin') THEN '["import_data"]'::jsonb
    ELSE "roles"."permissions"
  END;--> statement-breakpoint
ALTER TABLE "permission_roles" ADD COLUMN "hierarchy_level" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
UPDATE "permission_roles" SET "hierarchy_level" = CASE
  WHEN lower("role_name") IN ('vp', 'vice_president', 'vice president') OR lower("role_name") LIKE '%vice president%' OR lower("role_name") LIKE '%vice_president%' THEN 30
  WHEN lower("role_name") LIKE '%president%' THEN 20
  WHEN lower("role_name") LIKE '%owner%' THEN 10
  WHEN lower("role_name") IN ('admin', 'administrator') THEN 15
  WHEN lower("role_name") LIKE '%director%' THEN 40
  WHEN lower("role_name") LIKE '%manager%' THEN 50
  WHEN lower("role_name") LIKE '%supervisor%' OR lower("role_name") LIKE '%lead%' THEN 60
  WHEN lower("role_name") LIKE '%engineer%' OR lower("role_name") LIKE '%specialist%' OR lower("role_name") LIKE '%inspector%' OR lower("role_name") LIKE '%technician%' THEN 70
  WHEN lower("role_name") LIKE '%auditor%' THEN 92
  WHEN lower("role_name") LIKE '%supplier%' THEN 95
  WHEN lower("role_name") LIKE '%customer%' THEN 100
  WHEN lower("role_name") LIKE '%viewer%' OR lower("role_name") LIKE '%read_only%' OR lower("role_name") LIKE '%read only%' OR lower("role_name") LIKE '%guest%' THEN 90
  ELSE 80
END;--> statement-breakpoint
CREATE TABLE "data_imports" (
  "id" serial PRIMARY KEY NOT NULL,
  "entity_key" text NOT NULL,
  "file_name" text NOT NULL,
  "file_path" text NOT NULL,
  "file_size" integer,
  "mime_type" text,
  "status" text DEFAULT 'uploaded' NOT NULL,
  "bad_row_mode" text DEFAULT 'skip' NOT NULL,
  "duplicate_mode" text DEFAULT 'skip' NOT NULL,
  "send_invites" boolean DEFAULT false NOT NULL,
  "mapping" jsonb,
  "total_rows" integer DEFAULT 0 NOT NULL,
  "processed_rows" integer DEFAULT 0 NOT NULL,
  "created_count" integer DEFAULT 0 NOT NULL,
  "updated_count" integer DEFAULT 0 NOT NULL,
  "skipped_count" integer DEFAULT 0 NOT NULL,
  "failed_count" integer DEFAULT 0 NOT NULL,
  "headers" jsonb,
  "sample" jsonb,
  "problems" jsonb,
  "error_report_path" text,
  "message" text,
  "started_by" integer,
  "created_at" timestamp DEFAULT now(),
  "completed_at" timestamp
);--> statement-breakpoint
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roles_hierarchy_level_idx" ON "roles" USING btree ("hierarchy_level","name");--> statement-breakpoint
CREATE INDEX "permission_roles_hierarchy_level_idx" ON "permission_roles" USING btree ("hierarchy_level","role_name");--> statement-breakpoint
CREATE INDEX "data_imports_created_at_idx" ON "data_imports" USING btree ("created_at");