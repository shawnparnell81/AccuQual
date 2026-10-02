-- Rows removed from the Master Document List stay off the list after deploy.
-- The document or blank form itself is not deleted.
CREATE TABLE IF NOT EXISTS "master_list_omissions" (
  "id" serial PRIMARY KEY NOT NULL,
  "list_key" text NOT NULL,
  "source" text NOT NULL,
  "source_key" text NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "created_by" integer REFERENCES "users"("id"),
  CONSTRAINT "master_list_omissions_row_unique" UNIQUE("list_key","source","source_key")
);
