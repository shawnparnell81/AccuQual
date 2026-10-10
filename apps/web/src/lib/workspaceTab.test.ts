import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  isExternalHref,
  isFolder,
  PERMANENT_SIDEBAR_LINKS,
  SIDEBAR_FOLDERS,
  type SidebarNode,
} from "../components/layout/sidebarStructure.ts";
import { developmentMenu, withDevelopment } from "./navigationLayout.ts";
import { deriveTabMeta } from "./tabMeta.ts";
import { isLiveTabPath } from "./tabPaths.ts";
import {
  closeWorkspaceTab,
  dedupeWorkspaceTabs,
  dropSuppressedTabs,
  followWorkspacePath,
  syncClosedWorkspace,
  workspaceSectionId,
  workspaceSections,
  workspaceTabKey,
  type WorkspaceSectionLink,
} from "./workspaceTab.ts";

const store = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../store/useTabStore.ts"), "utf8");

function tab(id: string, path: string, extra: { pinned?: boolean; title?: string } = {}) {
  return { id, path, title: extra.title ?? path, icon: "default", pinned: extra.pinned };
}

function navLinks(node: SidebarNode, links: WorkspaceSectionLink[]) {
  if (isFolder(node)) {
    if (node.path && node.path !== "/" && !isExternalHref(node.path) && !links.some((link) => link.path === node.path)) {
      links.push({ path: node.path, label: node.label });
    }
    for (const child of node.children) navLinks(child, links);
    return;
  }
  if (node.path && node.path !== "/" && !isExternalHref(node.path) && !links.some((link) => link.path === node.path)) {
    links.push({ path: node.path, label: node.label });
  }
}

/** Top-level folders that actually have sub-pages, plus permanent links such as Settings. */
function expectedSectionIds(): Set<string> {
  const ids = new Set<string>();
  for (const node of withDevelopment(SIDEBAR_FOLDERS, [developmentMenu()])) {
    if (!isFolder(node)) continue;
    const links: WorkspaceSectionLink[] = [];
    navLinks(node, links);
    if (links.some((link) => link.path !== node.path)) ids.add(node.key);
  }
  for (const link of PERMANENT_SIDEBAR_LINKS) {
    if (link.path && link.path !== "/" && !isExternalHref(link.path)) ids.add(link.key);
  }
  return ids;
}

describe("workspace section tabs", () => {
  it("shares one workspace tab across every nav section that has sub-pages", () => {
    const sections = workspaceSections();
    assert.deepEqual(new Set(sections.map((section) => section.id)), expectedSectionIds());
    for (const id of ["document-control", "quality", "engineering", "equipment", "suppliers", "reporting", "admin", "settings", "home"]) {
      assert.equal(sections.some((section) => section.id === id), true, id);
    }

    const keys = new Map<string, string>();
    for (const section of sections) {
      const owned = section.links.filter((link) => workspaceSectionId(link.path) === section.id).map((link) => link.path);
      if (section.root) owned.push(`${section.root}/not-a-listed-page`);
      const shared = new Set(owned.map((path) => workspaceTabKey(path)));
      assert.equal(shared.size, 1, `${section.id} split into ${[...shared].join(", ")}`);
      for (const link of section.links) assert.ok(workspaceSectionId(link.path), link.path);
      if (section.root) assert.equal(workspaceSectionId(`${section.root}/not-a-listed-page`), section.id);
      keys.set(section.id, [...shared][0]!);
      const paths = owned;
      if (paths.length < 2) continue;
      const opened = followWorkspacePath([], null, { path: paths[0]!, title: "A", icon: "default" }, () => `${section.id}-tab`);
      const moved = followWorkspacePath(opened.tabs, opened.activeId, { path: paths[1]!, title: "B", icon: "default" }, () => "extra");
      assert.equal(moved.tabs.length, 1, section.id);
      assert.equal(moved.activeId, `${section.id}-tab`);
      assert.equal(moved.tabs[0]?.path, paths[1]);
    }
    assert.equal(new Set(keys.values()).size, keys.size);

    assert.equal(workspaceTabKey("/ncr"), workspaceTabKey("/capa"));
    assert.equal(workspaceTabKey("/ncr/9"), workspaceTabKey("/8d/4"));
    assert.equal(workspaceTabKey("/documents/folders"), workspaceTabKey("/blank-forms"));
    assert.equal(workspaceTabKey("/form-folders/sop"), workspaceTabKey("/documents"));
    assert.equal(workspaceTabKey("/pareto"), workspaceTabKey("/reporting"));
    assert.equal(workspaceTabKey("/audit-log"), workspaceTabKey("/pareto"));
    assert.equal(workspaceTabKey("/feasibility"), workspaceTabKey("/folders/ecn"));
    assert.equal(workspaceTabKey("/calibration/master-list"), workspaceTabKey("/calibration/12"));
    assert.equal(workspaceTabKey("/suppliers/new"), workspaceTabKey("/supplier-portal"));
    assert.equal(workspaceTabKey("/admin/users"), workspaceTabKey("/admin/company-branding"));
    assert.equal(workspaceSectionId("/admin/import"), "admin");
    assert.equal(workspaceTabKey("/admin/company-ai"), workspaceTabKey("/admin/ai-usage"));
    assert.equal(workspaceTabKey("/settings/navigation"), workspaceTabKey("/settings/erp/presets/4"));
    assert.equal(workspaceSectionId("/documents/engineering-request-log"), "engineering");
    assert.equal(workspaceSectionId("/documents/development-log"), "engineering");
    assert.equal(workspaceTabKey("/documents/development-log"), workspaceTabKey("/feasibility"));
    assert.equal(workspaceSectionId("/"), null);
    assert.notEqual(workspaceTabKey("/ncr"), workspaceTabKey("/documents"));
    assert.notEqual(workspaceTabKey("/pareto"), workspaceTabKey("/"));
    assert.notEqual(workspaceTabKey("/admin/users"), workspaceTabKey("/workflow"));

    assert.equal(deriveTabMeta("/admin/roles-permissions").title, "Admin · Permissions");
    assert.equal(deriveTabMeta("/admin").title, "Admin");
    assert.equal(deriveTabMeta("/admin/plants").icon, "admin");
    assert.equal(deriveTabMeta("/admin/company-branding").title, "Admin · Company Branding");
    assert.equal(deriveTabMeta("/settings/navigation").title, "Settings · Navigation");
    assert.equal(deriveTabMeta("/settings/erp/presets/4").title, "Settings · ERP");
    assert.equal(deriveTabMeta("/settings").icon, "settings");
    assert.equal(deriveTabMeta("/documents/folders").title, "Documents · Folder Explorer");
    assert.equal(deriveTabMeta("/documents").title, "Documents");
    assert.equal(deriveTabMeta("/documents/folders").icon, "documents");
    assert.equal(deriveTabMeta("/ncr/9").title, "Quality · NCR");
    assert.equal(deriveTabMeta("/capa").icon, "quality");
    assert.equal(deriveTabMeta("/pareto").title, "Reports · Pareto");
    assert.equal(deriveTabMeta("/reporting").title, "Reports");
    assert.equal(deriveTabMeta("/documents/engineering-request-log").title, "Engineering · Engineering Request Log");
    assert.equal(deriveTabMeta("/calibration/master-list").title, "Equipment · Master Equipment List");
    assert.equal(deriveTabMeta("/suppliers/9").title, "Suppliers");
    assert.equal(deriveTabMeta("/").title, "Dashboard");
    assert.equal(deriveTabMeta("/executive").title, "Home · Executive dashboard");
    assert.equal(isLiveTabPath("/executive"), true);
    assert.equal(isLiveTabPath("/audit-log"), true);
    assert.equal(isLiveTabPath("/documents/engineering-request-log"), true);
    assert.equal(isLiveTabPath("/documents/development-log"), true);
    assert.equal(isLiveTabPath("/not-a-page"), false);
  });

  it("updates the open section tab in place and still opens a different section", () => {
    const start = [tab("home", "/", { title: "Dashboard" }), tab("admin", "/admin/users", { title: "Admin", pinned: true })];
    const plants = followWorkspacePath(start, "admin", { path: "/admin/plants", title: "Admin · Plants", icon: "admin" }, () => "new");
    assert.deepEqual(
      plants.tabs.map((row) => ({ id: row.id, path: row.path, pinned: row.pinned })),
      [
        { id: "home", path: "/", pinned: undefined },
        { id: "admin", path: "/admin/plants", pinned: true },
      ],
    );
    assert.equal(plants.activeId, "admin");

    const quality = followWorkspacePath(plants.tabs, plants.activeId, { path: "/ncr", title: "Quality · NCR", icon: "quality" }, () => "quality");
    assert.deepEqual(quality.tabs.map((row) => row.path), ["/", "/admin/plants", "/ncr"]);
    const capa = followWorkspacePath(quality.tabs, quality.activeId, { path: "/capa", title: "Quality · CAPA", icon: "quality" }, () => "again");
    assert.equal(capa.tabs.length, 3);
    assert.equal(capa.activeId, "quality");
    assert.equal(capa.tabs.find((row) => row.id === "quality")?.path, "/capa");
    assert.equal(capa.tabs.find((row) => row.id === "admin")?.pinned, true);

    const back = followWorkspacePath(capa.tabs, "home", { path: "/admin/login-history", title: "Admin · Login History", icon: "admin" }, () => "again");
    assert.equal(back.tabs.filter((row) => row.path.startsWith("/admin")).length, 1);
    assert.equal(back.activeId, "admin");
    assert.equal(back.tabs.find((row) => row.id === "admin")?.path, "/admin/login-history");
    assert.equal(back.tabs.find((row) => row.id === "admin")?.pinned, true);
  });

  it("collapses saved duplicate section tabs and keeps a pin", () => {
    const saved = [
      tab("dash", "/"),
      tab("a", "/admin/users", { title: "Admin" }),
      tab("b", "/admin/plants", { title: "Admin", pinned: true }),
      tab("c", "/admin/login-history", { title: "Admin" }),
      tab("set", "/settings", { title: "Settings" }),
      tab("nav", "/settings/navigation", { title: "Settings" }),
      tab("ncr", "/ncr", { title: "NCR" }),
      tab("capa", "/capa", { title: "CAPA", pinned: true }),
      tab("folders", "/documents/folders", { title: "Folder Explorer" }),
      tab("blanks", "/blank-forms", { title: "Blank Forms" }),
    ];
    const restored = dedupeWorkspaceTabs(saved, "c");
    assert.deepEqual(
      restored.tabs.map((row) => ({ id: row.id, path: row.path, pinned: Boolean(row.pinned) })),
      [
        { id: "dash", path: "/", pinned: false },
        { id: "c", path: "/admin/login-history", pinned: true },
        { id: "set", path: "/settings", pinned: false },
        { id: "ncr", path: "/ncr", pinned: true },
        { id: "folders", path: "/documents/folders", pinned: false },
      ],
    );
    assert.equal(restored.activeId, "c");
    assert.match(store, /dedupeWorkspaceTabs/);
    assert.match(store, /syncClosedWorkspace/);
    assert.match(store, /closeWorkspaceTab/);
  });

  it("closes the NCR section onto its neighbor and does not open it again", () => {
    assert.equal(workspaceTabKey("/ncr"), workspaceTabKey("/ncr/11"));
    assert.equal(workspaceTabKey("/ncr"), workspaceTabKey("/capa"));
    assert.equal(workspaceTabKey("/ncr"), workspaceTabKey("/8d"));
    const open = [
      tab("home", "/", { title: "Dashboard" }),
      tab("quality", "/ncr", { title: "Quality · NCR" }),
      tab("admin", "/admin/users", { title: "Admin" }),
    ];
    const closed = closeWorkspaceTab(open, "quality", [], "quality");
    assert.equal(closed.navigateTo, "/");
    assert.equal(closed.activeId, "home");
    assert.equal(closed.tabs.some((row) => row.path === "/ncr"), false);
    assert.ok(closed.suppressed.includes(workspaceTabKey("/ncr")));

    let session = closed;
    for (const path of ["/ncr", "/ncr/11", "/capa", "/8d/2"]) {
      const synced = syncClosedWorkspace(session.tabs, session.activeId, session.suppressed, { path, title: path, icon: "quality" }, () => "again", false);
      assert.equal(synced.tabs.some((row) => workspaceTabKey(row.path) === workspaceTabKey("/ncr")), false, path);
      assert.equal(synced.redirectTo, "/", path);
      assert.equal(synced.activeId, "home", path);
      session = { ...session, tabs: synced.tabs, activeId: synced.activeId, suppressed: synced.suppressed, navigateTo: synced.redirectTo };
    }

    const reopened = syncClosedWorkspace(session.tabs, session.activeId, session.suppressed, { path: "/ncr", title: "Quality · NCR", icon: "quality" }, () => "quality-2", true);
    assert.equal(reopened.redirectTo, null);
    assert.equal(reopened.activeId, "quality-2");
    assert.equal(reopened.tabs.find((row) => row.id === "quality-2")?.path, "/ncr");
    assert.equal(reopened.suppressed.includes(workspaceTabKey("/ncr")), false);
  });

  it("drops a closed section when saved tabs are loaded again", () => {
    const closed = closeWorkspaceTab(
      [tab("home", "/"), tab("quality", "/ncr/11"), tab("docs", "/documents")],
      "quality",
      [],
      "quality",
    );
    const loaded = dropSuppressedTabs(closed.tabs, closed.activeId, closed.suppressed);
    assert.equal(loaded.tabs.some((row) => workspaceTabKey(row.path) === workspaceTabKey("/ncr")), false);
    assert.equal(loaded.activeId, "home");
    const bounced = syncClosedWorkspace(loaded.tabs, loaded.activeId, closed.suppressed, { path: "/capa", title: "Quality · CAPA", icon: "quality" }, () => "nope", false);
    assert.equal(bounced.redirectTo, "/");
    assert.equal(bounced.tabs.length, loaded.tabs.length);
  });
});
