import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { deriveTabMeta } from "./tabMeta.ts";
import { dedupeWorkspaceTabs, followWorkspacePath, workspaceTabKey } from "./workspaceTab.ts";

const store = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../store/useTabStore.ts"), "utf8");

function tab(id: string, path: string, extra: { pinned?: boolean; title?: string } = {}) {
  return { id, path, title: extra.title ?? path, icon: "default", pinned: extra.pinned };
}

describe("workspace section tabs", () => {
  it("keeps admin and settings sub-pages on one tab and leaves other pages alone", () => {
    assert.equal(workspaceTabKey("/admin/users"), workspaceTabKey("/admin/roles-permissions"));
    assert.equal(workspaceTabKey("/admin"), workspaceTabKey("/admin/login-history"));
    assert.equal(workspaceTabKey("/admin/company-ai"), workspaceTabKey("/admin/ai-usage"));
    assert.notEqual(workspaceTabKey("/admin/users"), workspaceTabKey("/workflow"));
    assert.notEqual(workspaceTabKey("/admin/users"), workspaceTabKey("/reporting"));
    assert.equal(workspaceTabKey("/settings"), workspaceTabKey("/settings/navigation"));
    assert.equal(workspaceTabKey("/settings/erp/presets"), workspaceTabKey("/settings/erp/presets/4"));
    assert.equal(workspaceTabKey("/settings/erp/sync-errors"), workspaceTabKey("/settings"));
    assert.notEqual(workspaceTabKey("/ncr"), workspaceTabKey("/ncr/9"));
    assert.notEqual(workspaceTabKey("/documents"), workspaceTabKey("/documents/folders"));
    assert.equal(deriveTabMeta("/admin/roles-permissions").title, "Admin · Permissions");
    assert.equal(deriveTabMeta("/admin").title, "Admin");
    assert.equal(deriveTabMeta("/admin/plants").icon, "admin");
    assert.equal(deriveTabMeta("/settings/navigation").title, "Settings · Navigation");
    assert.equal(deriveTabMeta("/settings/erp/presets/4").title, "Settings · ERP / NetSuite");
    assert.equal(deriveTabMeta("/documents/folders").title, "Folder Explorer");
  });

  it("updates the open admin tab in place and still opens a different section", () => {
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

    const workflow = followWorkspacePath(plants.tabs, plants.activeId, { path: "/workflow", title: "Workflow Builder", icon: "default" }, () => "flow");
    assert.deepEqual(workflow.tabs.map((row) => row.path), ["/", "/admin/plants", "/workflow"]);
    assert.equal(workflow.tabs.find((row) => row.id === "admin")?.pinned, true);

    const back = followWorkspacePath(workflow.tabs, "home", { path: "/admin/login-history", title: "Admin · Login History", icon: "admin" }, () => "again");
    assert.equal(back.tabs.filter((row) => row.path.startsWith("/admin")).length, 1);
    assert.equal(back.activeId, "admin");
    assert.equal(back.tabs.find((row) => row.id === "admin")?.path, "/admin/login-history");
    assert.equal(back.tabs.find((row) => row.id === "admin")?.pinned, true);
  });

  it("collapses saved duplicate admin tabs and keeps a pin", () => {
    const saved = [
      tab("dash", "/"),
      tab("a", "/admin/users", { title: "Admin" }),
      tab("b", "/admin/plants", { title: "Admin", pinned: true }),
      tab("c", "/admin/login-history", { title: "Admin" }),
      tab("set", "/settings", { title: "Settings" }),
      tab("nav", "/settings/navigation", { title: "Settings" }),
    ];
    const restored = dedupeWorkspaceTabs(saved, "c");
    assert.deepEqual(
      restored.tabs.map((row) => ({ id: row.id, path: row.path, pinned: Boolean(row.pinned) })),
      [
        { id: "dash", path: "/", pinned: false },
        { id: "c", path: "/admin/login-history", pinned: true },
        { id: "set", path: "/settings", pinned: false },
      ],
    );
    assert.equal(restored.activeId, "c");
    assert.match(store, /dedupeWorkspaceTabs/);
    assert.match(store, /followWorkspacePath/);
  });
});
