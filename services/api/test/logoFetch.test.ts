import { describe, expect, it } from "vitest";
import { blockedAddress, logoUrlAllowed } from "../src/modules/company/logoFetch.js";

describe("company logo address check", () => {
  it("blocks loopback, private, link-local, and metadata hosts", () => {
    expect(blockedAddress("127.0.0.1")).toBe(true);
    expect(blockedAddress("10.1.2.3")).toBe(true);
    expect(blockedAddress("192.168.1.9")).toBe(true);
    expect(blockedAddress("172.16.0.4")).toBe(true);
    expect(blockedAddress("169.254.169.254")).toBe(true);
    expect(blockedAddress("::1")).toBe(true);
    expect(blockedAddress("fe80::1")).toBe(true);
    expect(blockedAddress("localhost")).toBe(true);
    expect(blockedAddress("metadata.google.internal")).toBe(true);
    expect(blockedAddress("2130706433")).toBe(true);
    expect(blockedAddress("8.8.8.8")).toBe(false);
    expect(blockedAddress("cdn.example.com")).toBe(false);
  });

  it("allows only public http(s) logo URLs", () => {
    expect(logoUrlAllowed("https://cdn.example.com/logo.png")?.hostname).toBe("cdn.example.com");
    expect(logoUrlAllowed("http://127.0.0.1/logo.png")).toBeNull();
    expect(logoUrlAllowed("file:///etc/passwd")).toBeNull();
    expect(logoUrlAllowed("https://user:pass@cdn.example.com/logo.png")).toBeNull();
    expect(logoUrlAllowed("not a url")).toBeNull();
  });
});
