-- NCR workflow steps: NCR Created, Contain, Disposition, Fix, Verify, Closed.
-- Old rows stay openable. open/contained/investigating/corrective_action become the matching new step.
UPDATE "ncr"
SET "status" = CASE "status"
  WHEN 'open' THEN 'ncr_created'
  WHEN 'contained' THEN 'contain'
  WHEN 'investigating' THEN 'disposition'
  WHEN 'corrective_action' THEN 'fix'
  ELSE "status"
END
WHERE "status" IN ('open', 'contained', 'investigating', 'corrective_action');
--> statement-breakpoint
ALTER TABLE "ncr" ALTER COLUMN "status" SET DEFAULT 'ncr_created';
