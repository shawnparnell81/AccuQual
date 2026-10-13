import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8").split("\r\n").join("\n");
const kept = readFileSync(new URL("../components/layout/KeptSection.tsx", import.meta.url), "utf8");
const report = readFileSync(new URL("../routes/Reports/EngineeringMonthlyReport.tsx", import.meta.url), "utf8");

/** The body of the print block that holds the shared paper rules. */
function printBlock(): string {
  const start = css.indexOf("@media print {\n  .aq-step-trail");
  assert.ok(start >= 0, "the shared @media print block is missing");
  return css.slice(start);
}

function ruleBody(block: string, selectorStart: string): string {
  const at = block.indexOf(selectorStart);
  assert.ok(at >= 0, `print rule for ${selectorStart} is missing`);
  return block.slice(at, block.indexOf("}", at));
}

describe("printing a page inside the workspace tab panel", () => {
  it("the kept panel and .page-enter wrapper are what the print reset targets", () => {
    assert.match(kept, /data-kept-path=/);
    assert.match(kept, /absolute inset-0 overflow-y-auto/);
    assert.match(kept, /page-enter/);
  });

  it("resets position, height, overflow, transform and animation in print", () => {
    const body = ruleBody(printBlock(), "[data-kept-path],");
    assert.match(body, /\.page-enter/);
    for (const declaration of ["position: static", "height: auto", "overflow: visible", "transform: none", "animation: none"]) {
      assert.ok(body.includes(declaration), `missing ${declaration}`);
    }
  });

  it("shows textareas at full content height in print", () => {
    const body = ruleBody(printBlock(), "  textarea {");
    assert.match(body, /field-sizing: content/);
    assert.match(body, /overflow: visible/);
    assert.match(body, /max-height: none/);
  });
});

describe("Monthly Quality Report print style", () => {
  it("flows normally instead of positioning the report absolutely or hiding the rest of the page", () => {
    const style = /@media print \{[^`]*\}/.exec(report)?.[0] ?? "";
    assert.ok(style.includes(".qe-report"), "report print style is missing");
    assert.ok(!/position:\s*absolute/.test(style));
    assert.ok(!/visibility:\s*hidden/.test(style));
    assert.ok(style.includes(".qe-no-print"));
  });

  it("offers Word in the supplier file input", () => {
    assert.ok(report.includes("Supplier file (CSV, Excel or Word)"));
    assert.match(report, /accept="[^"]*\.docx/);
  });
});
