import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UnsavedTabDialog } from "../components/layout/TabBar.tsx";
import { useTabStore } from "../store/useTabStore.ts";
import {
  UNSAVED_TAB_TITLE,
  claimTabClosePrompt,
  closeSessionTab,
  releaseTabClosePrompt,
  resetTabSessionGuards,
  resolveTabClose,
  restoreSession,
  syncSessionLocation,
  unsavedTabMessage,
  type SessionTab,
  type TabSession,
} from "./tabSession.ts";

function tab(id: string, path: string, extra: { pinned?: boolean; title?: string; icon?: string } = {}): SessionTab {
  return { id, path, title: extra.title ?? path, icon: extra.icon ?? "default", pinned: extra.pinned };
}

/** Several open pages: NCR list, an NCR record, related records, and the other section kinds. */
function openStrip(): TabSession {
  return {
    tabs: [
      tab("home", "/", { title: "Dashboard", icon: "dashboard" }),
      tab("ncr", "/ncr", { title: "NCR", icon: "ncr" }),
      tab("record", "/ncr/11", { title: "NCR", icon: "ncr" }),
      tab("capa", "/capa/4", { title: "CAPA", icon: "capa" }),
      tab("eight", "/8d/2", { title: "8D", icon: "capa" }),
      tab("admin", "/admin/users", { title: "Admin", icon: "admin" }),
      tab("plants", "/admin/plants", { title: "Admin", icon: "admin" }),
      tab("settings", "/settings", { title: "Settings", icon: "settings" }),
      tab("nav", "/settings/navigation", { title: "Settings", icon: "settings" }),
      tab("form", "/qms-forms/audit_report", { title: "QMS Forms", icon: "documents" }),
      tab("blank", "/blank-forms/start/frm-ncr-001", { title: "Starting a blank", icon: "documents" }),
    ],
    activeId: "ncr",
    suppressedPaths: [],
  };
}

let ids = 0;
function createId() {
  ids += 1;
  return `new-${ids}`;
}

function paths(session: TabSession): string[] {
  return session.tabs.map((row) => row.path);
}

describe("closing a workspace tab", () => {
  beforeEach(() => {
    ids = 0;
    resetTabSessionGuards();
  });

  it("removes the active NCR tab and activates the neighbor, not the closed route", () => {
    const closed = closeSessionTab(openStrip(), "ncr");
    assert.equal(paths(closed.session).includes("/ncr"), false);
    assert.equal(closed.session.activeId, "home");
    assert.equal(closed.navigateTo, "/");
    assert.notEqual(closed.navigateTo, "/ncr");
    assert.deepEqual(closed.session.suppressedPaths, ["/ncr"]);

    const stale = syncSessionLocation(closed.session, "/ncr", { title: "NCR", icon: "ncr" }, createId, false);
    assert.equal(paths(stale.session).includes("/ncr"), false);
    assert.equal(stale.redirectTo, "/");
    assert.equal(ids, 0);

    const neighbor = syncSessionLocation(closed.session, "/", { title: "Dashboard", icon: "dashboard" }, createId, false);
    assert.equal(paths(neighbor.session).includes("/ncr"), false);
    assert.equal(neighbor.session.activeId, "home");
    assert.equal(neighbor.redirectTo, null);
  });

  it("removes an inactive NCR tab and does not let the open record, CAPA, or 8D put it back", () => {
    const viewingRecord = { ...openStrip(), activeId: "record" };
    const closed = closeSessionTab(viewingRecord, "ncr");
    assert.equal(closed.navigateTo, null);
    assert.equal(closed.session.activeId, "record");
    assert.equal(paths(closed.session).includes("/ncr"), false);

    for (const path of ["/ncr/11", "/capa/4", "/8d/2"]) {
      const synced = syncSessionLocation(closed.session, path, { title: path, icon: "default" }, createId, false);
      assert.equal(paths(synced.session).includes("/ncr"), false, path);
      assert.equal(synced.redirectTo, null, path);
    }

    const bounced = syncSessionLocation(closed.session, "/ncr", { title: "NCR", icon: "ncr" }, createId, false);
    assert.equal(paths(bounced.session).includes("/ncr"), false);
    assert.equal(bounced.redirectTo, "/ncr/11");
  });

  it("keeps a closed tab closed after the saved strip is loaded again", () => {
    const closed = closeSessionTab(openStrip(), "record");
    const saved = JSON.parse(JSON.stringify({
      tabs: closed.session.tabs,
      activeId: closed.session.activeId,
      suppressedPaths: closed.session.suppressedPaths,
    })) as { tabs: SessionTab[]; activeId: string | null; suppressedPaths: string[] };
    const restored = restoreSession(saved.tabs, saved.activeId, saved.suppressedPaths);
    assert.equal(paths(restored).includes("/ncr/11"), false);
    assert.equal(restored.suppressedPaths.includes("/ncr/11"), true);

    const again = syncSessionLocation(restored, "/ncr/11", { title: "NCR", icon: "ncr" }, createId, false);
    assert.equal(paths(again.session).includes("/ncr/11"), false);
    assert.equal(again.redirectTo, "/ncr");
    assert.equal(ids, 0);
  });

  it("still opens a closed page when the user goes there on purpose", () => {
    const closed = closeSessionTab(openStrip(), "ncr").session;
    const clicked = syncSessionLocation(closed, "/ncr", { title: "NCR", icon: "ncr" }, createId, true);
    assert.equal(paths(clicked.session).includes("/ncr"), true);
    assert.equal(clicked.session.activeId, "new-1");
    assert.equal(clicked.session.suppressedPaths.includes("/ncr"), false);
    assert.equal(clicked.redirectTo, null);
  });

  it("closes every section kind, active and inactive, without the route putting it back", () => {
    const cases: { id: string; path: string; active: string }[] = [
      { id: "admin", path: "/admin/users", active: "plants" },
      { id: "plants", path: "/admin/plants", active: "admin" },
      { id: "settings", path: "/settings", active: "nav" },
      { id: "nav", path: "/settings/navigation", active: "settings" },
      { id: "record", path: "/ncr/11", active: "capa" },
      { id: "capa", path: "/capa/4", active: "eight" },
      { id: "eight", path: "/8d/2", active: "record" },
      { id: "form", path: "/qms-forms/audit_report", active: "blank" },
      { id: "blank", path: "/blank-forms/start/frm-ncr-001", active: "form" },
    ];
    for (const row of cases) {
      const activeClose = closeSessionTab({ ...openStrip(), activeId: row.id }, row.id);
      assert.equal(paths(activeClose.session).includes(row.path), false, `${row.path} active`);
      assert.notEqual(activeClose.navigateTo, row.path, `${row.path} active target`);
      assert.ok(activeClose.navigateTo, `${row.path} has a neighbor`);
      const activeSync = syncSessionLocation(activeClose.session, row.path, { title: row.path, icon: "default" }, createId, false);
      assert.equal(paths(activeSync.session).includes(row.path), false, `${row.path} active sync`);
      assert.equal(activeSync.redirectTo, activeClose.navigateTo, `${row.path} redirect`);

      const inactiveClose = closeSessionTab({ ...openStrip(), activeId: row.active }, row.id);
      assert.equal(inactiveClose.navigateTo, null, `${row.path} inactive stays put`);
      assert.equal(inactiveClose.session.activeId, row.active, `${row.path} inactive active id`);
      assert.equal(paths(inactiveClose.session).includes(row.path), false, `${row.path} inactive`);
      const neighborPath = openStrip().tabs.find((item) => item.id === row.active)!.path;
      const inactiveSync = syncSessionLocation(inactiveClose.session, neighborPath, { title: neighborPath, icon: "default" }, createId, false);
      assert.equal(paths(inactiveSync.session).includes(row.path), false, `${row.path} inactive sync`);
      const bounced = syncSessionLocation(inactiveClose.session, row.path, { title: row.path, icon: "default" }, createId, false);
      assert.equal(paths(bounced.session).includes(row.path), false, `${row.path} bounce`);
    }
  });

  it("keeps a filtered list query when the address bar reports only the pathname", () => {
    const filtered = "/executive/list?kind=fai&bucket=open&dateRange=90d&siteId=6";
    const opened = syncSessionLocation(openStrip(), filtered, { title: "FAI", icon: "dashboard" }, createId, true);
    assert.equal(opened.session.tabs.find((row) => row.id === "new-1")?.path, filtered);
    assert.equal(opened.session.activeId, "new-1");

    const reported = syncSessionLocation(opened.session, "/executive/list", { title: "Executive", icon: "dashboard" }, createId, false);
    assert.equal(reported.session, opened.session);
    assert.equal(reported.session.tabs.filter((row) => row.path.startsWith("/executive/list")).length, 1);
    assert.equal(reported.session.tabs.find((row) => row.id === "new-1")?.path, filtered);
    assert.equal(ids, 1);

    const other = "/executive/list?kind=ncr&bucket=open&dateRange=90d&siteId=6";
    const second = syncSessionLocation(opened.session, other, { title: "NCR", icon: "dashboard" }, createId, true);
    assert.equal(second.session.tabs.filter((row) => row.path.startsWith("/executive/list")).length, 2);

    const restored = restoreSession(opened.session.tabs, opened.session.activeId, []);
    assert.equal(restored.tabs.find((row) => row.id === "new-1")?.path, filtered);
  });

  it("collapses a saved duplicate of the same page and drops a suppressed one", () => {
    const restored = restoreSession(
      [tab("a", "/ncr"), tab("b", "/ncr/"), tab("c", "/capa"), tab("d", "/ncr/11")],
      "b",
      ["/ncr/11"],
    );
    assert.deepEqual(paths(restored), ["/ncr", "/capa"]);
    assert.equal(restored.activeId, "b");
    assert.equal(restored.tabs.find((row) => row.id === "b")?.path, "/ncr");
  });

  it("shows the unsaved-changes dialog once, with Discard and Cancel", () => {
    const html = renderToStaticMarkup(createElement(UnsavedTabDialog, { label: "NCR", onDiscard: () => {}, onCancel: () => {} }));
    assert.match(html, /Unsaved changes/);
    assert.match(html, /Changes have not been saved on: NCR/);
    assert.match(html, /data-testid="unsaved-discard"/);
    assert.match(html, /Discard and close/);
    assert.match(html, /data-testid="unsaved-cancel"/);
    assert.match(html, />Cancel</);
    assert.equal(html.split('data-testid="unsaved-changes-dialog"').length - 1, 1);
  });

  it("asks once for unsaved edits, and Discard closes while Cancel stays", () => {
    assert.equal(UNSAVED_TAB_TITLE, "Unsaved changes");
    assert.equal(unsavedTabMessage("NCR"), "Changes have not been saved on: NCR. Do you want to continue without saving?");
    assert.equal(resolveTabClose(false, null), "close");
    assert.equal(resolveTabClose(true, null), "ask");
    assert.equal(resolveTabClose(true, "cancel"), "stay");
    assert.equal(resolveTabClose(true, "discard"), "close");
    assert.equal(claimTabClosePrompt(), true);
    assert.equal(claimTabClosePrompt(), false);
    releaseTabClosePrompt();
    assert.equal(claimTabClosePrompt(), true);
    releaseTabClosePrompt();
  });
});

describe("saved tabs stay closed across a reload", () => {
  beforeEach(() => {
    resetTabSessionGuards();
    const memory = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => void memory.set(key, value),
        removeItem: (key: string) => void memory.delete(key),
        clear: () => memory.clear(),
        key: () => null,
        length: 0,
      },
    });
    useTabStore.setState({ ownerId: null, tabs: [], activeId: null, suppressedPaths: [] });
  });

  it("drops a closed NCR tab even when a record and CAPA are still open", () => {
    useTabStore.getState().loadForUser("owner-1");
    useTabStore.getState().openTab({ path: "/", title: "Dashboard", icon: "dashboard" });
    useTabStore.getState().openTab({ path: "/ncr", title: "NCR", icon: "ncr" });
    useTabStore.getState().openTab({ path: "/ncr/11", title: "NCR", icon: "ncr" });
    useTabStore.getState().openTab({ path: "/capa/4", title: "CAPA", icon: "capa" });
    const ncr = useTabStore.getState().tabs.find((row) => row.path === "/ncr");
    assert.ok(ncr);
    useTabStore.getState().activateTab(ncr.id);
    const next = useTabStore.getState().closeTab(ncr.id);
    assert.equal(next, "/");
    assert.equal(useTabStore.getState().tabs.some((row) => row.path === "/ncr"), false);
    assert.equal(useTabStore.getState().syncActiveTabLocation("/ncr", "NCR", "ncr"), "/");
    assert.equal(useTabStore.getState().tabs.some((row) => row.path === "/ncr"), false);
    assert.equal(useTabStore.getState().syncActiveTabLocation("/ncr/11", "NCR", "ncr"), null);
    assert.equal(useTabStore.getState().tabs.some((row) => row.path === "/ncr"), false);

    useTabStore.setState({ ownerId: null, tabs: [], activeId: null, suppressedPaths: [] });
    useTabStore.getState().loadForUser("owner-1");
    assert.equal(useTabStore.getState().tabs.some((row) => row.path === "/ncr"), false);
    assert.equal(useTabStore.getState().tabs.some((row) => row.path === "/ncr/11"), true);
    const afterReload = useTabStore.getState().syncActiveTabLocation("/ncr", "NCR", "ncr");
    assert.equal(useTabStore.getState().tabs.some((row) => row.path === "/ncr"), false);
    assert.equal(afterReload, useTabStore.getState().tabs.find((row) => row.id === useTabStore.getState().activeId)?.path);
  });

  it("keeps an executive list filter when the route reports the pathname", () => {
    const filtered = "/executive/list?kind=fai&bucket=open&dateRange=90d&siteId=6";
    useTabStore.getState().loadForUser("owner-1");
    useTabStore.getState().openTab({ path: "/", title: "Dashboard", icon: "dashboard" });
    useTabStore.getState().openTab({ path: filtered, title: "FAI", icon: "dashboard" });
    assert.equal(useTabStore.getState().tabs.some((row) => row.path === filtered), true);
    assert.equal(useTabStore.getState().syncActiveTabLocation("/executive/list", "Executive", "dashboard"), null);
    assert.equal(useTabStore.getState().tabs.filter((row) => row.path.startsWith("/executive/list")).length, 1);
    assert.equal(useTabStore.getState().tabs.find((row) => row.path.startsWith("/executive/list"))?.path, filtered);
  });
});
