import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPdfBytes, presentPdf, PRINT_NOT_DOCUMENT, printShouldToast } from "./printDocument.ts";

describe("print document", () => {
  it("treats a PDF header as a document and rejects an error page", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    assert.equal(isPdfBytes(pdf), true);
    assert.equal(isPdfBytes(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c])), false);
    assert.equal(isPdfBytes(new Uint8Array()), false);
  });

  it("toasts only when printing actually failed", () => {
    assert.equal(printShouldToast("dialog"), false);
    assert.equal(printShouldToast("download"), false);
    assert.equal(printShouldToast("failed"), true);
  });

  it("rejects bytes that are not a PDF before opening a frame", async () => {
    await assert.rejects(() => presentPdf(new TextEncoder().encode("<html>no</html>"), "form.pdf"), {
      message: PRINT_NOT_DOCUMENT,
    });
  });
});
