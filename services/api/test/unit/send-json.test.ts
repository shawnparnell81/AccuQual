import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sendJson } from "../../src/utils/sendJson.js";

function fake(acceptEncoding?: string) {
  const headers: Record<string, string> = {};
  let sent: unknown;
  const res = { setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; }, type() { return this; }, send: (b: unknown) => { sent = b; } };
  const req = { headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {} };
  return { req: req as never, res: res as never, headers, sent: () => sent };
}

describe("sendJson", () => {
  const big = { cells: Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`A${i}`, { v: `value ${i}` }])) };
  it("gzips a large reply for a browser that accepts gzip", () => {
    const f = fake("gzip, deflate, br");
    sendJson(f.req, f.res, big);
    expect(f.headers["content-encoding"]).toBe("gzip");
    expect(JSON.parse(gunzipSync(f.sent() as Buffer).toString())).toEqual(big);
  });
  it("sends plain JSON when small or not accepted", () => {
    const small = fake("gzip");
    sendJson(small.req, small.res, { ok: true });
    expect(small.headers["content-encoding"]).toBeUndefined();
    const plain = fake();
    sendJson(plain.req, plain.res, big);
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(JSON.parse(plain.sent() as string)).toEqual(big);
  });
});
