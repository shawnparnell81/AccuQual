import { afterEach, describe, expect, it, vi } from "vitest";
import { ZeptoMailTransport, parseFromAddress } from "../src/modules/notifications/notification.service.js";

const message = { to: "user@example.com", subject: "Reset your password", body: "Click the link." };
const from = "AccuQual <noreply@accuqualqms.com>";

function sent(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const [url, init] = fetchMock.mock.calls[call] as [string, { headers: Record<string, string>; body: string }];
  return { url, headers: init.headers, body: JSON.parse(init.body) };
}

describe("parseFromAddress", () => {
  it("splits a display name from the address", () => {
    expect(parseFromAddress("AccuQual <noreply@accuqualqms.com>")).toEqual({ address: "noreply@accuqualqms.com", name: "AccuQual" });
    expect(parseFromAddress('"AccuQual QMS" <noreply@accuqualqms.com>')).toEqual({ address: "noreply@accuqualqms.com", name: "AccuQual QMS" });
  });

  it("accepts a bare address", () => {
    expect(parseFromAddress("noreply@accuqualqms.com")).toEqual({ address: "noreply@accuqualqms.com" });
  });
});

describe("ZeptoMailTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("posts to the ZeptoMail API with the token and ZeptoMail's payload shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ZeptoMailTransport({ token: "abc123", from }).send(message);

    expect(result).toBe("sent");
    const { url, headers, body } = sent(fetchMock);
    expect(url).toBe("https://api.zeptomail.com/v1.1/email");
    expect(headers.Authorization).toBe("Zoho-enczapikey abc123");
    expect(body).toEqual({
      from: { address: "noreply@accuqualqms.com", name: "AccuQual" },
      to: [{ email_address: { address: "user@example.com" } }],
      subject: "Reset your password",
      textbody: "Click the link.",
    });
  });

  it("does not double the Zoho-enczapikey prefix when the pasted token already has it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await new ZeptoMailTransport({ token: "Zoho-enczapikey abc123 ", from }).send(message);

    expect(sent(fetchMock).headers.Authorization).toBe("Zoho-enczapikey abc123");
  });

  it("does not retry a 4xx (bad token / unverified sender fails the same way every time)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Sender domain not verified" } }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await new ZeptoMailTransport({ token: "t", from }).send(message)).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 5xx and succeeds on the next attempt", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("oops", { status: 503 })).mockResolvedValueOnce(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = new ZeptoMailTransport({ token: "t", from }).send(message);
    await vi.runAllTimersAsync();

    expect(await pending).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up as failed after 3 attempts on a persistent network error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const pending = new ZeptoMailTransport({ token: "t", from }).send(message);
    await vi.runAllTimersAsync();

    expect(await pending).toBe("failed");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never writes the token to the logs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const { logger } = await import("../src/utils/logger.js");
    const errorSpy = vi.spyOn(logger, "error");

    await new ZeptoMailTransport({ token: "SECRET-TOKEN-VALUE", from }).send(message);

    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("SECRET-TOKEN-VALUE");
    errorSpy.mockRestore();
  });
});
