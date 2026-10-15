import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { sanitizeBandHtml } from "../src/modules/form-builder/bandSanitize.js";
import { verifyAccessToken } from "../src/utils/jwt.js";
import { env } from "../src/config/env.js";

describe("header and footer HTML", () => {
  it("drops scripts, event handlers and javascript links", () => {
    const html = sanitizeBandHtml('<p onclick="x()">Hi<script>alert(1)</script><a href="javascript:x()">a</a><img src="x" onerror="y()"><iframe src="https://e.x"></iframe></p>');
    expect(html).not.toMatch(/script|onclick|onerror|javascript|iframe/i);
    expect(html).toContain("Hi");
  });

  it("keeps formatting, tables, images and document fields", () => {
    const path = '<span class="fb-folder-path" data-folder-path="true" contenteditable="false">Folder path</span>';
    const field = '<span class="fb-doc-field" data-doc-field="page" contenteditable="false">Page number</span>';
    const html = `<table><tbody><tr><td colspan="2" style="width:50%"><strong>Doc</strong> ${field} ${path}</td></tr></tbody></table><img src="data:image/png;base64,AAAA" alt="logo" />`;
    expect(sanitizeBandHtml(html)).toBe(html);
  });
});

describe("token verification", () => {
  it("refuses a token signed with a different algorithm", () => {
    const token = jwt.sign({ sub: "1" }, env.JWT_ACCESS_SECRET, { algorithm: "HS512" });
    expect(() => verifyAccessToken(token)).toThrow();
  });
});
