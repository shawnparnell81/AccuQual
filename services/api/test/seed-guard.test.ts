import { describe, expect, it } from "vitest";
import { refuseProductionSeed } from "../src/db/seedGuard.js";

describe("development seed guard", () => {
  it("refuses production and allows local and test", () => {
    expect(() => refuseProductionSeed("production")).toThrow(/production/);
    expect(() => refuseProductionSeed("development")).not.toThrow();
    expect(() => refuseProductionSeed("test")).not.toThrow();
    expect(() => refuseProductionSeed(undefined)).not.toThrow();
  });
});
