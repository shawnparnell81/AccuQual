import { describe, expect, it } from "vitest";
import { digitalTwinEnabled } from "../src/modules/company/digitalTwinFlag.js";

describe("digitalTwinEnabled", () => {
  it("stays off until a company explicitly turns it on", () => {
    expect(digitalTwinEnabled(undefined)).toBe(false);
    expect(digitalTwinEnabled(null)).toBe(false);
    expect(digitalTwinEnabled({})).toBe(false);
    expect(digitalTwinEnabled({ digitalTwinEnabled: false })).toBe(false);
    expect(digitalTwinEnabled({ digitalTwinEnabled: true })).toBe(true);
  });
});
