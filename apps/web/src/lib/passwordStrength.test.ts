import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { passwordStrength } from "./passwordStrength.ts";

describe("password strength", () => {
  it("stays weak under 12 characters", () => {
    assert.equal(passwordStrength("").label, "Too short");
    assert.equal(passwordStrength("short-pass").label, "Weak");
  });

  it("rises as the temporary password gets longer and more mixed", () => {
    const fair = passwordStrength("violet-lantern-quarry");
    assert.equal(fair.label, "Fair");
    const strong = passwordStrength("Violet-Lantern-88!");
    assert.equal(strong.label, "Very strong");
  });
});
