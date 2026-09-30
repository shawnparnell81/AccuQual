-- Hashed 4-digit signature PIN. The hash is never returned to the client.
ALTER TABLE "users" ADD COLUMN "pin_hash" text;
ALTER TABLE "users" ADD COLUMN "pin_set_at" timestamp;
ALTER TABLE "users" ADD COLUMN "pin_failed_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "users" ADD COLUMN "pin_locked_until" timestamp;
