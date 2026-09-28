import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPictureToken, parsePictureText, pictureTextToPlain } from "./pictureText.ts";

describe("picture text", () => {
  it("leaves existing text unchanged", () => {
    const value = "Bore is 0.4 mm oversize.\nHeld the lot.";
    assert.deepEqual(parsePictureText(value), [{ kind: "text", text: value }]);
    assert.equal(pictureTextToPlain(value), value);
  });

  it("keeps a picture where it was placed, with its size and caption", () => {
    const value = `Before ${formatPictureToken(12, 240, "Scratch on the bore")} after`;
    assert.deepEqual(parsePictureText(value), [
      { kind: "text", text: "Before " },
      { kind: "picture", id: 12, width: 240, caption: "Scratch on the bore" },
      { kind: "text", text: " after" },
    ]);
    assert.equal(pictureTextToPlain(value), "Before [Picture: Scratch on the bore] after");
  });

  it("round-trips a picture that has no caption", () => {
    const value = formatPictureToken(4);
    assert.deepEqual(parsePictureText(value), [{ kind: "picture", id: 4, caption: "" }]);
    assert.equal(pictureTextToPlain(value), "[Picture]");
  });
});
