import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("master lists follow assigned permissions instead of a hardcoded maintainer list", () => {
  const files = [
    "src/routes/Documents/MasterDocumentListPage.tsx",
    "src/routes/Documents/DocumentDetailPage.tsx",
    "src/routes/Documents/DocumentCategoryPage.tsx",
    "src/routes/Calibration/MasterEquipmentListPage.tsx",
    "src/components/shared/RecordEditBar.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.equal(source.includes("canMaintainMasterList"), false);
  }
});
