import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampToViewport, fabStorageKey, loadFabPosition, movedPastThreshold, saveFabPosition } from "./floatingPosition.ts";

function memoryStore() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), map };
}

describe("draggable AI assistant button", () => {
  const size = { width: 56, height: 56 };
  const viewport = { width: 1000, height: 700 };

  it("clamps inside the viewport with an edge margin", () => {
    assert.deepEqual(clampToViewport({ x: -50, y: -10 }, size, viewport), { x: 8, y: 8 });
    assert.deepEqual(clampToViewport({ x: 5000, y: 5000 }, size, viewport), { x: 936, y: 636 });
    assert.deepEqual(clampToViewport({ x: 400.4, y: 300.6 }, size, viewport), { x: 400, y: 301 });
  });

  it("re-clamps a saved spot when the window gets smaller", () => {
    assert.deepEqual(clampToViewport({ x: 936, y: 636 }, size, { width: 400, height: 300 }), { x: 336, y: 236 });
  });

  it("treats 5px or less as a click and more as a drag", () => {
    assert.equal(movedPastThreshold({ x: 0, y: 0 }, { x: 3, y: 4 }), false);
    assert.equal(movedPastThreshold({ x: 0, y: 0 }, { x: 4, y: 4 }), true);
  });

  it("saves and restores per user, and reset clears it", () => {
    const store = memoryStore();
    const key = fabStorageKey(7);
    assert.ok(key.endsWith(".7"));
    assert.notEqual(fabStorageKey(8), key);
    assert.equal(loadFabPosition(key, store), null);
    saveFabPosition(key, { x: 120, y: 340 }, store);
    assert.deepEqual(loadFabPosition(key, store), { x: 120, y: 340 });
    assert.equal(loadFabPosition(fabStorageKey(8), store), null);
    saveFabPosition(key, null, store);
    assert.equal(loadFabPosition(key, store), null);
  });

  it("ignores junk in storage", () => {
    const store = memoryStore();
    store.setItem("k", "not json");
    assert.equal(loadFabPosition("k", store), null);
    store.setItem("k", JSON.stringify({ x: "1", y: 2 }));
    assert.equal(loadFabPosition("k", store), null);
  });
});
