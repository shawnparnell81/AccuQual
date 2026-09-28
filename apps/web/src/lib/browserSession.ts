/**
 * Tells a live browser visit apart from a sign-in the browser put back
 * after it was closed.
 *
 * The refresh cookie is a session cookie. Chrome and Edge, when set to
 * continue where you left off, restore session cookies and can restore
 * sessionStorage too. A restored cookie is not a person still signed in.
 *
 * Each open tab writes a short-lived heartbeat and holds a browser lock.
 * A reload of the same tab keeps the sign-in. Another tab in the same
 * open browser joins it. A new visit after every tab is gone asks for the
 * password again. The 30-day trusted-browser cookie is not consulted here
 * and is not a sign-in.
 */

export const HEARTBEAT_STALE_MS = 3 * 60 * 1000;
export const RELOAD_GRACE_MS = 15_000;
/** A tab that just opened may not show up in the lock list for a moment. */
export const LOCK_ACQUIRE_GRACE_MS = 1_000;
export const HEARTBEAT_INTERVAL_MS = 20_000;
export const PEER_PING_MS = 400;

export const TAB_BEAT_PREFIX = "accuqual-tab-beat:";
export const TAB_ID_KEY = "accuqual-tab-id";
export const RELOAD_STAMP_KEY = "accuqual-reload-stamp";
export const SESSION_MARKER_KEY = "accuqual-browser-session";

const LOCK_NAME = "accuqual-browser-tab";
const CHANNEL_NAME = "accuqual-browser-tabs";

export type NavigationKind = "reload" | "navigate" | "back_forward" | "prerender" | "unknown";
export type BrowserSessionDecision = "continue" | "sign-in";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export interface BrowserSessionInput {
  now: number;
  navigation: NavigationKind;
  /** The browser reloaded a discarded tab, or restored this document from memory. */
  resumedDocument: boolean;
  tabId: string | null;
  /** Set when this tab adopted a sign-in. Lives in sessionStorage, so a new tab does not have it. */
  hasSessionMarker: boolean;
  /** Written on pagehide. Survives a reload of this tab. */
  reloadStamp: number | null;
  /** tab id → last heartbeat, from localStorage. Shared by every tab. */
  beats: Record<string, number>;
  /** Another document holds the browser lock or answered a ping. */
  peerAlive: boolean;
  /** False only when this browser cannot be asked whether another tab is open. */
  peerCheckAvailable: boolean;
}

export function readBeats(storage: StorageLike): Record<string, number> {
  const beats: Record<string, number> = {};
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key?.startsWith(TAB_BEAT_PREFIX)) continue;
    const id = key.slice(TAB_BEAT_PREFIX.length);
    const value = Number(storage.getItem(key));
    if (!id || !Number.isFinite(value)) continue;
    beats[id] = value;
  }
  return beats;
}

export function pruneBeats(storage: StorageLike, now: number, staleMs = HEARTBEAT_STALE_MS): void {
  const stale: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key?.startsWith(TAB_BEAT_PREFIX)) continue;
    const value = Number(storage.getItem(key));
    if (!Number.isFinite(value) || now - value > staleMs) stale.push(key);
  }
  for (const key of stale) storage.removeItem(key);
}

export function writeBeat(storage: StorageLike, tabId: string, now: number): void {
  storage.setItem(`${TAB_BEAT_PREFIX}${tabId}`, String(now));
  pruneBeats(storage, now);
}

export function removeBeat(storage: StorageLike, tabId: string): void {
  storage.removeItem(`${TAB_BEAT_PREFIX}${tabId}`);
}

export function freshestOtherBeatAge(beats: Record<string, number>, tabId: string | null, now: number): number {
  let best = Infinity;
  for (const [id, at] of Object.entries(beats)) {
    if (tabId && id === tabId) continue;
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    best = Math.min(best, now - at);
  }
  return best;
}

function ageOf(stamp: number | null, now: number): number {
  if (stamp == null || !Number.isFinite(stamp)) return Infinity;
  return now - stamp;
}

/**
 * Continue only when this visit is still the one that signed in.
 * A restored refresh cookie cannot satisfy this on its own.
 */
export function decideBrowserSession(input: BrowserSessionInput): BrowserSessionDecision {
  if (input.peerAlive) return "continue";

  const stampAge = ageOf(input.reloadStamp, input.now);
  const ownBeat = input.tabId != null ? input.beats[input.tabId] : undefined;
  const ownAge = ownBeat == null ? Infinity : input.now - ownBeat;
  const sameTab = input.hasSessionMarker;

  // Reload replaces the document but keeps sessionStorage. pagehide stamps
  // the time just before that, and the heartbeat from this tab is still new.
  if (sameTab && input.navigation === "reload" && (stampAge <= RELOAD_GRACE_MS || ownAge <= HEARTBEAT_STALE_MS)) {
    return "continue";
  }
  // Back/forward within the same tab, or a discarded tab the browser brings
  // back, while the last heartbeat is still inside the window.
  if (sameTab && input.navigation === "back_forward" && (stampAge <= HEARTBEAT_STALE_MS || ownAge <= HEARTBEAT_STALE_MS)) {
    return "continue";
  }
  if (sameTab && input.resumedDocument && (stampAge <= HEARTBEAT_STALE_MS || ownAge <= HEARTBEAT_STALE_MS)) {
    return "continue";
  }
  if (sameTab && input.navigation === "unknown" && (stampAge <= RELOAD_GRACE_MS || ownAge <= RELOAD_GRACE_MS)) {
    return "continue";
  }

  const otherAge = freshestOtherBeatAge(input.beats, input.tabId, input.now);
  if (otherAge <= HEARTBEAT_STALE_MS) {
    // No way to ask other tabs: a recent heartbeat is the signal that one is open.
    if (!input.peerCheckAvailable) return "continue";
    // The lock may not be visible for a moment after a tab starts.
    if (otherAge <= LOCK_ACQUIRE_GRACE_MS) return "continue";
  }
  return "sign-in";
}

export function readBrowserSessionRecord(session: StorageLike, local: StorageLike): Pick<BrowserSessionInput, "tabId" | "hasSessionMarker" | "reloadStamp" | "beats"> {
  const tabId = session.getItem(TAB_ID_KEY);
  const marker = session.getItem(SESSION_MARKER_KEY);
  const stamp = Number(session.getItem(RELOAD_STAMP_KEY));
  return {
    tabId: tabId && tabId.length > 0 ? tabId : null,
    hasSessionMarker: typeof marker === "string" && marker.length > 0,
    reloadStamp: Number.isFinite(stamp) ? stamp : null,
    beats: readBeats(local),
  };
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

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

const fallbackLocal = memoryStorage();
const fallbackSession = memoryStorage();
let useFallbackLocal = false;
let useFallbackSession = false;

function probeStore(store: Storage | undefined, fallback: StorageLike, useFallback: boolean): { store: StorageLike; fallback: boolean } {
  if (useFallback || !store) return { store: fallback, fallback: true };
  try {
    const probe = "__accuqual_browser_probe__";
    store.setItem(probe, "1");
    store.removeItem(probe);
    return { store, fallback: false };
  } catch {
    return { store: fallback, fallback: true };
  }
}

function localStore(): StorageLike {
  const resolved = probeStore(typeof localStorage === "undefined" ? undefined : localStorage, fallbackLocal, useFallbackLocal);
  useFallbackLocal = resolved.fallback;
  return resolved.store;
}

function sessionStore(): StorageLike {
  const resolved = probeStore(typeof sessionStorage === "undefined" ? undefined : sessionStorage, fallbackSession, useFallbackSession);
  useFallbackSession = resolved.fallback;
  return resolved.store;
}

function readNavigationKind(): NavigationKind {
  try {
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const type = entry?.type;
    if (type === "reload" || type === "navigate" || type === "back_forward" || type === "prerender") return type;
  } catch {
    // performance is missing in a few embedded browsers
  }
  return "unknown";
}

function readLiveInput(now: number): Omit<BrowserSessionInput, "peerAlive" | "peerCheckAvailable"> {
  const local = localStore();
  pruneBeats(local, now);
  return {
    now,
    navigation: readNavigationKind(),
    resumedDocument: typeof document !== "undefined" && "wasDiscarded" in document && document.wasDiscarded === true,
    ...readBrowserSessionRecord(sessionStore(), local),
  };
}

let channel: BroadcastChannel | null = null;
let listenersInstalled = false;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let lockRequested = false;

function ensureChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === "undefined") return null;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<{ type?: string; tabId?: string }>) => {
    const data = event.data;
    if (!data || data.type !== "ping" || typeof data.tabId !== "string") return;
    const session = sessionStore();
    const mine = session.getItem(TAB_ID_KEY);
    if (!mine || !session.getItem(SESSION_MARKER_KEY) || data.tabId === mine) return;
    channel?.postMessage({ type: "pong", tabId: mine });
  };
  return channel;
}

function pingPeers(timeoutMs: number): Promise<boolean> {
  const bus = ensureChannel();
  if (!bus) return Promise.resolve(false);
  const mine = sessionStore().getItem(TAB_ID_KEY) ?? "checking";
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      bus.removeEventListener("message", onMessage);
      resolve(false);
    }, timeoutMs);
    const onMessage = (event: MessageEvent<{ type?: string; tabId?: string }>) => {
      const data = event.data;
      if (!data || data.type !== "pong" || !data.tabId || data.tabId === mine) return;
      clearTimeout(timer);
      bus.removeEventListener("message", onMessage);
      resolve(true);
    };
    bus.addEventListener("message", onMessage);
    bus.postMessage({ type: "ping", tabId: mine });
  });
}

async function peerLockHeld(): Promise<boolean | null> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks?.query) return null;
  try {
    const state = await locks.query();
    const all = [...(state.held ?? []), ...(state.pending ?? [])];
    return all.some((lock) => lock.name === LOCK_NAME);
  } catch {
    return null;
  }
}

function onPageHide(event: PageTransitionEvent): void {
  if (event.persisted) return;
  const session = sessionStore();
  if (!session.getItem(SESSION_MARKER_KEY)) return;
  const tabId = session.getItem(TAB_ID_KEY);
  if (!tabId) return;
  const now = Date.now();
  writeBeat(localStore(), tabId, now);
  session.setItem(RELOAD_STAMP_KEY, String(now));
}

function onVisible(): void {
  if (typeof document === "undefined" || document.visibilityState !== "visible") return;
  const session = sessionStore();
  const tabId = session.getItem(TAB_ID_KEY);
  if (!tabId || !session.getItem(SESSION_MARKER_KEY)) return;
  writeBeat(localStore(), tabId, Date.now());
}

function installListeners(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("visibilitychange", onVisible);
  ensureChannel();
}

function holdLock(): void {
  if (lockRequested || typeof navigator === "undefined" || !navigator.locks?.request) return;
  lockRequested = true;
  void navigator.locks.request(LOCK_NAME, () => new Promise<void>(() => {})).catch(() => {
    lockRequested = false;
  });
}

/** Call before using a refresh cookie. A sign-in result must not refresh. */
export async function evaluateBrowserSessionOnLoad(now = Date.now()): Promise<BrowserSessionDecision> {
  installListeners();
  const base = readLiveInput(now);
  if (decideBrowserSession({ ...base, peerAlive: false, peerCheckAvailable: true }) === "continue") return "continue";

  const lock = await peerLockHeld();
  if (lock === true) return "continue";

  const otherAge = freshestOtherBeatAge(base.beats, base.tabId, base.now);
  const canPing = typeof BroadcastChannel !== "undefined";
  let peerAlive = false;
  if (canPing && otherAge <= HEARTBEAT_STALE_MS) peerAlive = await pingPeers(PEER_PING_MS);

  return decideBrowserSession({
    ...base,
    peerAlive,
    peerCheckAvailable: lock !== null || canPing,
  });
}

/** Marks this document as an open tab of the current sign-in. */
export function adoptBrowserSession(): void {
  if (typeof window === "undefined") return;
  installListeners();
  const session = sessionStore();
  let tabId = session.getItem(TAB_ID_KEY);
  if (!tabId) {
    tabId = randomId();
    session.setItem(TAB_ID_KEY, tabId);
  }
  if (!session.getItem(SESSION_MARKER_KEY)) session.setItem(SESSION_MARKER_KEY, randomId());
  writeBeat(localStore(), tabId, Date.now());
  holdLock();
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      const current = sessionStore();
      const id = current.getItem(TAB_ID_KEY);
      if (!id || !current.getItem(SESSION_MARKER_KEY)) return;
      writeBeat(localStore(), id, Date.now());
    }, HEARTBEAT_INTERVAL_MS);
  }
}

/** Drops this tab's heartbeat so a later visit is not treated as still open. */
export function releaseBrowserSessionTab(): void {
  const session = sessionStore();
  const tabId = session.getItem(TAB_ID_KEY);
  if (tabId) removeBeat(localStore(), tabId);
  session.removeItem(SESSION_MARKER_KEY);
  session.removeItem(RELOAD_STAMP_KEY);
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
}
