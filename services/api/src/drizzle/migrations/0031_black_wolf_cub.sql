ALTER TABLE "feasibility_scores" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "feasibility_scores" CASCADE;--> statement-breakpoint
ALTER TABLE "feasibility_reviews" DROP CONSTRAINT "feasibility_reviews_reviewer_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "feasibility_reviews" DROP COLUMN "source_type";--> statement-breakpoint
ALTER TABLE "feasibility_reviews" DROP COLUMN "source_id";--> statement-breakpoint
ALTER TABLE "feasibility_reviews" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "feasibility_reviews" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "feasibility_reviews" DROP COLUMN "overall_score";--> statement-breakpoint
ALTER TABLE "feasibility_reviews" DROP COLUMN "decision";--> statement-breakpoint
ALTER TABLE "feasibility_reviews" DROP COLUMN "department";--> statement-breakpoint
ALTER TABLE "feasibility_reviews" DROP COLUMN "reviewer_id";--> statement-breakpoint
ALTER TABLE "feasibility_reviews" DROP COLUMN "decided_at";--> statement-breakpoint
ALTER TABLE "feasibility_reviews" DROP COLUMN "risk_level";--> statement-breakpoint
ALTER TABLE "feasibility_reviews" DROP COLUMN "risk_level_set_manually";--> statement-breakpoint
ALTER TABLE "feasibility_reviews" DROP COLUMN "customer_requirement";--> statement-breakpoint
ALTER TABLE "feasibility_reviews" DROP COLUMN "mapped_requirement_category";