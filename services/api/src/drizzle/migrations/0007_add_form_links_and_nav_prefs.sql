CREATE TABLE "nav_hidden_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "document_folders" ADD COLUMN "linked_path" text;--> statement-breakpoint
ALTER TABLE "nav_hidden_items" ADD CONSTRAINT "nav_hidden_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nav_hidden_items_tenant_scope_idx" ON "nav_hidden_items" USING btree ("tenant_id","scope");