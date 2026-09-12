ALTER TABLE "training_assignments" ADD COLUMN "assigned_by" integer;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD COLUMN "trainer_name" text;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD COLUMN "certificate_path" text;--> statement-breakpoint
ALTER TABLE "training_courses" ADD COLUMN "document_id" integer;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;