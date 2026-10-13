import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SIDEBAR_FOLDERS, flattenSidebarLinks } from "../components/layout/sidebarStructure.ts";
import { filterSidebarByAccess, plannerHref, type SidebarAccess } from "./sidebarAccess.ts";

function access(map: Record<string, string>, extra: Partial<SidebarAccess> = {}): SidebarAccess {
  return { levels: new Proxy({} as Record<string, string>, { get: (_t, prop) => map[String(prop)] ?? "none" }), ...extra };
}

function links(a: SidebarAccess) {
  return flattenSidebarLinks(filterSidebarByAccess(SIDEBAR_FOLDERS, a));
}

describe("Engineering Planner is a per-company link", () => {
  const everything = new Proxy({} as Record<string, string>, { get: () => "edit" });

  it("is hidden when the company has no link", () => {
    assert.equal(links({ levels: everything, plannerUrl: null }).some((l) => l.key === "engineering-planner"), false);
    assert.equal(links({ levels: everything }).some((l) => l.key === "engineering-planner"), false);
    assert.equal(links({ levels: everything, plannerUrl: "javascript:alert(1)" }).some((l) => l.key === "engineering-planner"), false);
  });

  it("opens the company's own link when one is set", () => {
    const planner = links({ levels: everything, plannerUrl: "https://planner.example.com/team" }).find((l) => l.key === "engineering-planner");
    assert.ok(planner);
    assert.equal(planner.path, "https://planner.example.com/team");
  });

  it("only accepts http and https addresses", () => {
    assert.equal(plannerHref("  https://a.example/x "), "https://a.example/x");
    assert.equal(plannerHref("ftp://a.example"), null);
    assert.equal(plannerHref(""), null);
    assert.equal(plannerHref(undefined), null);
  });
});

describe("Customer Complaints menu item follows the Complaints permission", () => {
  it("is hidden without Complaints access and shown with it", () => {
    assert.equal(links(access({ warranty: "edit" })).some((l) => l.key === "customer-complaints"), false);
    assert.equal(links(access({ complaints: "none" })).some((l) => l.key === "customer-complaints"), false);
    assert.equal(links(access({ complaints: "read" })).some((l) => l.key === "customer-complaints"), true);
    assert.equal(links(access({ complaints: "edit" })).some((l) => l.key === "customer-complaints"), true);
  });
});
