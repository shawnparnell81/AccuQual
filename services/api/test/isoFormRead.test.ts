import { describe, expect, it } from "vitest";
import { canonicalIsoFormType, normalizeIsoFormData } from "../src/modules/iso-quality-forms/isoFormRead.js";

describe("ISO form read", () => {
  it("maps a stored form key back to the sheet type", () => {
    expect(canonicalIsoFormType("ncr_report")).toBe("ncr_report");
    expect(canonicalIsoFormType("frm-ncr-001")).toBe("ncr_report");
    expect(canonicalIsoFormType("FRM-NCR-001")).toBe("ncr_report");
  });

  it("keeps cell objects as text and refuses a non-object payload", () => {
    expect(normalizeIsoFormData('{"cells":{"B3":{"note":"kept"},"B4":true}}')).toEqual({
      cells: { B3: '{"note":"kept"}', B4: true },
    });
    expect(() => normalizeIsoFormData("{")).toThrow();
    expect(() => normalizeIsoFormData([])).toThrow();
  });
});
