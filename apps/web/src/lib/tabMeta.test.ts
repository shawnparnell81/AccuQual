import assert from "node:assert/strict";
import test from "node:test";
import { refreshTabTitle } from "./tabMeta.ts";

test("a saved QMS Forms title refreshes to the current page name", () => {
  assert.equal(refreshTabTitle("/blank-forms", "QMS Forms"), "Documents · Blank Forms");
});

test("a raw path title resolves to the current page name", () => {
  assert.equal(refreshTabTitle("/pareto", "/pareto"), "Reports · Pareto");
});

test("a current title is left alone", () => {
  assert.equal(refreshTabTitle("/ncr", "NCR"), "NCR");
  assert.equal(refreshTabTitle("/blank-forms", "Blank Forms"), "Blank Forms");
});
