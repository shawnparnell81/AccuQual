import { describe, expect, it } from "vitest";
import { appRecordUrl } from "../src/lib/recordLink.js";

describe("appRecordUrl", () => {
  it("joins the public app origin to a record path", () => {
    expect(appRecordUrl("http://localhost:5183/", "/documents/4")).toBe("http://localhost:5183/documents/4");
    expect(appRecordUrl("https://app.example.com", "training/2")).toBe("https://app.example.com/training/2");
  });
});
