import { describe, expect, it } from "vitest";
import { navigationLayoutFromProfile } from "./navigationLayout.js";

describe("navigation layout", () => {
  it("defaults to the sidebar when the company has not chosen", () => {
    expect(navigationLayoutFromProfile(null)).toBe("sidebar");
    expect(navigationLayoutFromProfile(undefined)).toBe("sidebar");
    expect(navigationLayoutFromProfile({})).toBe("sidebar");
    expect(navigationLayoutFromProfile({ navigationLayout: "sidebar" })).toBe("sidebar");
    expect(navigationLayoutFromProfile({ navigationLayout: "left" })).toBe("sidebar");
    expect(navigationLayoutFromProfile({ navigationLayout: "" })).toBe("sidebar");
  });

  it("uses the top bar only when that value is saved", () => {
    expect(navigationLayoutFromProfile({ navigationLayout: "top" })).toBe("top");
  });
});
