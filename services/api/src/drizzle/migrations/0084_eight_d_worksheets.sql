-- Worksheet tabs on an 8D report. Each column stores the cells the user
-- types on that sheet. Calculated cells are not stored.
ALTER TABLE "eight_d" ADD COLUMN IF NOT EXISTS "problem_description_d2" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "eight_d" ADD COLUMN IF NOT EXISTS "problem_solving_worksheet_d4" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "eight_d" ADD COLUMN IF NOT EXISTS "testing_possible_causes_d4" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "eight_d" ADD COLUMN IF NOT EXISTS "decision_making" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "eight_d" ADD COLUMN IF NOT EXISTS "risk_analysis" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "eight_d" ADD COLUMN IF NOT EXISTS "plan_problem_prevention" jsonb DEFAULT '{}'::jsonb NOT NULL;
