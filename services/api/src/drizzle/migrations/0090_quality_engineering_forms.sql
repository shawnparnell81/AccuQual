-- Filled PSW, turtle diagram, quality alert, first article, customer scorecard,
-- and failure-effectiveness records share iso_quality_forms with the earlier
-- ISO sheets. This index keeps each subject list to one form type.
-- NCR and CAPA tables are unchanged.
CREATE INDEX IF NOT EXISTS "iso_quality_forms_form_type_idx" ON "iso_quality_forms" ("form_type");
