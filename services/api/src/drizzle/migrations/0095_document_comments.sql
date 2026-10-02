-- Comments on a controlled document or a folder file. One company database, so the rows stay in that company.
CREATE TABLE IF NOT EXISTS "document_comments" (
  "id" serial PRIMARY KEY NOT NULL,
  "document_id" integer REFERENCES "documents"("id"),
  "folder_id" integer,
  "version_id" integer,
  "body" text NOT NULL,
  "author_id" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "document_comments_target" CHECK ("document_id" IS NOT NULL OR "folder_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_comments_document_idx" ON "document_comments" ("document_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_comments_folder_idx" ON "document_comments" ("folder_id", "id");
