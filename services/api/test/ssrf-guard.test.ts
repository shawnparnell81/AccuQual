import { describe, expect, it } from "vitest";
import { assertSafeWebhookUrl } from "../src/utils/ssrfGuard.js";

// Security-audit finding (S2, high): assertSafeWebhookUrl is only actually
// invoked in production (settings.erpSync.ts skips it elsewhere, so
// settings-module.test.ts's real local-server webhook test keeps working) —
// this file proves the guard itself is correct regardless of environment,
// by calling it directly rather than through the gated call site. IP-literal
// cases need no DNS lookup, so they stay deterministic/offline-safe; the
// hostname-based lookup path isn't covered here since that would require
// either a live network call or mocking node:dns/promises, neither of which
// this suite's other tests do for external I/O.
describe("assertSafeWebhookUrl", () => {
  it("rejects a non-URL string", async () => {
    await expect(assertSafeWebhookUrl("not a url")).rejects.toThrow(/not a valid URL/);
  });

  it("rejects plain http:// — only https: is allowed", async () => {
    await expect(assertSafeWebhookUrl("http://example.com/hook")).rejects.toThrow(/https:/);
  });

  it("rejects the literal hostname \"localhost\"", async () => {
    await expect(assertSafeWebhookUrl("https://localhost/hook")).rejects.toThrow(/local hostname/);
  });

  it("rejects loopback (127.0.0.1)", async () => {
    await expect(assertSafeWebhookUrl("https://127.0.0.1/hook")).rejects.toThrow(/private or reserved/);
  });

  it("rejects the cloud metadata endpoint (169.254.169.254)", async () => {
    await expect(assertSafeWebhookUrl("https://169.254.169.254/latest/meta-data/")).rejects.toThrow(/private or reserved/);
  });

  it("rejects RFC1918 private ranges (10.x, 172.16-31.x, 192.168.x)", async () => {
    await expect(assertSafeWebhookUrl("https://10.0.0.5/hook")).rejects.toThrow(/private or reserved/);
    await expect(assertSafeWebhookUrl("https://172.16.0.5/hook")).rejects.toThrow(/private or reserved/);
    await expect(assertSafeWebhookUrl("https://192.168.1.5/hook")).rejects.toThrow(/private or reserved/);
  });

  it("rejects IPv6 loopback and unique-local/link-local", async () => {
    await expect(assertSafeWebhookUrl("https://[::1]/hook")).rejects.toThrow(/private or reserved/);
    await expect(assertSafeWebhookUrl("https://[fd00::1]/hook")).rejects.toThrow(/private or reserved/);
    await expect(assertSafeWebhookUrl("https://[fe80::1]/hook")).rejects.toThrow(/private or reserved/);
  });

  it("accepts an https URL targeting a public IP literal", async () => {
    await expect(assertSafeWebhookUrl("https://93.184.216.34/hook")).resolves.toBeUndefined();
  });
});
