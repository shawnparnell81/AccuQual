-- Stored PDF exports and legal hold.
-- 0100 through 0105 are unchanged. This file is 0106.
-- Bytes stay on the API disk under the existing attachments folder.
-- An open hold is one row with released_at null. History rows stay.

CREATE TABLE IF NOT EXISTS "pdf_exports" (
  "id" serial PRIMARY KEY NOT NULL,
  "export_id" text NOT NULL,
  "source_module" text NOT NULL,
  "entity_type" text,
  "entity_id" integer,
  "record_number" text DEFAULT '' NOT NULL,
  "revision" text DEFAULT '' NOT NULL,
  "record_status" text,
  "sha256" text NOT NULL,
  "file_size" integer NOT NULL,
  "mime_type" text DEFAULT 'application/pdf' NOT NULL,
  "renderer" text NOT NULL,
  "file_path" text NOT NULL,
  "generated_by" integer REFERENCES "users"("id"),
  "generated_at" timestamp NOT NULL,
  "document_id" integer,
  "folder_id" integer,
  "attachment_id" integer,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pdf_exports_export_id_idx" ON "pdf_exports" ("export_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "legal_holds" (
  "id" serial PRIMARY KEY NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" integer NOT NULL,
  "placed_by" integer REFERENCES "users"("id"),
  "placed_at" timestamp DEFAULT now() NOT NULL,
  "released_by" integer REFERENCES "users"("id"),
  "released_at" timestamp,
  "reason" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "legal_holds_active_idx" ON "legal_holds" ("entity_type", "entity_id") WHERE "released_at" IS NULL;
