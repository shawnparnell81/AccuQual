import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyRefreshFailure,
  createSessionRefresher,
  nextProactiveDelayMs,
  proactiveRefreshDelayMs,
  bootstrapSessionDecision,
  refreshDecision,
  refreshWhileBackingOff,
  retryDelayMs,
  settleAfterRefresh,
  shouldRedirectToLogin,
  tokenNearExpiry,
  type RefreshAttempt,
} from "./sessionRefresh.ts";

function tokenExpiringAt(expSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

describe("single-flight session refresh", () => {
  it("shares one in-flight renewal across concurrent callers", async () => {
    let calls = 0;
    let release: (value: RefreshAttempt) => void = () => undefined;
    const gate = createSessionRefresher({
      attempt: () => {
        calls += 1;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });

    const first = gate.refresh();
    const second = gate.refresh();
    const third = gate.refresh();
    assert.equal(calls, 1);

    release({ kind: "ok", accessToken: "abc" });
    const results = await Promise.all([first, second, third]);
    for (const result of results) {
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.accessToken, "abc");
    }

    const again = gate.refresh();
    assert.equal(calls, 2);
    release({ kind: "ok", accessToken: "next" });
    const next = await again;
    assert.equal(next.ok && next.accessToken, "next");
  });

  it("retries a short slow-down on the same flight and does not end the session", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const gate = createSessionRefresher({
      maxAttempts: 4,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      attempt: async () => {
        calls += 1;
        if (calls < 3) return { kind: "backoff", retryAfterMs: 25 };
        return { kind: "ok", accessToken: "renewed" };
      },
    });

    const [a, b] = await Promise.all([gate.refresh(), gate.refresh()]);
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [25, 25]);
    assert.equal(a.ok && a.accessToken, "renewed");
    assert.equal(b.ok && b.accessToken, "renewed");
  });

  it("does not retry a rejected session, and does not end the session when a long slow-down persists", async () => {
    let rejected = 0;
    const rejectedGate = createSessionRefresher({
      attempt: async () => {
        rejected += 1;
        return { kind: "unauthenticated" };
      },
      sleep: async () => {
        throw new Error("should not wait");
      },
    });
    const dead = await rejectedGate.refresh();
    assert.equal(dead.ok, false);
    if (!dead.ok) assert.equal(dead.logout, true);
    assert.equal(rejected, 1);

    let slowed = 0;
    const slowGate = createSessionRefresher({
      attempt: async () => {
        slowed += 1;
        return { kind: "backoff", retryAfterMs: 60_000 };
      },
      sleep: async () => {
        throw new Error("a long wait must not block the request");
      },
    });
    const waiting = await slowGate.refresh();
    assert.equal(slowed, 1);
    assert.equal(waiting.ok, false);
    if (!waiting.ok) {
      assert.equal(waiting.logout, false);
      if (!waiting.logout) assert.equal(waiting.retryAfterMs, 60_000);
    }
  });

  it("queues failed requests on one renewal and replays each of them", async () => {
    let calls = 0;
    const gate = createSessionRefresher({
      attempt: async () => {
        calls += 1;
        return { kind: "ok", accessToken: "shared" };
      },
    });
    const replays: string[] = [];
    let logouts = 0;
    const run = (id: string) =>
      settleAfterRefresh(
        () => gate.refresh(),
        async (token) => {
          replays.push(`${id}:${token}`);
          return id;
        },
        () => {
          logouts += 1;
        },
      );

    const settled = await Promise.all([run("a"), run("b"), run("c")]);
    assert.equal(calls, 1);
    assert.equal(logouts, 0);
    assert.deepEqual(replays.sort(), ["a:shared", "b:shared", "c:shared"]);
    assert.deepEqual(
      settled.map((item) => (item.ok ? item.value : "fail")),
      ["a", "b", "c"],
    );
  });

  it("logs out once the shared renewal is rejected, and not when it is only told to slow down", async () => {
    const dead = createSessionRefresher({
      attempt: async () => ({ kind: "unauthenticated" }),
    });
    let logouts = 0;
    const rejected = await settleAfterRefresh(
      () => dead.refresh(),
      async () => "nope",
      () => {
        logouts += 1;
      },
    );
    assert.equal(rejected.ok, false);
    assert.equal(logouts, 1);

    const slowed = createSessionRefresher({
      attempt: async () => ({ kind: "backoff", retryAfterMs: 10_000 }),
    });
    let slowLogouts = 0;
    const deferred = await settleAfterRefresh(
      () => slowed.refresh(),
      async () => "nope",
      () => {
        slowLogouts += 1;
      },
    );
    assert.equal(deferred.ok, false);
    if (!deferred.ok) assert.equal(deferred.logout, false);
    assert.equal(slowLogouts, 0);
  });
});

describe("when a renewal failure should end the session", () => {
  it("treats a definitive 401 as signed out and a 429 or 5xx as a wait", () => {
    assert.equal(classifyRefreshFailure(401, null, 0).kind, "unauthenticated");
    const limited = classifyRefreshFailure(429, "2", 0);
    assert.equal(limited.kind, "backoff");
    if (limited.kind === "backoff") assert.equal(limited.retryAfterMs, 2_000);
    const dropped = classifyRefreshFailure(undefined, null, 1);
    assert.equal(dropped.kind, "backoff");
    if (dropped.kind === "backoff") assert.equal(dropped.retryAfterMs, 2_000);
    for (const status of [403, 408, 500, 502, 503]) {
      assert.equal(classifyRefreshFailure(status, null, 0).kind, "backoff");
    }
  });

  it("does not log the user out on a 429 or a 5xx, and does on a 401", async () => {
    for (const status of [429, 500, 502, 503, undefined] as const) {
      const outcome = classifyRefreshFailure(status, "30", 0);
      assert.equal(outcome.kind, "backoff");
      const gate = createSessionRefresher({
        attempt: async () => outcome,
        sleep: async () => {
          throw new Error("a long wait must not block the request");
        },
      });
      let logouts = 0;
      const settled = await settleAfterRefresh(
        () => gate.refresh(),
        async () => "kept",
        () => {
          logouts += 1;
        },
      );
      assert.equal(settled.ok, false);
      if (!settled.ok) assert.equal(settled.logout, false);
      assert.equal(logouts, 0);
      assert.equal(bootstrapSessionDecision(await gate.refresh()), "retry");
      assert.equal(shouldRedirectToLogin({ accessToken: "still-here", reconnecting: true }), false);
      assert.equal(shouldRedirectToLogin({ accessToken: null, reconnecting: true }), false);
    }

    const expired = classifyRefreshFailure(401, null, 0);
    assert.equal(expired.kind, "unauthenticated");
    const dead = createSessionRefresher({
      attempt: async () => expired,
    });
    let expiredLogouts = 0;
    const rejected = await settleAfterRefresh(
      () => dead.refresh(),
      async () => "nope",
      () => {
        expiredLogouts += 1;
      },
    );
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.logout, true);
    assert.equal(expiredLogouts, 1);
    assert.equal(bootstrapSessionDecision(await dead.refresh()), "signed-out");
    assert.equal(shouldRedirectToLogin({ accessToken: null, reconnecting: false }), true);
  });

  it("reads Retry-After as seconds or a date, and backs off when it is missing", () => {
    assert.equal(retryDelayMs(0, "3"), 3_000);
    const now = 1_700_000_000_000;
    assert.equal(retryDelayMs(0, new Date(now + 4_000).toUTCString(), now), 4_000);
    assert.equal(retryDelayMs(0, null), 1_000);
    assert.equal(retryDelayMs(2, null), 4_000);
    assert.equal(retryDelayMs(0, "999999"), 15 * 60 * 1000);
  });
});

describe("proactive renewal", () => {
  it("renews shortly before the access token expires", () => {
    const exp = 1_700_000_000;
    const token = tokenExpiringAt(exp);
    const expiresAt = exp * 1000;
    assert.equal(proactiveRefreshDelayMs(token, expiresAt - 90_000), 30_000);
    assert.equal(proactiveRefreshDelayMs(token, expiresAt - 30_000), 0);
    assert.equal(proactiveRefreshDelayMs(token, expiresAt + 5_000), 0);
    assert.equal(proactiveRefreshDelayMs("not-a-token"), null);
  });

  it("does not schedule another immediate renewal right after one just finished", () => {
    const exp = 1_700_000_000;
    const token = tokenExpiringAt(exp);
    const now = exp * 1000 - 10_000;
    assert.equal(nextProactiveDelayMs(token, now, now - 1_000), 29_000);
    assert.equal(nextProactiveDelayMs(token, now, 0), 0);
    const fresh = tokenExpiringAt(exp);
    assert.equal(nextProactiveDelayMs(fresh, exp * 1000 - 14 * 60_000, exp * 1000), 13 * 60_000);
  });
});

describe("when a renewal is redundant", () => {
  const now = 1_700_000_000_000;

  it("does not renew a token that still has plenty of time left", () => {
    const token = tokenExpiringAt((now + 10 * 60_000) / 1000);
    assert.equal(tokenNearExpiry(token, now), false);
    assert.equal(refreshDecision({ reason: "proactive", accessToken: token, now }), "skip");
    assert.equal(refreshDecision({ reason: "bootstrap", accessToken: token, now }), "skip");
    assert.equal(refreshDecision({ reason: "unauthorized", accessToken: token, now }), "refresh");
    assert.equal(refreshDecision({ reason: "unauthorized", accessToken: token, now, lastSuccessAt: now - 1_000 }), "skip");
  });

  it("renews once the token is inside the lead window, but not again right after a success", () => {
    const token = tokenExpiringAt((now + 30_000) / 1000);
    assert.equal(tokenNearExpiry(token, now), true);
    assert.equal(refreshDecision({ reason: "proactive", accessToken: token, now, lastSuccessAt: now - 1_000 }), "skip");
    assert.equal(refreshDecision({ reason: "proactive", accessToken: token, now, lastSuccessAt: now - 60_000 }), "refresh");
    assert.equal(refreshDecision({ reason: "unauthorized", accessToken: token, now }), "refresh");
  });

  it("bootstraps when there is no token, and does not proactively renew a signed-out tab", () => {
    assert.equal(refreshDecision({ reason: "bootstrap", accessToken: null, now }), "refresh");
    assert.equal(refreshDecision({ reason: "proactive", accessToken: null, now }), "skip");
    assert.equal(refreshDecision({ reason: "unauthorized", accessToken: null, now }), "refresh");
  });
});

describe("load-time session check", () => {
  it("keeps a renewed session, signs out only when the server refused it, and retries a transient failure", () => {
    assert.equal(bootstrapSessionDecision({ ok: true, accessToken: "tok" }), "ready");
    assert.equal(bootstrapSessionDecision({ ok: false, logout: true }), "signed-out");
    assert.equal(bootstrapSessionDecision({ ok: false, logout: false, retryAfterMs: 8_000 }), "retry");
    assert.equal(shouldRedirectToLogin({ accessToken: "tok", reconnecting: false }), false);
    assert.equal(shouldRedirectToLogin({ accessToken: null, reconnecting: true }), false);
    assert.equal(shouldRedirectToLogin({ accessToken: null, reconnecting: false }), true);
  });

  it("does not start another renewal while a backoff is still open", () => {
    const now = 1_700_000_000_000;
    assert.equal(refreshWhileBackingOff(now, now + 8_000)?.retryAfterMs, 8_000);
    assert.equal(refreshWhileBackingOff(now, now + 8_000)?.logout, false);
    assert.equal(refreshWhileBackingOff(now, now), null);
    assert.equal(refreshWhileBackingOff(now, now - 1), null);
  });
});
