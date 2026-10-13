import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditCollapseKey, auditPanelHeading, loadAuditExpanded, saveAuditExpanded } from "./collapsedAuditTrail.ts";

function memoryStore() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

describe("collapsible audit trail state", () => {
  it("is collapsed until the user expands it", () => {
    const store = memoryStore();
    assert.equal(loadAuditExpanded(auditCollapseKey(7), store), false);
  });

  it("remembers expand and collapse, per user, across pages", () => {
    const store = memoryStore();
    saveAuditExpanded(auditCollapseKey(7), true, store);
    assert.equal(loadAuditExpanded(auditCollapseKey(7), store), true);
    assert.equal(loadAuditExpanded(auditCollapseKey(8), store), false);
    saveAuditExpanded(auditCollapseKey(7), false, store);
    assert.equal(loadAuditExpanded(auditCollapseKey(7), store), false);
  });

  it("falls back to collapsed when storage is missing or throws", () => {
    assert.equal(loadAuditExpanded("k", null), false);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    assert.equal(loadAuditExpanded("k", broken), false);
    assert.doesNotThrow(() => saveAuditExpanded("k", true, broken));
  });

  it("writes the header with an entry count", () => {
    assert.equal(auditPanelHeading("Audit trail", 12), "Audit trail (12 entries)");
    assert.equal(auditPanelHeading("Audit trail", 1), "Audit trail (1 entry)");
    assert.equal(auditPanelHeading("Audit trail", 0), "Audit trail (0 entries)");
    assert.equal(auditPanelHeading("History", null), "History");
  });
});
