import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PaneErrorFallback } from "../components/shared/ErrorBoundary.tsx";

test("one pane's error stays in that pane", () => {
  const html = renderToStaticMarkup(createElement(PaneErrorFallback, { onRetry: () => undefined }));
  assert.match(html, /data-testid="pane-error"/);
  assert.match(html, /The other pane is still open/);
  assert.equal(html.includes("This page hit an unexpected error"), false);
});
