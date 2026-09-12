ALTER TABLE "users" ADD COLUMN "department" text;
--> statement-breakpoint
-- Best-effort backfill from existing role names (see navConfig.ts / departmentAccess.ts
-- for what each department unlocks). Roles with no clear department mapping
-- (operator, supplier, customer) are left NULL rather than guessed — an
-- operator today isn't distinguished by department in the seed data, and
-- supplier/customer are external portal accounts, not internal staff.
UPDATE "users" u
SET "department" = 'quality'
FROM "roles" r
WHERE u."role_id" = r."id" AND r."name" IN ('quality_manager', 'auditor');