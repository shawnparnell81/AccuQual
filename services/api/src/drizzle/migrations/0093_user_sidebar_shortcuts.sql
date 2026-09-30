-- Per-user sidebar shortcuts. Null means the shared menu, with nothing extra pinned.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sidebar_shortcuts" jsonb;
