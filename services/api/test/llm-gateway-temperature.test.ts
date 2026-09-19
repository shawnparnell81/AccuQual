import { afterEach, describe, expect, it, vi } from "vitest";
import { callLlmDetailed } from "../src/modules/ai/llm-gateway.js";

const okBody = { content: [{ text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } };

function okResponse() {
  return new Response(JSON.stringify(okBody), { status: 200 });
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  const [, init] = fetchMock.mock.calls[call] as [string, { body: string }];
  return JSON.parse(init.body);
}

describe("callLlmDetailed Anthropic temperature handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not send a temperature unless the caller sets one (newer models reject it outright)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await callLlmDetailed("hi", { provider: "anthropic", apiKey: "k", model: "claude-sonnet-5" });

    expect(sentBody(fetchMock, 0)).not.toHaveProperty("temperature");
  });

  it("sends an explicitly set temperature", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await callLlmDetailed("hi", { provider: "anthropic", apiKey: "k", model: "claude-haiku-4-5-20251001", temperature: 0.7 });

    expect(sentBody(fetchMock, 0).temperature).toBe(0.7);
  });

  it("retries once without temperature when the model rejects it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "`temperature` is deprecated for this model." } }), { status: 400 }))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await callLlmDetailed("hi", { provider: "anthropic", apiKey: "k", model: "claude-sonnet-5", temperature: 0.7 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(fetchMock, 0).temperature).toBe(0.7);
    expect(sentBody(fetchMock, 1)).not.toHaveProperty("temperature");
    expect(result.isStub).toBe(false);
    expect(result.text).toBe("ok");
  });

  it("does not retry a 400 that isn't about temperature", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "max_tokens too large" } }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callLlmDetailed("hi", { provider: "anthropic", apiKey: "k", model: "claude-sonnet-5", temperature: 0.7 })).rejects.toThrow("AI provider request failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
