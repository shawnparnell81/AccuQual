ALTER TABLE "document_versions" ADD COLUMN "approval_notes" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "expiration_date" timestamp;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "expiration_warning_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "retention_period_days" integer DEFAULT 365 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "retention_action" text DEFAULT 'archive' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "retention_state" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_folders" ADD COLUMN "document_id" integer;--> statement-breakpoint
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;