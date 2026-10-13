import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { code128Bars, code128Modules, code128Values, decodeCode128Modules } from "./code128.ts";
import { LABEL_SIZES, labelPrintCss, labelSizeById } from "./labelSizes.ts";
import { parseSampleSelection } from "./sampleSelection.ts";
import { resolveScan } from "./scanToFind.ts";

describe("Code 128", () => {
  it("encodes to the same bars a real decoder (zxing-cpp) read back as the text", () => {
    // Checked against zxing-cpp when this was written. A regression here means labels stop scanning.
    assert.equal(code128Modules("FAI-0012-S03"), "11010010000100011000101010001100011000100010100110111001011101111011011001100101100111001011110111010011011100110111010001001110110011001011100101100111001100011101011");
  });

  it("round-trips letters, digits and punctuation, in code set B and C", () => {
    for (const text of ["FAI-0012-S03", "43GM1000PS", "AB-12-S3", "Hello World!", "12345678", "123456789", "A1234B", "x", "a-b_c.d/e", "FAI-TEST-001-S01", "FAI-0012-S123"]) {
      assert.equal(decodeCode128Modules(code128Modules(text)), text, text);
    }
  });

  it("uses code set C only for runs of four or more digits, and keeps odd runs in set B first", () => {
    assert.equal(code128Values("AB12")[0], 104);
    assert.equal(code128Values("1234")[0], 105);
    assert.ok(code128Values("A12345").includes(99));
    assert.ok(!code128Values("A123B").includes(99));
  });

  it("is a valid barcode: every symbol 11 modules, stop 13, bars start and end with a bar", () => {
    const modules = code128Modules("FAI-0012-S03");
    assert.equal((modules.length - 13) % 11, 0);
    assert.equal(modules[0], "1");
    assert.equal(modules.at(-1), "1");
    const { bars, modules: total } = code128Bars("FAI-0012-S03");
    assert.equal(total, modules.length);
    assert.equal(bars.reduce((sum, bar) => sum + bar.width, 0), [...modules].filter((m) => m === "1").length);
  });

  it("detects a damaged barcode", () => {
    const modules = code128Modules("FAI-0012-S03");
    const damaged = modules.slice(0, 40) + (modules[40] === "1" ? "0" : "1") + modules.slice(41);
    assert.equal(decodeCode128Modules(damaged), null);
  });

  it("refuses characters a barcode cannot hold, and empty text", () => {
    assert.throws(() => code128Modules("naïve"));
    assert.throws(() => code128Modules(""));
  });
});

describe("label sizes and print rules", () => {
  it("offers 2x1, 2.25x1.25, 3x2 and 4x6 inches", () => {
    assert.deepEqual(
      LABEL_SIZES.map((size) => [size.id, size.widthIn, size.heightIn]),
      [["2x1", 2, 1], ["2.25x1.25", 2.25, 1.25], ["3x2", 3, 2], ["4x6", 4, 6]],
    );
    assert.equal(labelSizeById("nonsense").id, "2x1");
  });

  it("prints one label per page at the exact size with no margins, and hides everything else", () => {
    for (const size of LABEL_SIZES) {
      const css = labelPrintCss(size);
      assert.match(css, new RegExp(`@page \\{ size: ${size.widthIn}in ${size.heightIn}in; margin: 0; \\}`));
      assert.match(css, new RegExp(`\\.aq-label-page \\{[^}]*width: ${size.widthIn}in; height: ${size.heightIn}in;`));
      assert.match(css, /break-after: page/);
      assert.match(css, /\.aq-label-page:last-child \{ break-after: auto/);
      assert.match(css, /body > \*:not\(\.aq-label-print-root\) \{ display: none !important; \}/);
      assert.match(css, /@media screen \{ \.aq-label-print-root \{ display: none; \} \}/);
    }
  });
});

describe("choosing samples", () => {
  it("blank or 'all' is every sample", () => {
    assert.deepEqual(parseSampleSelection("", 3), { samples: [1, 2, 3] });
    assert.deepEqual(parseSampleSelection(" All ", 3), { samples: [1, 2, 3] });
  });

  it("reads numbers and ranges, sorted and without repeats", () => {
    assert.deepEqual(parseSampleSelection("5, 1-3, 2", 10), { samples: [1, 2, 3, 5] });
    assert.deepEqual(parseSampleSelection("7", 10), { samples: [7] });
    assert.deepEqual(parseSampleSelection("2 - 4 9", 10), { samples: [2, 3, 4, 9] });
  });

  it("says what is wrong", () => {
    for (const bad of ["abc", "0", "4-2", "1-", "3,x"]) assert.ok("error" in parseSampleSelection(bad, 5), bad);
    const high = parseSampleSelection("6", 5);
    assert.ok("error" in high && /5 samples/.test(high.error));
    assert.ok("error" in parseSampleSelection("1", 0));
  });
});

describe("Scan to find with FAI & AQL", () => {
  const record = (id: number, label: string) => ({ type: "FAI record" as const, id, label, detail: "PO 4471, passed", path: `/fai-inspection/records/${id}`, date: null });
  const general = [{ type: "NCR" as const, id: 9, label: "NCR-9", path: "/ncr/9" }];

  it("a sample tag opens its record with the sample highlighted", () => {
    const fai = { sample: { recordId: 4, faiNumber: "FAI-0012", partNumber: "43GM1000PS", sampleNumber: 3, sampleCount: 5, code: "FAI-0012-S03", path: "/fai-inspection/records/4?sample=3" }, results: [] };
    assert.deepEqual(resolveScan(fai, general), { open: "/fai-inspection/records/4?sample=3" });
  });

  it("exactly one match opens it, whether it is an FAI record or something else", () => {
    assert.deepEqual(resolveScan({ sample: null, results: [record(7, "FAI-7 · 43GM1000PS")] }, []), { open: "/fai-inspection/records/7" });
    assert.deepEqual(resolveScan(null, general as never), { open: "/ncr/9" });
  });

  it("several matches are listed with the FAI plans and records first, in the order sent (newest first)", () => {
    const outcome = resolveScan({ sample: null, results: [record(8, "newer"), record(7, "older")] }, general as never);
    assert.ok("rows" in outcome);
    assert.deepEqual(outcome.rows.map((row) => row.label), ["newer", "older", "NCR-9"]);
    assert.match(outcome.rows[0]!.detail, /FAI record/);
  });

  it("without the FAI permission (no FAI answer) only the usual search is used", () => {
    const outcome = resolveScan(null, [...general, { type: "CAPA" as const, id: 2, label: "CAPA-2", path: "/capa/2" }] as never);
    assert.ok("rows" in outcome && outcome.rows.length === 2);
  });

  it("nothing found is an empty list, not an error", () => {
    assert.deepEqual(resolveScan({ sample: null, results: [] }, []), { rows: [] });
  });
});
