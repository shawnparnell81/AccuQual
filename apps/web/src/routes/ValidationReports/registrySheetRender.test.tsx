import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { REGISTRY } from "../../lib/validation-forms/registry";
import { RegistrySheet } from "./RegistrySheet";

describe("validation forms open blank without crashing", () => {
  for (const [type, module] of Object.entries(REGISTRY)) {
    it(type, () => {
      for (const data of [{ formType: type, cells: {} }, { formType: type }, undefined]) {
        for (const readOnly of [true, false]) {
          const signatures = Object.fromEntries((module.def.signatures ?? []).map((slot) => [slot.path, ""]));
          const html = renderToString(
            <RegistrySheet module={module} cells={module.cellsFromData(data)} readOnly={readOnly} documentNumber="" revision="" signatures={signatures} onSign={async () => {}} onChange={() => {}} />,
          );
          assert.ok(html.length > 1000);
        }
      }
    });
  }
});
