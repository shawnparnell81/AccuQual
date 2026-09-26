import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";
import { authorizeOfficeFile, decideOfficeAccess, type OfficeActor, type OfficeStoredFile } from "../src/modules/onlyoffice/access.js";
import { resolveSavedFileUrl } from "../src/modules/onlyoffice/download.js";
import { buildEditorConfig, editorDocumentKey, officeDocumentType } from "../src/modules/onlyoffice/editorConfig.js";
import { readFileClaims, signOfficeToken, verifyOfficeToken } from "../src/modules/onlyoffice/token.js";
import { AppError } from "../src/utils/appError.js";

const actor: OfficeActor = { id: 7, roleName: "quality_manager", department: "quality", name: "Ada" };
const draftDocx: OfficeStoredFile = {
  fileId: 4,
  status: "draft",
  fileName: "procedure.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  sha256: "a".repeat(64),
  sizeBytes: 100,
  filePath: "/tmp/procedure.docx",
  sharedWithOtherRevision: false,
};

function deps(file: OfficeStoredFile | null, permissions: { view?: boolean; edit?: boolean; viewReason?: string } = {}) {
  const hasPermission = vi.fn(async (_db: unknown, _user: unknown, name: string) => {
    if (name === "document.view") return { allowed: permissions.view !== false, reason: permissions.viewReason };
    if (name === "document.edit") return { allowed: permissions.edit === true };
    return { allowed: false, reason: "unknown" };
  });
  const loadFile = vi.fn(async () => file);
  return { hasPermission, loadFile };
}

describe("authorizeOfficeFile", () => {
  it("refuses when document.view is denied and does not look up the file", async () => {
    const gate = deps(draftDocx, { view: false, viewReason: "Requires read access to documents" });
    const result = await authorizeOfficeFile({} as never, actor, { documentId: 1, versionId: 2, fileId: 4 }, gate);
    expect(result).toEqual({ ok: false, status: 403, reason: "Requires read access to documents" });
    expect(gate.hasPermission).toHaveBeenCalledWith(expect.anything(), actor, "document.view");
    expect(gate.hasPermission).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), "document.edit");
    expect(gate.loadFile).not.toHaveBeenCalled();
  });

  it("opens a draft for editing when document.edit is allowed", async () => {
    const gate = deps(draftDocx, { edit: true });
    const result = await authorizeOfficeFile({} as never, actor, { documentId: 1, versionId: 2, fileId: 4 }, gate);
    expect(result).toMatchObject({ ok: true, mode: "edit", file: draftDocx });
    expect(gate.hasPermission).toHaveBeenCalledWith(expect.anything(), actor, "document.edit");
  });

  it("opens a draft read-only when the caller can view but not edit", async () => {
    const gate = deps(draftDocx, { edit: false });
    const result = await authorizeOfficeFile({} as never, actor, { documentId: 1, versionId: 2, fileId: 4 }, gate);
    expect(result).toMatchObject({ ok: true, mode: "view" });
  });

  it("keeps a published revision read-only even when document.edit is allowed", async () => {
    const gate = deps({ ...draftDocx, status: "published" }, { edit: true });
    const result = await authorizeOfficeFile({} as never, actor, { documentId: 1, versionId: 2, fileId: 4 }, gate);
    expect(result).toMatchObject({ ok: true, mode: "view" });
  });

  it("keeps an in-review revision read-only", async () => {
    const gate = deps({ ...draftDocx, status: "in_review" }, { edit: true });
    const result = await authorizeOfficeFile({} as never, actor, { documentId: 1, versionId: 2, fileId: 4 }, gate);
    expect(result).toMatchObject({ ok: true, mode: "view" });
  });

  it("reports a missing attachment", async () => {
    const gate = deps(null, { edit: true });
    const result = await authorizeOfficeFile({} as never, actor, { documentId: 1, versionId: 2, fileId: 9 }, gate);
    expect(result).toEqual({ ok: false, status: 404, reason: "Attachment not found" });
  });

  it("rejects a file that is not Word or Excel", async () => {
    const gate = deps({ ...draftDocx, fileName: "scan.pdf" }, { edit: true });
    const result = await authorizeOfficeFile({} as never, actor, { documentId: 1, versionId: 2, fileId: 4 }, gate);
    expect(result).toMatchObject({ ok: false, status: 415 });
  });
});

describe("decideOfficeAccess", () => {
  it("agrees with the helper for a draft the caller can edit", () => {
    expect(decideOfficeAccess({ allowed: true }, { allowed: true }, draftDocx)).toEqual({ ok: true, mode: "edit" });
  });
});

describe("office editor tokens", () => {
  const secret = "test-onlyoffice-secret";

  it("recognizes Word and Excel names and builds a key the document server will accept", () => {
    expect(officeDocumentType("Work Instruction.DOCX")).toBe("word");
    expect(officeDocumentType("log.xlsx")).toBe("cell");
    expect(officeDocumentType("scan.pdf")).toBeNull();
    expect(editorDocumentKey(12, "abc")).toMatch(/^f12-/);
  });

  it("rejects an editor-config token used as a file link", () => {
    const config = buildEditorConfig(
      {
        fileId: 4,
        fileName: "procedure.docx",
        sha256: "b".repeat(64),
        mode: "view",
        user: { id: 7, name: "Ada" },
        fileUrl: "http://api:3000/onlyoffice/file?token=x",
        callbackUrl: "http://api:3000/onlyoffice/callback?token=y",
      },
      secret,
    );
    const token = String(config.token);
    expect(jwt.verify(token, secret)).toMatchObject({ documentType: "word" });
    expect(() => verifyOfficeToken(secret, "oo-file", token)).toThrow(AppError);
  });

  it("round-trips a file link and refuses the other purpose", () => {
    const token = signOfficeToken(secret, "oo-file", { userId: 7, documentId: 1, versionId: 2, fileId: 4 });
    expect(readFileClaims(verifyOfficeToken(secret, "oo-file", token))).toEqual({ userId: 7, documentId: 1, versionId: 2, fileId: 4 });
    expect(() => verifyOfficeToken(secret, "oo-callback", token)).toThrow(AppError);
  });
});

describe("resolveSavedFileUrl", () => {
  const allowed = { publicBase: "http://localhost:8080", internalBase: "http://onlyoffice" };

  it("accepts the public and internal document servers", () => {
    expect(resolveSavedFileUrl("http://localhost:8080/cache/files/out.docx", allowed).origin).toBe("http://localhost:8080");
    expect(resolveSavedFileUrl("http://onlyoffice/cache/files/out.docx", allowed).origin).toBe("http://onlyoffice");
  });

  it("rewrites the document server's own loopback address onto the internal host", () => {
    const url = resolveSavedFileUrl("http://127.0.0.1/cache/files/out.docx?md5=abc", allowed);
    expect(url.origin).toBe("http://onlyoffice");
    expect(url.pathname).toBe("/cache/files/out.docx");
    expect(url.search).toBe("?md5=abc");
  });

  it("refuses a URL that is not the document server", () => {
    expect(() => resolveSavedFileUrl("http://169.254.169.254/latest/meta-data", allowed)).toThrow(/outside the document server/);
    expect(() => resolveSavedFileUrl("file:///etc/passwd", allowed)).toThrow(AppError);
    expect(() => resolveSavedFileUrl("http://user:pass@onlyoffice/cache", allowed)).toThrow(/credentials/);
  });
});
