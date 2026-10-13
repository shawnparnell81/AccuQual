import assert from "node:assert/strict";
import test from "node:test";
import { FORM_TEMPLATES } from "../../../../services/api/src/modules/document-folders/formFiling.ts";
import { blankDraftFromTemplates, blankDraftState, isDeferredCreatePath, readBlankDraft, unsavedBlankPath } from "./blankDraft.ts";

/**
 * Regression: Documents > Blank Forms, a form folder with only the blank template (zero saved copies).
 * The pinned template opens /…/new?formKey=… with the draft in router state, but workspace tabs render
 * every page with `state: null`, so the page showed "Open this form from Blank Forms" and no form.
 * The page must rebuild the same unsaved blank from the formKey, for every deferred form type.
 */
const deferred = FORM_TEMPLATES.filter((t) => t.start && isDeferredCreatePath(t.start.createPath));

test("every deferred blank form opens from formKey alone when router state is null (zero saved copies)", () => {
  assert.ok(deferred.length > 0);
  assert.ok(deferred.some((t) => t.formKey === "frm-val-010" || /AIR STRUT/i.test(t.title)), "Air Strut is a deferred blank");
  for (const template of deferred) {
    const start = template.start!;
    const createPath = start.createPath as Parameters<typeof readBlankDraft>[1];
    // What a kept workspace tab hands the page: no router state at all.
    assert.equal(readBlankDraft(null, createPath), null);
    const url = new URL(`${unsavedBlankPath(start.openPath)}?formKey=${encodeURIComponent(template.formKey)}`, "http://x");
    const draft = blankDraftFromTemplates(url.searchParams.get("formKey"), FORM_TEMPLATES, createPath);
    assert.ok(draft, `${template.formKey} rebuilds its blank`);
    assert.deepEqual(draft, blankDraftState(start)!.blankDraft, `${template.formKey} gets the same blank as Blank Forms`);
  }
});

test("formKey fallback refuses a mismatched or unknown form", () => {
  assert.equal(blankDraftFromTemplates(null, FORM_TEMPLATES, "/validation-reports"), null);
  assert.equal(blankDraftFromTemplates("no-such-form", FORM_TEMPLATES, "/validation-reports"), null);
  const qms = deferred.find((t) => t.start!.createPath === "/qms-forms");
  if (qms) assert.equal(blankDraftFromTemplates(qms.formKey, FORM_TEMPLATES, "/validation-reports"), null);
});
