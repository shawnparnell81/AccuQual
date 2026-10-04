import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ADMIN_NAV_COLLAPSED_KEY, readAdminNavCollapsed, writeAdminNavCollapsed, type AdminNavStorage } from "./adminNavCollapsed.ts";

function memoryStorage(initial?: Record<string, string>): AdminNavStorage & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    dump: () => Object.fromEntries(map),
  };
}

describe("admin console menu collapse", () => {
  it("starts expanded when nothing is stored", () => {
    assert.equal(readAdminNavCollapsed(memoryStorage()), false);
    assert.equal(readAdminNavCollapsed(null), false);
  });

  it("remembers a collapse and an expand for the session store", () => {
    const storage = memoryStorage();
    writeAdminNavCollapsed(storage, true);
    assert.equal(storage.dump()[ADMIN_NAV_COLLAPSED_KEY], "1");
    assert.equal(readAdminNavCollapsed(storage), true);
    writeAdminNavCollapsed(storage, false);
    assert.equal(readAdminNavCollapsed(storage), false);
  });

  it("stays expanded when the store cannot be read", () => {
    const storage: AdminNavStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    assert.equal(readAdminNavCollapsed(storage), false);
    assert.doesNotThrow(() => writeAdminNavCollapsed(storage, true));
  });
});
