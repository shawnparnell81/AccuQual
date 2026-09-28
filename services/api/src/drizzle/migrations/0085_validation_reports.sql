-- CSA Validation Report records (FRM-VAL-001). Filled cells live in data.
CREATE TABLE "validation_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
