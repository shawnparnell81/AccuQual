-- Module-specific RBAC build (2026-09-16): the automated Supplier RMA
-- Request event trail keeps its exact data and behavior, only its name
-- moves -- "rma_log" is freed for the new, manually-maintained RMA Log
-- register added in the next migration. A hand-written custom migration
-- (drizzle-kit generate --custom) rather than an auto-generated one: a
-- plain RENAME is unambiguous and lossless, where drizzle-kit's own
-- interactive rename-vs-drop-and-create resolver can't run headlessly in
-- this environment.
ALTER TABLE "rma_log" RENAME TO "rma_activity_log";
--> statement-breakpoint
ALTER INDEX "rma_log_rma_idx" RENAME TO "rma_activity_log_rma_idx";
--> statement-breakpoint
ALTER INDEX "rma_log_tenant_id_idx" RENAME TO "rma_activity_log_tenant_id_idx";
