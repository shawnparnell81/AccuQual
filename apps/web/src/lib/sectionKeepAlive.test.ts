import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLOSE_TAB_MESSAGE,
  LEAVE_SECTION_MESSAGE,
  commitSectionPath,
  dirtyKeysInSection,
  draftKey,
  hrefFromTo,
  isEditField,
  isSaveControl,
  isSectionPathCommitted,
  planSectionVisit,
  sectionHasUnsaved,
  shouldWarnOnClose,
  shouldWarnOnNavigate,
  skipNextLeaveWarning,
  subrouteHasUnsaved,
  subtabHasUnsaved,
  takeSkipLeaveWarning,
  type KeptPage,
} from "./sectionKeepAlive.ts";

function kept(pathname: string, search = "", hash = ""): KeptPage {
  return { pathname, search, hash };
}

describe("section keep-alive", () => {
  it("keeps every visited sub-page when switching inside a section and does not warn", () => {
    const start = planSectionVisit({
      kept: [],
      from: "",
      toPath: "/admin/users",
      toSearch: "",
      toHash: "",
      dirty: {},
      confirmedLeave: false,
    });
    const plants = planSectionVisit({
      kept: start.kept,
      from: "/admin/users",
      toPath: "/admin/plants",
      toSearch: "",
      toHash: "",
      dirty: { "/admin/users": true },
      confirmedLeave: false,
    });
    assert.equal(plants.action, "apply");
    assert.deepEqual(
      plants.kept.map((page) => page.pathname),
      ["/admin/users", "/admin/plants"],
    );
    assert.equal(plants.active, "/admin/plants");
    assert.equal(shouldWarnOnNavigate({ "/admin/users": true }, "/admin/users", "/admin/plants"), false);
    assert.equal(shouldWarnOnNavigate({ "/ncr": true, "/capa": true }, "/capa", "/training"), false);
    assert.equal(shouldWarnOnNavigate({ "/documents/folders": true }, "/documents/folders", "/blank-forms"), false);
    assert.equal(shouldWarnOnNavigate({ "/pareto": true }, "/pareto", "/reporting"), false);

    const back = planSectionVisit({
      kept: plants.kept,
      from: "/admin/plants",
      toPath: "/admin/users",
      toSearch: "?invite=1",
      toHash: "",
      dirty: { "/admin/users": true },
      confirmedLeave: false,
    });
    assert.equal(back.action, "apply");
    assert.deepEqual(
      back.kept.map((page) => page.pathname),
      ["/admin/users", "/admin/plants"],
    );
    assert.equal(back.kept.find((page) => page.pathname === "/admin/users")?.search, "?invite=1");
    assert.equal(sectionHasUnsaved({ "/admin/users": true }, "/admin/plants"), true);
  });

  it("asks before leaving a dirty section and drops those pages only after confirm", () => {
    const dirty = { "/ncr": true, "/capa": true };
    assert.equal(shouldWarnOnNavigate(dirty, "/capa", "/documents/folders"), true);
    assert.equal(shouldWarnOnNavigate({ "/ncr": false }, "/ncr", "/documents"), false);
    const ask = planSectionVisit({
      kept: [kept("/ncr"), kept("/capa")],
      from: "/capa",
      toPath: "/documents/folders",
      toSearch: "",
      toHash: "",
      dirty,
      confirmedLeave: false,
    });
    assert.equal(ask.action, "ask");
    assert.deepEqual(
      ask.kept.map((page) => page.pathname),
      ["/ncr", "/capa"],
    );
    assert.equal(ask.active, "/capa");

    const left = planSectionVisit({
      kept: ask.kept,
      from: "/capa",
      toPath: "/documents/folders",
      toSearch: "",
      toHash: "",
      dirty,
      confirmedLeave: true,
    });
    assert.equal(left.action, "apply");
    assert.deepEqual(
      left.kept.map((page) => page.pathname),
      ["/documents/folders"],
    );
    assert.match(LEAVE_SECTION_MESSAGE, /unsaved changes/i);
    assert.match(CLOSE_TAB_MESSAGE, /unsaved changes/i);
  });

  it("shows a dot per dirty sub-page and clears only the one that was saved", () => {
    const dirty = { "/admin/users": true, "/admin/plants": true, "/settings#Security": true };
    assert.equal(subrouteHasUnsaved(dirty, "/admin/users"), true);
    assert.equal(subrouteHasUnsaved(dirty, "/admin/login-history"), false);
    assert.equal(subtabHasUnsaved(dirty, "/settings", "Security"), true);
    assert.equal(subtabHasUnsaved(dirty, "/settings", "Theme"), false);
    assert.equal(sectionHasUnsaved(dirty, "/admin/login-history"), true);
    assert.equal(shouldWarnOnClose(dirty, "/admin/plants"), true);
    assert.equal(shouldWarnOnClose(dirty, "/documents/folders"), false);

    const saved = { ...dirty, "/admin/users": false };
    assert.equal(subrouteHasUnsaved(saved, "/admin/users"), false);
    assert.equal(subrouteHasUnsaved(saved, "/admin/plants"), true);
    assert.deepEqual(dirtyKeysInSection(saved, "/admin"), ["/admin/plants"]);
    assert.equal(draftKey("/settings/", "Security"), "/settings#Security");
  });

  it("treats an in-page save control and a real field as draft signals", () => {
    assert.equal(isSaveControl("Save"), true);
    assert.equal(isSaveControl("Save changes"), true);
    assert.equal(isSaveControl("Save assignments"), true);
    assert.equal(isSaveControl("Save view"), false);
    assert.equal(isSaveControl("Save as template"), false);
    assert.equal(isSaveControl("Apply", "button"), true);
    assert.equal(isSaveControl("Continue", "submit"), true);
    assert.equal(isEditField("input", "text"), true);
    assert.equal(isEditField("input", "checkbox"), true);
    assert.equal(isEditField("input", "search"), false);
    assert.equal(isEditField("textarea"), true);
    assert.equal(isEditField("button", "button", "switch"), true);
    assert.equal(hrefFromTo("/admin/users", "", "plants"), "/admin/plants");
    assert.equal(hrefFromTo("/admin/users", "?x=1", { pathname: "/settings/navigation" }), "/settings/navigation");
  });

  it("does not treat a cancelled leave as the open page", () => {
    commitSectionPath("/admin/plants");
    assert.equal(isSectionPathCommitted("/admin/plants"), true);
    assert.equal(isSectionPathCommitted("/ncr"), false);
    commitSectionPath("/settings");
    assert.equal(isSectionPathCommitted("/settings"), true);
  });

  it("lets a confirmed tab close skip the second leave prompt", () => {
    assert.equal(takeSkipLeaveWarning(), false);
    skipNextLeaveWarning();
    assert.equal(takeSkipLeaveWarning(), true);
    assert.equal(takeSkipLeaveWarning(), false);
  });
});
