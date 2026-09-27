import { describe, expect, it } from "vitest";
import { LIST_SAFETY_LIMIT, parseLimitOffset } from "../src/utils/listQuery.js";

describe("parseLimitOffset", () => {
  it("keeps an unpaged list inside the safety cap", () => {
    expect(parseLimitOffset({})).toEqual({ limit: LIST_SAFETY_LIMIT, offset: 0, paginated: false });
  });

  it("pages when limit or offset is present and rejects junk values", () => {
    expect(parseLimitOffset({ limit: "25", offset: "50" })).toEqual({ limit: 25, offset: 50, paginated: true });
    expect(parseLimitOffset({ offset: "0" }).paginated).toBe(true);
    expect(parseLimitOffset({ limit: "0" }).limit).toBe(1);
    expect(parseLimitOffset({ limit: "99999" }).limit).toBe(LIST_SAFETY_LIMIT);
    expect(parseLimitOffset({ limit: "nope", offset: "-4" })).toEqual({ limit: LIST_SAFETY_LIMIT, offset: 0, paginated: true });
  });
});
