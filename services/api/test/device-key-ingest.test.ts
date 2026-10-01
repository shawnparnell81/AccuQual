import { describe, expect, it } from "vitest";
import { generateDeviceKey, ingestDeviceAuthorized } from "../src/modules/digital-twin/digital-twin.deviceKeys.js";

describe("signed-in IoT ingest device key", () => {
  it("accepts only the key for that device", () => {
    const issued = generateDeviceKey(9);
    const device = { id: 9, deviceId: "press-1", apiKeyHash: issued.hash };
    expect(ingestDeviceAuthorized(device, issued.apiKey, "press-1")).toBe(true);
    expect(ingestDeviceAuthorized(device, undefined, "press-1")).toBe(false);
    expect(ingestDeviceAuthorized(device, issued.apiKey, "press-2")).toBe(false);
    expect(ingestDeviceAuthorized({ ...device, apiKeyHash: null }, issued.apiKey, "press-1")).toBe(false);
    expect(ingestDeviceAuthorized(null, issued.apiKey, "press-1")).toBe(false);
  });
});