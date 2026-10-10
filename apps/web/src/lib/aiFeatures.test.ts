import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aiProviderStatus } from "./aiFeatures";

describe("AI provider status", () => {
  it("says whether AI is live and where the key comes from, without the key", () => {
    const live = aiProviderStatus("server", true);
    assert.match(live.live, /AI is live/);
    assert.match(live.key, /server environment/);
    assert.doesNotMatch(`${live.live} ${live.key}`, /sk-|api[_-]?key\s*[:=]/i);

    const companyOff = aiProviderStatus("company", false);
    assert.match(companyOff.live, /off for everyone/);
    assert.match(companyOff.key, /configured for this company/);
    assert.match(companyOff.key, /not shown/);

    const missing = aiProviderStatus("none", true);
    assert.match(missing.live, /placeholders/);
    assert.match(missing.key, /No AI provider key is configured/);

    const both = aiProviderStatus("both", true);
    assert.match(both.key, /company/);
    assert.match(both.key, /server environment/);
  });
});
