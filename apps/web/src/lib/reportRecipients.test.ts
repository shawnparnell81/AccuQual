import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addRecipient, normalizeReportRecipients, recipientLabel } from "./reportRecipients.ts";

describe("report recipients", () => {
  it("trims, lowercases, and drops duplicates and blanks", () => {
    const result = normalizeReportRecipients(["  Ada@Plant.com ", "", "ada@plant.com", " ops@plant.com "]);
    assert.deepEqual(result, { ok: true, emails: ["ada@plant.com", "ops@plant.com"] });
  });

  it("rejects a bad address and a non-list", () => {
    assert.equal(normalizeReportRecipients("ada@plant.com").ok, false);
    const bad = normalizeReportRecipients(["ada@plant.com", "not-an-email"]);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.error, /not-an-email/);
  });

  it("stops at 40 addresses", () => {
    const many = Array.from({ length: 41 }, (_, index) => `person${index}@plant.com`);
    const result = normalizeReportRecipients(many);
    assert.equal(result.ok, false);
  });

  it("refuses a duplicate and accepts a new address", () => {
    assert.equal(addRecipient(["ada@plant.com"], "Ada@plant.com").ok, false);
    assert.deepEqual(addRecipient(["ada@plant.com"], "Ops@Plant.com"), { ok: true, emails: ["ada@plant.com", "ops@plant.com"] });
  });

  it("shows a person's name when the address matches", () => {
    assert.equal(recipientLabel("ada@plant.com", [{ name: "Ada Lovelace", email: "Ada@plant.com" }]), "Ada Lovelace");
    assert.equal(recipientLabel("ops@plant.com", []), "ops@plant.com");
  });
});
