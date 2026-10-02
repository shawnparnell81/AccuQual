import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { readRecentRecords, rememberRecord } from "./recentRecords.js";

const store = new Map<string, string>();

function installStorage() {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    },
  });
}

describe("recent records", () => {
  afterEach(() => store.clear());

  it("keeps the newest copy of a record and drops anything past eight", () => {
    installStorage();
    assert.deepEqual(readRecentRecords(), []);
    for (let id = 1; id <= 9; id += 1) {
      rememberRecord({ path: `/ncr/${id}`, title: `NCR #${id}`, type: "NCR" });
    }
    rememberRecord({ path: "/ncr/9", title: "NCR #9 updated", type: "NCR" });
    const rows = readRecentRecords();
    assert.equal(rows.length, 8);
    assert.equal(rows[0]?.title, "NCR #9 updated");
    assert.equal(rows.some((row) => row.path === "/ncr/1"), false);
  });

  it("ignores a stored value that is not a list of records", () => {
    installStorage();
    localStorage.setItem("accuqual-recent-records", "{\"nope\":true}");
    assert.deepEqual(readRecentRecords(), []);
  });

  it("keeps one person's recent list separate from another's", () => {
    installStorage();
    rememberRecord({ path: "/ncr/1", title: "NCR #1", type: "NCR" }, 4);
    rememberRecord({ path: "/capa/2", title: "CAPA #2", type: "CAPA" }, 9);
    assert.deepEqual(readRecentRecords(4).map((row) => row.path), ["/ncr/1"]);
    assert.deepEqual(readRecentRecords(9).map((row) => row.path), ["/capa/2"]);
  });
});
