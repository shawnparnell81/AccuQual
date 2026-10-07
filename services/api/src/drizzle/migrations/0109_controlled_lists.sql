-- Living controlled lists: Master Equipment List, Master Document List,
-- and Scope of Laboratory Activities. One row per list.
-- Editing data does not change revision.
-- 0100 through 0108 are unchanged. This file is 0109.

CREATE TABLE IF NOT EXISTS "controlled_lists" (
  "id" serial PRIMARY KEY,
  "list_key" text NOT NULL,
  "revision" text NOT NULL,
  "sheets" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp,
  CONSTRAINT "controlled_lists_list_key_uq" UNIQUE ("list_key")
);
