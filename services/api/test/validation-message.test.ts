import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validationMessage } from "../src/middleware/errorHandler.js";

describe("validation error message", () => {
  it("names the fields that failed in words", () => {
    const result = z.object({ customerName: z.string(), rma_number: z.string() }).safeParse({ customerName: 1, rma_number: null });
    expect(result.success).toBe(false);
    if (!result.success) expect(validationMessage(result.error)).toBe("Check these fields: Customer name, Rma number.");
  });
});
