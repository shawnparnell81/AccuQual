ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp DEFAULT now() NOT NULL;
