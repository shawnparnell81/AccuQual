import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("master list permission bypass", () => {
  it("does not grant master-list or equipment writes from a role, department, or name", () => {
    const files = [
      "src/middleware/departmentAccess.ts",
      "src/middleware/requirePermission.ts",
      "src/modules/records/recordDeletion.ts",
      "src/modules/documents/documents.versions.routes.ts",
    ];
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(source).not.toContain("canMaintainMasterList");
      expect(source).not.toContain("isMasterListWrite");
      expect(source).not.toContain("isMasterToolListEditPath");
    }
  });
});
