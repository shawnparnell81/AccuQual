import { Router, type Request, type Response } from "express";
import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import { requireAuth } from "../../middleware/auth.js";
import { withDb, type Db } from "../../lib/requestDb.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { db } from "../../db/index.js";
import { MAX_FILE_BYTES } from "../documents/documentVersioning.js";
import { assertOfficeAccess, authorizeOfficeFile, ensureExclusiveDraftFile, loadOfficeActor, persistEditedOfficeFile } from "./access.js";
import { buildEditorConfig, editorDocumentKey } from "./editorConfig.js";
import { downloadSavedFile } from "./download.js";
import { onlyOfficeSettings } from "./settings.js";
import { bearerToken, readCallbackClaims, readFileClaims, signOfficeToken, verifyDocumentServerPayload, verifyOfficeToken } from "./token.js";

function requireSettings() {
  const settings = onlyOfficeSettings();
  if (!settings) throw new AppError("Office editing is not configured on this server.", 503);
  return settings;
}

function idQuery(req: Request, name: string): number {
  const n = Number(req.query[name]);
  if (!Number.isInteger(n) || n < 1) throw AppError.badRequest(`Invalid ${name}`);
  return n;
}

/**
 * Opens the editor for one file on one revision. The browser gets a signed DocsAPI config.
 * Whether that config can edit is decided only by authorizeOfficeFile.
 */
export const onlyOfficeRouter = Router();
onlyOfficeRouter.use(requireAuth, withDb, requireDepartmentAccess("documents"));

onlyOfficeRouter.get(
  "/session",
  asyncHandler(async (req: Request, res: Response) => {
    const settings = requireSettings();
    const ids = { documentId: idQuery(req, "documentId"), versionId: idQuery(req, "versionId"), fileId: idQuery(req, "fileId") };
    const actor = await loadOfficeActor(req.db as Db, req.user!.id);
    if (!actor) throw AppError.unauthorized("Session is no longer valid");
    const access = await authorizeOfficeFile(req.db as Db, actor, ids);
    assertOfficeAccess(access);
    const file = access.mode === "edit" ? await ensureExclusiveDraftFile(req.db as Db, actor, ids, access.file) : access.file;
    const key = editorDocumentKey(file.fileId, file.sha256);
    const claims = { userId: actor.id, documentId: ids.documentId, versionId: ids.versionId, fileId: file.fileId };
    const fileToken = signOfficeToken(settings.jwtSecret, "oo-file", claims);
    const callbackToken = signOfficeToken(settings.jwtSecret, "oo-callback", { ...claims, key });
    const config = buildEditorConfig(
      {
        fileId: file.fileId,
        fileName: file.fileName,
        sha256: file.sha256,
        mode: access.mode,
        user: { id: actor.id, name: actor.name },
        fileUrl: `${settings.apiBaseUrl}/onlyoffice/file?token=${encodeURIComponent(fileToken)}`,
        callbackUrl: `${settings.apiBaseUrl}/onlyoffice/callback?token=${encodeURIComponent(callbackToken)}`,
      },
      settings.jwtSecret,
    );
    res.json({ documentServerUrl: settings.publicUrl, mode: access.mode, fileId: file.fileId, config });
  }),
);

/**
 * Document Server calls these with the signed token from the session, not a user session.
 * Same shape as the signed document-file download: the link is the credential.
 */
export const onlyOfficePublicRouter = Router();

onlyOfficePublicRouter.get(
  "/file",
  asyncHandler(async (req: Request, res: Response) => {
    const settings = requireSettings();
    const claims = readFileClaims(verifyOfficeToken(settings.jwtSecret, "oo-file", String(req.query.token ?? "")));
    const actor = await loadOfficeActor(db, claims.userId);
    if (!actor) throw AppError.notFound("File");
    const access = await authorizeOfficeFile(db, actor, claims);
    if (!access.ok) throw AppError.notFound("File");

    res.setHeader("Content-Type", access.file.mimeType);
    res.setHeader("Content-Length", String(access.file.sizeBytes));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(access.file.fileName)}`);
    createReadStream(access.file.filePath).pipe(res);
  }),
);

onlyOfficePublicRouter.post(
  "/callback",
  asyncHandler(async (req: Request, res: Response) => {
    const settings = requireSettings();
    const claims = readCallbackClaims(verifyOfficeToken(settings.jwtSecret, "oo-callback", String(req.query.token ?? "")));
    const body = req.body as { token?: unknown } | undefined;
    const presented = bearerToken(req.headers.authorization) ?? (typeof body?.token === "string" ? body.token : null);
    if (!presented) return res.json({ error: 1 });
    const command = verifyDocumentServerPayload(settings.jwtSecret, presented);
    const status = Number(command.status);
    // 1 = still editing, 4 = closed with no changes. 2 = save, 6 = forcesave.
    if (status !== 2 && status !== 6) return res.json({ error: 0 });
    if (command.key !== claims.key || typeof command.url !== "string" || !command.url) return res.json({ error: 1 });

    try {
      const actor = await loadOfficeActor(db, claims.userId);
      if (!actor) return res.json({ error: 1 });
      const bytes = await downloadSavedFile(command.url, { publicBase: settings.publicUrl, internalBase: settings.internalUrl }, MAX_FILE_BYTES);
      const saved = await db.transaction(async (tx) => persistEditedOfficeFile(tx as unknown as Db, actor, claims, bytes));
      if (saved.oldPath !== saved.newPath) await unlink(saved.oldPath).catch(() => undefined);
      logger.info("Office file saved", { documentId: claims.documentId, fileId: claims.fileId, status });
      res.json({ error: 0 });
    } catch (err) {
      logger.warn("Office file save failed", { documentId: claims.documentId, fileId: claims.fileId, status, message: err instanceof Error ? err.message : "unknown" });
      res.json({ error: 1 });
    }
  }),
);
