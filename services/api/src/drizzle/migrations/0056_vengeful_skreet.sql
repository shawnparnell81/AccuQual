CREATE TABLE "audit_row_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"table_name" text NOT NULL,
	"row_id" integer,
	"op" text NOT NULL,
	"changes" jsonb NOT NULL,
	"actor_user_id" integer,
	"txid" bigint DEFAULT txid_current(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "audit_trail" ADD COLUMN "txid" bigint;--> statement-breakpoint
ALTER TABLE "audit_trail" ALTER COLUMN "txid" SET DEFAULT txid_current();--> statement-breakpoint
CREATE INDEX "audit_row_changes_row_idx" ON "audit_row_changes" USING btree ("tenant_id","table_name","row_id");--> statement-breakpoint
CREATE INDEX "audit_row_changes_tx_idx" ON "audit_row_changes" USING btree ("tenant_id","txid");