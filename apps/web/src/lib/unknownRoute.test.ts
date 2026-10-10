import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { routeNotFoundTriggersReconnect, showSessionReconnect } from "../api/sessionRefresh.ts";
import { workspaceRouteElements } from "../routes/workspaceRoutes.tsx";
import { blankFormsFolderHref } from "./folderBrowse.ts";
import { isKnownAppPath } from "./sidebarAccess.ts";

function Shell() {
  return createElement("div", { "data-testid": "app-shell" }, createElement("nav", null, "Sidebar"), createElement(Outlet));
}

function markup(path: string): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(Routes, null, createElement(Route, { element: createElement(Shell) }, workspaceRouteElements())),
    ),
  );
}

describe("unknown routes stay inside the app shell", () => {
  it("shows a not-found message in the shell instead of an empty window", () => {
    const html = markup("/this-page-is-not-in-accuqual");
    assert.match(html, /data-testid="app-shell"/);
    assert.match(html, /data-testid="not-found"/);
    assert.match(html, /This page isn(?:'|&#x27;)t in AccuQual/);
    assert.match(html, /Sidebar/);
  });

  it("opens Blank Forms in the app and keeps the start route", () => {
    const routes = workspaceRouteElements();
    const blank = routes.find((route) => route.props.path === "/blank-forms");
    assert.equal(blank?.props.element?.props?.to, undefined);
    assert.equal(routes.some((route) => route.props.path === "/blank-forms/start/:formKey"), true);
    assert.equal(routes.some((route) => route.props.path === "/fai" || route.props.path === "/fai/csa"), false);
    assert.equal(blankFormsFolderHref(), "/documents/folders?name=Blank%20Forms%20Templates");
    assert.throws(() => markup("/blank-forms"), /suspend/i);
    const retired = markup("/fai");
    assert.match(retired, /This page isn(?:'|&#x27;)t in AccuQual/);
    assert.match(markup("/fai/csa"), /This page isn(?:'|&#x27;)t in AccuQual/);
  });

  it("shows the 404 page for /capa/new and /8d/new and does not treat that as a session problem", () => {
    for (const path of ["/capa/new", "/8d/new", "/capa/abc"]) {
      const html = markup(path);
      assert.match(html, /data-testid="not-found"/);
      assert.equal(html.includes("Reconnecting your session"), false);
      assert.equal(isKnownAppPath(path), false);
    }
    assert.equal(isKnownAppPath("/capa/12"), true);
    assert.equal(routeNotFoundTriggersReconnect(404), false);
    assert.equal(showSessionReconnect({ reconnecting: true, accessToken: null, knownPath: false }), false);
    assert.equal(showSessionReconnect({ reconnecting: true, accessToken: null, knownPath: true }), true);
  });

  it("does not treat Folders or a real redirect as a missing page", () => {
    assert.throws(() => markup("/form-folders"), /suspend/i);
    const reports = markup("/reports");
    assert.match(reports, /data-testid="app-shell"/);
    assert.equal(reports.includes("This page isn't in AccuQual"), false);
    assert.equal(reports.includes('data-testid="not-found"'), false);
  });
});
