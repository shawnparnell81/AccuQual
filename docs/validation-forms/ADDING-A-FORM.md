# Adding the next validation form from an Excel workbook

A validation form is its Excel workbook, drawn by the app. The workbook gives the layout (cell text, merges, column widths, fonts, fills,
borders, dropdowns, conditional formats, pictures) and the formulas. A small module per form says what the app changes or adds. Nothing
else in the app needs to know the form's rules.

The seven forms built this way (shock, brake wear, electric lift, coil spring, fuel injector, air strut, regular gas lift) are the
worked examples. `shock.ts` is the shortest.

## The pieces

| Piece | Where | What it is |
| --- | --- | --- |
| Workbook | `docs/validation-forms/<name>.xlsx` | The source of truth. Keep it in the repo. |
| Layout | `apps/web/src/lib/validation-forms/layouts/<slug>.layout.ts` | Generated from the workbook. Never edit by hand. |
| Form module | `apps/web/src/lib/validation-forms/forms/<type>.ts` | `buildForm({...})`: the form's number, title, Rev, pass color, words, and every difference from the workbook. |
| Registry | `apps/web/src/lib/validation-forms/registry.ts` | One entry per form. |
| Engine | `apps/web/src/lib/validation-forms/engine.ts` | Evaluates the workbook's formulas (IF, AND, OR, COUNT, COUNTIF, AVERAGE, ABS, LET, TREND, SLOPE ...). |
| Sheet | `apps/web/src/routes/ValidationReports/RegistrySheet.tsx` | Draws any registry form. No per-form component. |

## Steps

1. **Get the workbook into the repo.** Put it in `docs/validation-forms/`. If its tab name has the wrong form number, note it and use the
   right one in the module.
2. **Extract the layout.**
   ```
   cd apps/web
   npx tsx scripts/extract-validation-workbook.ts ../../docs/validation-forms/<file>.xlsx <slug>
   ```
   This writes `layouts/<slug>.layout.ts`. Run it again whenever the workbook changes.
3. **Create the module.** Copy `forms/shock.ts` to `forms/<type>.ts` (or one of the starter files) and set `type`, `docId`, `title`,
   `revision` (the workbook's Rev), `passFill`, `words` (the form's own Pass/Fail words), `docIdCell` and `revCell`.
4. **Look at what the app made of the layout.**
   ```
   npx tsx scripts/dump-validation-layout.ts <type>
   ```
   Each cell shows its kind: `label` (text), `input` (a person types), `select` (dropdown), `check` (tick box), `calc` (formula), `blocked`
   (gray, not applicable), `spacer`. An empty bordered cell is an input, a full-width merged empty band is a spacer, a gray empty cell is
   blocked. Fix what the guess got wrong with `inputs`, `locked`, `lists`, `checks`, `ticks`, `areas`, `clearFill`.
5. **Port nothing by hand.** The workbook's formulas run as written. Only list a difference in `formulas` (Excel syntax, no leading `=`):
   - a workbook bug you corrected (say which, and why, in a comment and in the PR),
   - a pass/fail the form was missing (use the builders in `rules.ts`: a blank input gives a blank result, never a guess),
   - the overall rollup: blank until every required row has a result, then Fail if any failed, otherwise Pass (`overallOf`).
   Use only tolerances that are on the form. Never invent one.
6. **Signatures and extras.** `signatures: [{ addr, path, certify }]` puts an authorized-signature stamp on a cell. `graph: {...}` adds the
   scatter chart panel (Displacement vs Force) for forms whose workbook has a Graphs tab. `patchLayout` adds a cell the workbook lacks.
7. **Register it.** Add one line to `REGISTRY` in `registry.ts`.
8. **Tell the rest of the app the form exists** (a list per place, no logic):
   - web: `lib/validationReport.ts` (`ValidationFormType`, `VALIDATION_FORMS`), the New-form list in `components/layout/CommandPalette.tsx`,
     and the workbook entry in `lib/validation-forms/workbookParity.test.ts`;
   - API: the zod form-type list (`modules/validation-reports/validation-reports.validation.ts`), the drizzle type union
     (`drizzle/schema/validationReport.ts`), `document-folders/editableForms.ts` and `formFiling.ts` (blank form catalog, Rev map, folder),
     `forms/templateStructure.ts` (version and Rev), `signatures/signatureRequired.ts`, the certification text in
     `validation-reports.controller.ts`, and the display names in `dashboard.openWork.ts`, `executive.data.ts`, `recordDeletion.ts`,
     `validationNcr.ts`, `validationReportPdf.ts`.
   - FAI auto-attach: add the product family's pattern to `modules/fai-inspection/fai-product-type.ts` (order matters: more specific
     patterns first) and its form to the attach map in `fai-inspection.service.ts`.
9. **Test it.** Copy the stub below into `lib/validation-forms/<type>.test.ts` and fill it in.
10. **REV.** The REV only changes when the template changes. A saved record keeps the Rev it was saved under.

## Test stub

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MY_FORM as form } from "./forms/my_form.ts";
import { showValue } from "./engine.ts";
import { readWorkbookSample, sameValue } from "./workbookSample.ts";

const text = (values: ReturnType<typeof form.evaluate>, addr: string) => showValue(values[addr]);

describe("FRM-VAL-0xx my form: the workbook, ported", () => {
  it("is drawn from the workbook at its Rev", () => {
    assert.equal(form.def.revision, "A");
    assert.ok(form.def.layout.merges.length > 0);
  });

  it("every formula the form did not change gives the result Excel stored", async () => {
    const sample = await readWorkbookSample("My-Form-RevA.xlsx");
    const values = form.evaluate(sample.constants);
    const changed = new Set(Object.keys(form.def.formulas ?? {}));
    for (const [at, expected] of Object.entries(sample.cached)) {
      if (changed.has(at) || !form.formulas[at]) continue;
      assert.ok(sameValue(values[at], expected), `${at}: app ${text(values, at)} vs Excel ${showValue(expected)}`);
    }
  });

  it("a ported formula passes inside its band and fails outside it", () => {
    const values = form.evaluate({ ...form.blank(), C12: 10, D12: 1, E12: 10.5, F12: 12 });
    assert.equal(text(values, "G12"), "Pass");
    assert.equal(text(values, "H12"), "Fail");
  });

  it("a new pass/fail row is blank until it can be judged", () => {
    assert.equal(text(form.evaluate(form.blank()), "G20"), "");
  });

  it("the overall result is blank until every required row has one, then Fail if any failed, otherwise Pass", () => {
    assert.equal(form.status(form.evaluate(form.blank())), "");
    // fill every required row, then:
    // assert.equal(form.status(form.evaluate(filled)), "Pass");
    // filled.F26 = 999; assert.equal(form.status(form.evaluate(filled)), "Fail");
  });
});
```
