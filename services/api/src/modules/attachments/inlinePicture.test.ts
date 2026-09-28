import { describe, expect, it } from "vitest";
import { assertInlinePicture, pictureTextToPlain } from "./inlinePicture.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe("inline pictures", () => {
  it("accepts PNG, JPG, GIF, and WebP", () => {
    expect(assertInlinePicture(PNG, PNG.length)).toBe("image/png");
    expect(assertInlinePicture(JPEG, JPEG.length)).toBe("image/jpeg");
    expect(assertInlinePicture(GIF, GIF.length)).toBe("image/gif");
    expect(assertInlinePicture(WEBP, WEBP.length)).toBe("image/webp");
  });

  it("rejects a file that is not an image", () => {
    expect(() => assertInlinePicture(Buffer.from("%PDF-1.4"), 8)).toThrow(/PNG, JPG, GIF, or WebP/);
  });

  it("rejects a picture over 5 MB", () => {
    expect(() => assertInlinePicture(PNG, 5 * 1024 * 1024 + 1)).toThrow(/5 MB/);
  });

  it("keeps the words and names the picture by its caption", () => {
    expect(pictureTextToPlain("See [[aq-picture|id=3|w=100|c=Scratch%20on%20bore]] here")).toBe("See [Picture: Scratch on bore] here");
    expect(pictureTextToPlain("Held the lot.")).toBe("Held the lot.");
    expect(pictureTextToPlain("[[aq-picture|id=9]]")).toBe("[Picture]");
  });
});
