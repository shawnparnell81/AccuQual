import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LABEL_SIZES } from "../../lib/labelSizes";
import { LabelCard, type LabelContent } from "./LabelCard";
import { LabelPrintDialog } from "./LabelPrintDialog";
import { FaiSampleTags } from "./FaiSampleTags";
import type { FaiSamples } from "../../api/faiInspection";

/** Server rendering puts <!-- --> between text pieces; take them out before matching words. */
const plain = (html: string) => html.replace(/<!-- -->/g, "");

const content: LabelContent = {
  code: "FAI-0012-S03",
  partNumber: "43GM1000PS",
  lotReference: "4471",
  sampleNumber: 3,
  sampleCount: 5,
  faiNumber: "FAI-0012",
  date: "2026-10-13",
  companyName: "Acme Fabrication",
};

describe("label", () => {
  it("shows the barcode of the sample code, part, lot/PO, sample n of N, FAI number, date and the company name from Settings", () => {
    const html = renderToString(<LabelCard size={LABEL_SIZES[0]} kind="code128" content={content} />);
    assert.match(html, /aria-label="Barcode FAI-0012-S03"/);
    assert.ok(html.includes("<rect"), "bars are drawn");
    for (const text of ["43GM1000PS", "Lot/PO 4471", "Sample 3 of 5", "FAI-0012", "2026-10-13", "Acme Fabrication", "FAI-0012-S03"]) assert.ok(html.includes(text), `missing ${text}`);
    assert.ok(!/DMA/.test(html), "no company name is hard-coded");
  });

  it("is sized in inches, one page per label, for every preset", () => {
    for (const size of LABEL_SIZES) {
      const html = renderToString(<LabelCard size={size} kind="code128" content={content} />);
      assert.ok(html.includes(`width:${size.widthIn}in`), size.id);
      assert.ok(html.includes(`height:${size.heightIn}in`), size.id);
      assert.ok(html.includes("aq-label-page"));
    }
  });

  it("can be a QR code instead, with the same words", () => {
    const html = renderToString(<LabelCard size={LABEL_SIZES[2]} kind="qr" content={content} />);
    assert.ok(!html.includes("<svg"), "no linear barcode");
    for (const text of ["43GM1000PS", "Sample 3 of 5", "Acme Fabrication", "FAI-0012-S03"]) assert.ok(html.includes(text), `missing ${text}`);
  });

  it("leaves out Lot/PO and the sample line when a label has none", () => {
    const html = renderToString(<LabelCard size={LABEL_SIZES[0]} kind="code128" content={{ ...content, lotReference: "", sampleNumber: undefined, sampleCount: undefined }} />);
    assert.ok(!html.includes("Lot/PO"));
    assert.ok(!html.includes("Sample "));
  });
});

describe("print dialog", () => {
  const render = (labels: LabelContent[], disabledReason?: string) =>
    plain(renderToString(<LabelPrintDialog title="Print sample tags" labels={labels} defaultSize="3x2" disabledReason={disabledReason} beforePrint={async () => {}} onClose={() => {}} />));

  it("previews the labels, offers the four sizes with the default chosen, and names the print count", () => {
    const html = render([content, { ...content, code: "FAI-0012-S04", sampleNumber: 4 }]);
    assert.match(html, /Preview: 2 labels at 3 × 2 in/);
    for (const size of LABEL_SIZES) assert.ok(html.includes(`>${size.label}<`), size.label);
    assert.match(html, /<option value="3x2" selected/);
    assert.match(html, /Print 2 labels/);
    assert.match(html, /Code 128 barcode/);
    assert.match(html, /@page \{ size: 3in 2in; margin: 0; \}/);
  });

  it("caps the on-screen preview but still says how many will print", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ ...content, code: `FAI-0012-S${String(index + 1).padStart(2, "0")}`, sampleNumber: index + 1 }));
    const html = render(many);
    assert.match(html, /Preview: 40 labels/);
    assert.match(html, /and 28 more/);
    assert.match(html, /Print 40 labels/);
  });

  it("cannot print when the choice is not valid, and says why", () => {
    const html = render([], "This record has 5 samples, so 9 is too high.");
    assert.match(html, /so 9 is too high/);
    assert.ok(/<button[^>]*disabled[^>]*>Print 0 labels/.test(html));
  });

  it("only the label sheet prints, through the browser print dialog", () => {
    const source = readFileSync(new URL("./LabelPrintDialog.tsx", import.meta.url), "utf8");
    assert.match(source, /window\.print\(\)/);
    assert.match(source, /createPortal/);
    const registersFirst = source.indexOf("await beforePrint(sizeId)") < source.indexOf("window.print()");
    assert.ok(registersFirst, "the print is recorded before the print dialog opens");
  });
});

describe("samples on an FAI record", () => {
  const samples = (canPrint: boolean): FaiSamples => ({
    faiNumber: "FAI-0012",
    sampleCount: 5,
    canPrint,
    samples: [1, 2, 3, 4, 5].map((n) => ({ number: n, code: `FAI-0012-S0${n}`, printedCount: n === 2 ? 1 : 0, lastPrintedAt: null })),
  });
  function render(data: FaiSamples | null, highlight: number | null) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    if (data) queryClient.setQueryData(["fai-inspection", "samples", 7], data);
    return plain(
      renderToString(
        <QueryClientProvider client={queryClient}>
          <FaiSampleTags recordId={7} highlightSample={highlight} partNumber="43GM1000PS" />
        </QueryClientProvider>,
      ),
    );
  }

  it("highlights the scanned sample and says which tag was scanned", () => {
    const html = render(samples(true), 3);
    assert.match(html, /Scanned sample 3 of 5: tag FAI-0012-S03/);
    assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1);
    assert.match(html, /<li[^>]*aria-current="true"[^>]*>3</);
  });

  it("ignores a sample number the record does not have", () => {
    const html = render(samples(true), 9);
    assert.ok(!html.includes("Scanned sample"));
    assert.ok(!html.includes('aria-current="true"'));
  });

  it("shows Print labels only to someone who can print labels", () => {
    assert.match(render(samples(true), null), /Print labels/);
    assert.ok(!render(samples(false), null).includes("Print labels"));
    // A viewer still sees the samples.
    assert.match(render(samples(false), 2), /Scanned sample 2 of 5/);
  });

  it("marks samples whose tag was printed", () => {
    assert.match(render(samples(true), null), /2<span[^>]*>printed<\/span>/);
  });

  it("with no sample size, a printer is told what to do and a viewer sees nothing", () => {
    const none = { ...samples(true), sampleCount: 0, samples: [] };
    assert.match(render(none, null), /Enter the sample size on this record/);
    assert.equal(render({ ...none, canPrint: false }, null), "");
  });
});

describe("where it is wired in", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  it("the FAI record page shows the samples and reads the scanned ?sample= number", () => {
    const page = read("../../routes/FaiInspection/FaiRecordDetailPage.tsx");
    assert.match(page, /FaiSampleTags/);
    assert.match(page, /searchParams\.get\("sample"\)/);
  });

  it("Scan to find asks the FAI scan only with Can scan to find FAI, and Settings holds the default size", () => {
    const scan = read("../layout/ScanToFindDialog.tsx");
    assert.match(scan, /effective\?\.\["fai\.scan"\] === "edit"/);
    assert.match(scan, /canScanFai \? faiInspectionApi\.scan\(q\)/);
    const settings = read("../../routes/Admin/AdminCompanySettingsPage.tsx");
    assert.match(settings, /Default label size/);
    assert.match(settings, /labelSize/);
  });

  it("the Roles page lists Can print labels and Can scan to find FAI", () => {
    const roles = read("../../lib/rolePermissionSelection.ts");
    assert.match(roles, /key: "labels\.print"[\s\S]*?label: "Can print labels"/);
    assert.match(roles, /key: "fai\.scan"[\s\S]*?label: "Can scan to find FAI"/);
  });
});
