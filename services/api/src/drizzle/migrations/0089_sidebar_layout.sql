-- Company-wide sidebar arrangement. Empty means the built-in order.
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "sidebar_layout" jsonb;
