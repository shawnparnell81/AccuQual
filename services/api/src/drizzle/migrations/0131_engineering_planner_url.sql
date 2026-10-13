-- Engineering Planner link becomes a per-company setting (company.profile.engineeringPlannerUrl).
-- The existing company keeps the link that used to be built into the menu, so nothing changes for it.
UPDATE company
SET profile = COALESCE(profile, '{}'::jsonb) || jsonb_build_object('engineeringPlannerUrl', 'https://mtollefson-rgb.github.io/Engineering-Planner/')
WHERE COALESCE(profile ->> 'engineeringPlannerUrl', '') = '';
