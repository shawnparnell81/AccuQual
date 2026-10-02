import assert from "node:assert/strict";
import test from "node:test";
import { paletteQueryWithout, parsePaletteQuery } from "./paletteQuery.ts";

test("parses filter tokens and leaves the free-text search", () => {
  const parsed = parsePaletteQuery('type:ncr status:"in progress" pump housing');
  assert.deepEqual(parsed.filters, [
    { key: "type", value: "ncr" },
    { key: "status", value: "in progress" },
  ]);
  assert.equal(parsed.text, "pump housing");
});

test("removing a chip rewrites the query without that token", () => {
  const next = paletteQueryWithout("type:ncr plant:Dayton 12", "type", "ncr");
  assert.equal(next, "plant:Dayton 12");
  assert.deepEqual(parsePaletteQuery(next).filters, [{ key: "plant", value: "Dayton" }]);
});

test("an unfinished token stays in the text until it has a value", () => {
  const parsed = parsePaletteQuery("assigned:");
  assert.deepEqual(parsed.filters, []);
  assert.equal(parsed.text, "assigned:");
});
