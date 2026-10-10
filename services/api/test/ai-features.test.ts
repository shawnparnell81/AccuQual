import { describe, expect, it } from "vitest";
import { aiFeaturesEnabled, aiKeySource } from "../src/modules/ai/aiFeatures.js";

describe("AI-assisted features flag", () => {
  it("stays on unless the company explicitly turns it off", () => {
    expect(aiFeaturesEnabled(undefined)).toBe(true);
    expect(aiFeaturesEnabled(null)).toBe(true);
    expect(aiFeaturesEnabled({})).toBe(true);
    expect(aiFeaturesEnabled({ featuresEnabled: true })).toBe(true);
    expect(aiFeaturesEnabled({ featuresEnabled: false })).toBe(false);
  });

  it("reports whether a company key or a server key is configured, never the key", () => {
    expect(aiKeySource({}, {})).toBe("none");
    expect(aiKeySource({ apiKeyEncrypted: "ciphertext" }, {})).toBe("company");
    expect(aiKeySource({}, { anthropic: "server-key" })).toBe("server");
    expect(aiKeySource({ apiKeyEncrypted: "ciphertext" }, { openai: "server-key" })).toBe("both");
    expect(JSON.stringify(aiKeySource({ apiKeyEncrypted: "ciphertext" }, { anthropic: "sk-live" }))).not.toMatch(/sk-|ciphertext/);
  });
});
