import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HEARTBEAT_STALE_MS,
  LOCK_ACQUIRE_GRACE_MS,
  RELOAD_GRACE_MS,
  SESSION_MARKER_KEY,
  TAB_BEAT_PREFIX,
  TAB_ID_KEY,
  RELOAD_STAMP_KEY,
  coldLoadKeepsSession,
  decideBrowserSession,
  freshestOtherBeatAge,
  pruneBeats,
  readBeats,
  readBrowserSessionRecord,
  removeBeat,
  writeBeat,
  type BrowserSessionInput,
  type StorageLike,
} from "./browserSession.js";

const NOW = 1_700_000_000_000;

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function input(overrides: Partial<BrowserSessionInput> = {}): BrowserSessionInput {
  return {
    now: NOW,
    navigation: "navigate",
    resumedDocument: false,
    tabId: null,
    hasSessionMarker: false,
    reloadStamp: null,
    beats: {},
    peerAlive: false,
    peerCheckAvailable: true,
    ...overrides,
  };
}

describe("browser session persistence", () => {
  it("keeps the heartbeat window inside 2 to 5 minutes", () => {
    assert.ok(HEARTBEAT_STALE_MS >= 2 * 60 * 1000);
    assert.ok(HEARTBEAT_STALE_MS <= 5 * 60 * 1000);
    assert.ok(RELOAD_GRACE_MS < HEARTBEAT_STALE_MS);
    assert.ok(LOCK_ACQUIRE_GRACE_MS < 5_000);
  });

  it("a reload of the same tab stays signed in", () => {
    assert.equal(
      decideBrowserSession(
        input({
          navigation: "reload",
          tabId: "tab-a",
          hasSessionMarker: true,
          reloadStamp: NOW - 50,
          beats: { "tab-a": NOW - 50 },
        }),
      ),
      "continue",
    );
  });

  it("typing an address in the same tab stays signed in", () => {
    assert.equal(
      decideBrowserSession(
        input({
          navigation: "navigate",
          tabId: "tab-a",
          hasSessionMarker: true,
          reloadStamp: NOW - 2_000,
          beats: { "tab-a": NOW - 2_000 },
        }),
      ),
      "continue",
    );
  });

  it("a reload and a typed address stay signed in when the session cookie is accepted", () => {
    assert.equal(coldLoadKeepsSession({ navigation: "reload", refreshCookieAccepted: true }), true);
    assert.equal(coldLoadKeepsSession({ navigation: "navigate", refreshCookieAccepted: true }), true);
  });

  it("closing the browser signs the user out because the session cookie is gone", () => {
    assert.equal(coldLoadKeepsSession({ navigation: "navigate", refreshCookieAccepted: false }), false);
    assert.equal(coldLoadKeepsSession({ navigation: "reload", refreshCookieAccepted: false }), false);
  });

  it("a reload stays signed in when the stamp was missed but this tab's heartbeat is still new", () => {
    assert.equal(
      decideBrowserSession(
        input({
          navigation: "reload",
          tabId: "tab-a",
          hasSessionMarker: true,
          beats: { "tab-a": NOW - 20_000 },
        }),
      ),
      "continue",
    );
  });

  it("a second tab stays signed in when another tab is alive", () => {
    assert.equal(
      decideBrowserSession(
        input({
          navigation: "navigate",
          tabId: null,
          beats: { "tab-a": NOW - 60_000 },
          peerAlive: true,
        }),
      ),
      "continue",
    );
  });

  it("a second tab stays signed in when the other tab's lock is not visible yet", () => {
    assert.equal(
      decideBrowserSession(
        input({
          beats: { "tab-a": NOW - 200 },
          peerAlive: false,
          peerCheckAvailable: true,
        }),
      ),
      "continue",
    );
  });

  it("a frozen tab that still holds the lock keeps a new tab signed in after the heartbeat window", () => {
    assert.equal(
      decideBrowserSession(
        input({
          beats: { "tab-a": NOW - HEARTBEAT_STALE_MS - 1_000 },
          peerAlive: true,
        }),
      ),
      "continue",
    );
  });

  it("a new tab stays signed in while another tab's heartbeat is still new", () => {
    assert.equal(
      decideBrowserSession(
        input({
          navigation: "navigate",
          hasSessionMarker: false,
          beats: { "tab-a": NOW - 30_000 },
          peerAlive: false,
          peerCheckAvailable: true,
        }),
      ),
      "continue",
    );
  });

  it("a heartbeat older than the window, with no open tab, requires the password", () => {
    assert.equal(
      decideBrowserSession(
        input({
          navigation: "navigate",
          hasSessionMarker: false,
          beats: { "tab-a": NOW - HEARTBEAT_STALE_MS - 1 },
          peerAlive: false,
          peerCheckAvailable: true,
        }),
      ),
      "sign-in",
    );
  });

  it("a leftover heartbeat older than the window requires the password even if other tabs cannot be asked", () => {
    assert.equal(
      decideBrowserSession(
        input({
          beats: { "tab-a": NOW - HEARTBEAT_STALE_MS - 1 },
          peerCheckAvailable: false,
        }),
      ),
      "sign-in",
    );
  });

  it("a recent heartbeat keeps the sign-in when this browser cannot tell whether a tab is open", () => {
    assert.equal(
      decideBrowserSession(
        input({
          beats: { "tab-a": NOW - 60_000 },
          peerCheckAvailable: false,
        }),
      ),
      "continue",
    );
  });

  it("a restored previous tab requires the password once its heartbeat is older than the window", () => {
    assert.equal(
      decideBrowserSession(
        input({
          navigation: "back_forward",
          tabId: "tab-a",
          hasSessionMarker: true,
          reloadStamp: NOW - HEARTBEAT_STALE_MS - 1,
          beats: { "tab-a": NOW - HEARTBEAT_STALE_MS - 1 },
        }),
      ),
      "sign-in",
    );
  });

  it("coming back to the same tab inside the window stays signed in", () => {
    assert.equal(
      decideBrowserSession(
        input({
          navigation: "back_forward",
          tabId: "tab-a",
          hasSessionMarker: true,
          reloadStamp: NOW - 20_000,
          beats: { "tab-a": NOW - 20_000 },
        }),
      ),
      "continue",
    );
  });

  it("a discarded tab the browser brings back stays signed in while the heartbeat is new", () => {
    assert.equal(
      decideBrowserSession(
        input({
          navigation: "navigate",
          resumedDocument: true,
          tabId: "tab-a",
          hasSessionMarker: true,
          beats: { "tab-a": NOW - 60_000 },
        }),
      ),
      "continue",
    );
  });

  it("the trusted-browser cookie is not a sign-in: an empty visit still requires the password", () => {
    assert.equal(decideBrowserSession(input()), "sign-in");
  });

  it("stores heartbeats per tab and drops ones older than the window", () => {
    const storage = memoryStorage();
    writeBeat(storage, "tab-a", NOW - 1_000);
    writeBeat(storage, "tab-b", NOW - HEARTBEAT_STALE_MS - 5_000);
    writeBeat(storage, "tab-a", NOW);
    assert.deepEqual(readBeats(storage), { "tab-a": NOW });
    assert.equal(freshestOtherBeatAge(readBeats(storage), "tab-a", NOW), Infinity);
    assert.equal(freshestOtherBeatAge(readBeats(storage), null, NOW), 0);

    removeBeat(storage, "tab-a");
    assert.deepEqual(readBeats(storage), {});
  });

  it("a reload reads the session marker and the heartbeat back out of storage", () => {
    const session = memoryStorage();
    const local = memoryStorage();
    session.setItem(TAB_ID_KEY, "tab-a");
    session.setItem(SESSION_MARKER_KEY, "marker-1");
    session.setItem(RELOAD_STAMP_KEY, String(NOW - 40));
    writeBeat(local, "tab-a", NOW - 40);
    local.setItem(`${TAB_BEAT_PREFIX}old`, String(NOW - HEARTBEAT_STALE_MS - 10));
    pruneBeats(local, NOW);

    const record = readBrowserSessionRecord(session, local);
    assert.equal(
      decideBrowserSession({
        now: NOW,
        navigation: "reload",
        resumedDocument: false,
        peerAlive: false,
        peerCheckAvailable: true,
        ...record,
      }),
      "continue",
    );
    assert.deepEqual(record.beats, { "tab-a": NOW - 40 });
  });

  it("a new tab does not see the session marker, and a recent heartbeat from another tab keeps the sign-in", () => {
    const session = memoryStorage();
    const local = memoryStorage();
    writeBeat(local, "tab-a", NOW - 30_000);
    const record = readBrowserSessionRecord(session, local);
    assert.equal(record.hasSessionMarker, false);
    assert.equal(
      decideBrowserSession({
        now: NOW,
        navigation: "navigate",
        resumedDocument: false,
        peerAlive: false,
        peerCheckAvailable: true,
        ...record,
      }),
      "continue",
    );
  });
});
