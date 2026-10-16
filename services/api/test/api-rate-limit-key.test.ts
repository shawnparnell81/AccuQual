import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { apiRateLimitKey, API_RATE_LIMIT_PER_ADDRESS, API_RATE_LIMIT_PER_PERSON } from "../src/middleware/rateLimit.js";
import { signAccessToken } from "../src/utils/jwt.js";

function req(headers: Record<string, string>, ip = "203.0.113.9"): Request {
  return { ip, header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

describe("API request budget", () => {
  it("counts a signed-in person by user id, so people behind one plant address do not share a budget", () => {
    const a = signAccessToken({ sub: "41", roleId: null, roleName: "operator", department: null });
    const b = signAccessToken({ sub: "42", roleId: null, roleName: "operator", department: null });
    expect(apiRateLimitKey(req({ authorization: `Bearer ${a}` }))).toBe("api-user-41");
    expect(apiRateLimitKey(req({ authorization: `Bearer ${b}` }))).toBe("api-user-42");
    expect(API_RATE_LIMIT_PER_PERSON).toBeGreaterThan(API_RATE_LIMIT_PER_ADDRESS);
  });

  it("counts a missing or forged token by address", () => {
    expect(apiRateLimitKey(req({}))).toBe("api-ip-203.0.113.9");
    expect(apiRateLimitKey(req({ authorization: "Bearer not-a-token" }))).toBe("api-ip-203.0.113.9");
  });
});
