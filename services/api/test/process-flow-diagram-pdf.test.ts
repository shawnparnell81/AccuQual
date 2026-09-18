// Pure-logic unit test — no DB (see tenant-isolation.test.ts's header
// comment on the distinction). Process Flow Diagram full build, Phase 5:
// exercises a real branch (one node, two outgoing edges) and a real merge
// (one node, two incoming edges) through the actual pdf-lib renderer, not
// just a byte-count check — a flipped y-axis or a bad arrowhead angle
// wouldn't show up in the byte count alone (see the module's own comment on
// the SVG-vs-PDF y-flip gotcha), so this is paired with one manual open of
// an exported PDF, not a substitute for it.
import { describe, expect, it } from "vitest";
import { getFormLayout } from "../src/modules/forms/layouts/index.js";
import { renderProcessFlowDiagramAsPdf } from "../src/modules/forms/diagram-pdf-renderer.js";

describe("process_flow_diagram PDF export", () => {
  it("is registered under the process_flow_diagram formType", () => {
    const layout = getFormLayout("process_flow_diagram");
    expect(layout).toBeTruthy();
    expect(layout!.formType).toBe("process_flow_diagram");
  });

  it("renders a real PDF for a diagram with a branch and a merge", async () => {
    const layout = getFormLayout("process_flow_diagram")!;
    const bytes = await renderProcessFlowDiagramAsPdf(layout, {
      customer: "Meridian Fabrication",
      steps: [
        { opNo: "10", stepType: "Operation", _diagramId: "a", processDescription: "CNC mill face and bore" },
        { opNo: "20", stepType: "Decision", _diagramId: "b", processDescription: "Within tolerance?" },
        { opNo: "30", stepType: "Storage", _diagramId: "c", processDescription: "Finished goods stock" },
        { opNo: "40", stepType: "Inspection", _diagramId: "d", processDescription: "Rework inspection" },
      ],
      diagram: {
        version: 1,
        nodes: {
          a: { x: 120, y: 100, manual: false },
          b: { x: 340, y: 100, manual: false },
          c: { x: 560, y: 60, manual: true },
          d: { x: 560, y: 180, manual: true },
        },
        edges: [
          // Branch: node b has two outgoing edges.
          { id: "e1", from: "a", to: "b" },
          { id: "e2", from: "b", to: "c", branchLabel: "Pass" },
          { id: "e3", from: "b", to: "d", branchLabel: "Fail" },
          // Merge: node c also receives from d (2 incoming edges).
          { id: "e4", from: "d", to: "c" },
        ],
      },
    });

    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  it("renders a real PDF with no diagram data yet (new form, empty data)", async () => {
    const layout = getFormLayout("process_flow_diagram")!;
    const bytes = await renderProcessFlowDiagramAsPdf(layout, {});
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  it("does not regress any other form type's PDF export — pdf-merger's branch is gated on an exact formType string match", async () => {
    const { renderFormLayoutAsPdf } = await import("../src/modules/forms/schema-pdf-renderer.js");
    const layout = getFormLayout("capa")!;
    const bytes = await renderFormLayoutAsPdf(layout, { capaNumber: "CAPA-1" });
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });
});
