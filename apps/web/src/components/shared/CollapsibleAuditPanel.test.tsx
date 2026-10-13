import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { CollapsibleAuditPanel } from "./CollapsibleAuditPanel";

function render(props: { count: number | null; forceOpen?: boolean }) {
  return renderToString(
    <CollapsibleAuditPanel title="Audit trail" count={props.count} forceOpen={props.forceOpen}>
      <p>entry one</p>
    </CollapsibleAuditPanel>,
  );
}

describe("CollapsibleAuditPanel", () => {
  it("renders collapsed by default with one header button showing the count", () => {
    const html = render({ count: 12 });
    assert.match(html, /<button[^>]*aria-expanded="false"/);
    assert.match(html, /Audit trail \(12 entries\)/);
    assert.match(html, /aria-controls="/);
    assert.match(html, /<div id="[^"]*" hidden=""/);
  });

  it("opens when forced (for example by a link to one history entry)", () => {
    const html = render({ count: 3, forceOpen: true });
    assert.match(html, /aria-expanded="true"/);
    assert.doesNotMatch(html, /hidden=""/);
  });

  it("uses a real button, so Enter and Space work from the keyboard", () => {
    const html = render({ count: 1 });
    assert.match(html, /<button type="button"/);
  });
});
