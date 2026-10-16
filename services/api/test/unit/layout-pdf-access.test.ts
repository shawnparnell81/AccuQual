import { describe, expect, it } from "vitest";
import { isLayoutPdfPost } from "../../src/middleware/departmentAccess.js";

describe("Download PDF needs only read access", () => {
  it("treats the layout PDF post as a read", () => {
    for (const baseUrl of ["/iso-quality-forms", "/qms-forms", "/validation-reports"]) expect(isLayoutPdfPost({ method: "POST", baseUrl, path: "/12/pdf" })).toBe(true);
  });
  it("leaves every other write alone", () => {
    expect(isLayoutPdfPost({ method: "POST", baseUrl: "/iso-quality-forms", path: "/12/sign" })).toBe(false);
    expect(isLayoutPdfPost({ method: "PATCH", baseUrl: "/iso-quality-forms", path: "/12/pdf" })).toBe(false);
    expect(isLayoutPdfPost({ method: "POST", baseUrl: "/ncr", path: "/12/pdf" })).toBe(false);
    expect(isLayoutPdfPost({ method: "POST", baseUrl: "/qms-forms", path: "/12/pdf/x" })).toBe(false);
  });
});
