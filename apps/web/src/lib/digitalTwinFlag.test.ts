import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { digitalTwinEnabled, hideDigitalTwinTarget, isDigitalTwinPath } from "./digitalTwinFlag.ts";

describe("digital twin company flag", () => {
  it("stays off until the company turns it on", () => {
    assert.equal(digitalTwinEnabled(undefined), false);
    assert.equal(digitalTwinEnabled(null), false);
    assert.equal(digitalTwinEnabled(false), false);
    assert.equal(digitalTwinEnabled(true), true);
  });

  it("recognizes the page and the admin setup route", () => {
    assert.equal(isDigitalTwinPath("/digital-twin"), true);
    assert.equal(isDigitalTwinPath("/digital-twin/"), true);
    assert.equal(isDigitalTwinPath("/admin/digital-twin"), true);
    assert.equal(isDigitalTwinPath("/risk"), false);
  });

  it("hides a saved menu row and a pinned path while the flag is off", () => {
    assert.equal(hideDigitalTwinTarget(false, { key: "digital-twin", path: "/digital-twin" }), true);
    assert.equal(hideDigitalTwinTarget(undefined, { key: "pin-twin", path: "/digital-twin" }), true);
    assert.equal(hideDigitalTwinTarget(true, { key: "digital-twin", path: "/digital-twin" }), false);
    assert.equal(hideDigitalTwinTarget(false, { key: "feasibility", path: "/feasibility" }), false);
  });
});
