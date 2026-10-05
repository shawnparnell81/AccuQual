import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ncrLayout } from "./layouts/ncr.ts";
import { dimensionalReportLayout } from "./layouts/dimensionalReport.ts";
import { capaLayout } from "./layouts/capa.ts";
import { layoutSignatureBlocks, showsRequiredControl } from "./signatureRequired.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("signature required control", () => {
  it("shows Required only on a layout with more than one signature block", () => {
    const ncr = layoutSignatureBlocks(ncrLayout);
    const capa = layoutSignatureBlocks(capaLayout);
    const dimensional = layoutSignatureBlocks(dimensionalReportLayout);
    assert.ok(ncr.length > 1);
    assert.equal(showsRequiredControl(ncr.length), true);
    assert.ok(capa.length > 1);
    assert.equal(dimensional.length, 1);
    assert.equal(showsRequiredControl(dimensional.length), false);
  });

  it("keeps Required Yes/No readable and switches without a native radio", () => {
    const stamp = readFileSync(join(here, "SignatureStamp.tsx"), "utf8");
    const choice = stamp.slice(stamp.indexOf("function RequiredChoice"), stamp.indexOf("export function SignatureStamp"));
    const css = readFileSync(join(here, "../../styles/globals.css"), "utf8");
    const rule = css.slice(css.indexOf(".aq-required-choice {"), css.indexOf(".aq-skip"));

    assert.match(choice, /role="radiogroup"/);
    assert.match(choice, /Yes/);
    assert.match(choice, /No/);
    assert.match(choice, /onChange\(next\)/);
    assert.match(choice, /className="aq-required-choice"/);
    assert.doesNotMatch(choice, /type="radio"/);
    assert.doesNotMatch(choice, /text-foreground/);
    assert.match(stamp, /setChoiceDraft\(next\)/);
    assert.match(stamp, /disabled=\{requirement\.disabled\}/);
    assert.doesNotMatch(stamp, /requirement\.disabled \|\| disabled/);

    assert.match(rule, /\.aq-required-choice \{[^}]*color:\s*inherit/);
    assert.match(rule, /\[aria-checked="true"\] \.aq-required-mark \{[^}]*background:\s*currentColor/);
    assert.match(rule, /color:\s*inherit/);
  });
});
