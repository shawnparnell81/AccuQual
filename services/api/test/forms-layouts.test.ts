// Pure-logic unit test — no DB (see company-isolation.test.ts's header
// comment on the distinction). Full-System Audit finding H3: `audit_checklist`
// was a real FORM_TYPES entry with no layout registered for it, so
// pdf-merger.ts's mergePdfFields fell all the way through to a plain
// key:value dump instead of a structured render, unlike its Audits-family
// siblings audit_plan/lpa.
import { describe, expect, it } from "vitest";
import { getFormLayout } from "../src/modules/forms/layouts/index.js";
import { renderFormLayoutAsPdf } from "../src/modules/forms/schema-pdf-renderer.js";

describe("audit_checklist form layout", () => {
  it("is registered — getFormLayout no longer returns undefined for it", () => {
    const layout = getFormLayout("audit_checklist");
    expect(layout).toBeTruthy();
    expect(layout!.formType).toBe("audit_checklist");
    expect(layout!.sections.length).toBeGreaterThan(0);
  });

  it("every other Audits-family form type still has its own real layout — no regression from adding this one", () => {
    expect(getFormLayout("audit_plan")?.formType).toBe("audit_plan");
    expect(getFormLayout("lpa")?.formType).toBe("lpa");
  });

  it("renders as a real structured PDF via the same renderer every other layout uses, not the plain-dump fallback", async () => {
    const layout = getFormLayout("audit_checklist")!;
    const bytes = await renderFormLayoutAsPdf(layout, {
      auditTitle: "Q3 Internal Process Audit",
      checklistItems: [{ question: "Is the work instruction current at the workstation?", response: ["Compliant"], evidenceComments: "Rev C posted 2027-01-02" }],
    });
    expect(bytes.byteLength).toBeGreaterThan(0);
    // A real PDF, not an empty buffer or a thrown error swallowed somewhere.
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });
});
