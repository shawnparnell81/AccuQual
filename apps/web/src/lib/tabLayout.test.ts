import assert from "node:assert/strict";
import test from "node:test";
import { moveTab, setTabPinned, withPinsLeft } from "./tabLayout.ts";

test("pinned tabs stay left without scrambling the others", () => {
  const tabs = withPinsLeft([
    { id: "a" },
    { id: "b", pinned: true },
    { id: "c" },
    { id: "d", pinned: true },
  ]);
  assert.deepEqual(tabs.map((tab) => tab.id), ["b", "d", "a", "c"]);
});

test("dragging a tab reorders it, then pins snap back to the left", () => {
  const tabs = [
    { id: "pin", pinned: true },
    { id: "a" },
    { id: "b" },
  ];
  assert.deepEqual(moveTab(tabs, "b", "a").map((tab) => tab.id), ["pin", "b", "a"]);
  assert.deepEqual(moveTab(tabs, "a", "pin").map((tab) => tab.id), ["pin", "a", "b"]);
});

test("pinning a tab moves it into the pinned group", () => {
  const next = setTabPinned(
    [
      { id: "a" },
      { id: "b" },
    ],
    "b",
    true,
  );
  assert.deepEqual(next.map((tab) => ({ id: tab.id, pinned: Boolean(tab.pinned) })), [
    { id: "b", pinned: true },
    { id: "a", pinned: false },
  ]);
});
