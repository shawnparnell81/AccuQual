-- Plant on CSA and Fuel Pump first-article records so a later NCR can be opened in that plant.
-- Existing rows stay null. New submissions store the signer's current plant.
-- 0100 through 0104 are unchanged. This file is 0105.
ALTER TABLE "csa_fai_records" ADD COLUMN IF NOT EXISTS "site_id" integer REFERENCES "sites"("id");
--> statement-breakpoint
ALTER TABLE "fuel_pump_fai_records" ADD COLUMN IF NOT EXISTS "site_id" integer REFERENCES "sites"("id");
