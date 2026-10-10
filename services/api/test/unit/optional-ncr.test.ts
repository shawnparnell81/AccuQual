import { describe, expect, it } from "vitest";
import { maybeAutoCreateNcr } from "../../src/modules/erp/receivingAutomation.js";

describe("optional NCR", () => {
  it("does not create an NCR when a receiving line is rejected or quarantined", async () => {
    const rejected = await maybeAutoCreateNcr(null as never, { id: 4 } as never, "rejected", 1, "scratch", 1, 1);
    const quarantined = await maybeAutoCreateNcr(null as never, { id: 4 } as never, "quarantined", 1, "scratch", 1, 1);
    expect(rejected).toBeNull();
    expect(quarantined).toBeNull();
  });
});
