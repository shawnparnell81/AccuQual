import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { workspaceRouteElements } from "../routes/workspaceRoutes.tsx";

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

  it("does not treat Folders or a real redirect as a missing page", () => {
    assert.throws(() => markup("/form-folders"), /suspend/i);
    const reports = markup("/reports");
    assert.match(reports, /data-testid="app-shell"/);
    assert.equal(reports.includes("This page isn't in AccuQual"), false);
    assert.equal(reports.includes('data-testid="not-found"'), false);
  });
});
