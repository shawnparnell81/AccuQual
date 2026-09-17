ALTER TABLE "crar" ADD COLUMN "rma_log_id" integer;--> statement-breakpoint
ALTER TABLE "crar" ADD COLUMN "customer_id" integer;--> statement-breakpoint
ALTER TABLE "crar" ADD CONSTRAINT "crar_rma_log_id_rma_log_id_fk" FOREIGN KEY ("rma_log_id") REFERENCES "public"."rma_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crar" ADD CONSTRAINT "crar_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;