import { Router, type Request, type Response } from "express";
import multer from "multer";
import { createReadStream, existsSync } from "node:fs";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { validate } from "../../middleware/validate.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import type { TenantDb } from "../../lib/tenantScope.js";
import { db as ownerDb, pool } from "../../db/index.js";
import { documentFiles } from "../../drizzle/schema/documents.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { REVIEWER_ROLES } from "../../middleware/requirePermission.js";
import { controlledVersions } from "../../drizzle/schema/versioning.js";
import { recordAuditTrailStandalone } from "../audit-trail/audit-trail.service.js";
import * as engine from "../versioning/versioning.service.js";
import type { Actor } from "../versioning/versioning.service.js";
import { registerVersionRoutes, saveDraftSchema } from "../versioning/versioning.routes.js";
import { decisionSchema, requestReviewSchema } from "./documents.validation.js";
import { documentsLinkedTo, documentAdapter, addAttachment, DOCUMENT_ENTITY_TYPE, FILE_LINK_SECONDS, isInsideTenantStorage, MAX_FILE_BYTES, removeAttachment, searchTargets, signFileToken, verifyFileToken } from "./documentVersioning.js";
import { LINK_TYPES, LINK_TYPE_LABEL, normalizeDocumentPayload, type LinkType } from "./documentPayload.js";

const idParam = (req: Request, name = "id") => {
  const id = Number(req.params[name]);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest(`Invalid ${name}`);
  return id;
};
const actorOf = (req: Request): Actor => ({ id: req.user!.id, roleName: req.user!.roleName });
const dbOf = (req: Request) => req.db as TenantDb;
const linkType = (raw: unknown): LinkType => {
  if (typeof raw !== "string" || !LINK_TYPES.includes(raw as LinkType)) throw AppError.badRequest(`type must be one of: ${LINK_TYPES.join(", ")}`);
  return raw as LinkType;
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } });

/**
 * Everything version-related for controlled documents, added to the documents router (which already applies
 * requireAuth + withTenantDb + the Document Control department gate). The lifecycle rules themselves live once, in the
 * shared engine; this file is the HTTP shape: the engine's standard endpoints, the URL shapes the document-versioning
 * specification names as aliases onto the same functions, attachments, and the link tools.
 */
export function registerDocumentVersionRoutes(router: Router) {
  const view = requirePermission("document.view");
  const edit = requirePermission("document.edit");
  const review = requirePermission("document.review");
  const publish = requirePermission("document.publish");

  // Fixed paths first: "/linked" and "/link-targets" must not be read as an :id.
  router.get(
    "/link-targets",
    view,
    asyncHandler(async (req: Request, res: Response) => {
      const type = linkType(req.query.type);
      res.json(await searchTargets(dbOf(req), type, typeof req.query.q === "string" ? req.query.q : ""));
    }),
  );

  // Who can be asked to review: the active people in this organization whose role allows reviewing. Editors can't list
  // users in general (that's an admin screen), but they do need to name a reviewer.
  router.get(
    "/reviewers",
    view,
    asyncHandler(async (req: Request, res: Response) => {
      const rows = await dbOf(req)
        .select({ id: users.id, name: users.name, email: users.email, role: roles.name })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(and(eq(users.isActive, true), inArray(roles.name, [...REVIEWER_ROLES])))
        .orderBy(asc(users.name), asc(users.email));
      res.json(rows.filter((r) => r.id !== req.user!.id));
    }),
  );

  // Which released documents link to this record — for showing "documents" on an equipment / supplier / NCR page.
  router.get(
    "/linked",
    view,
    asyncHandler(async (req: Request, res: Response) => {
      const type = linkType(req.query.type);
      const id = Number(req.query.id);
      if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("id must be a record id");
      res.json(await documentsLinkedTo(dbOf(req), type, id));
    }),
  );

  // The engine's standard endpoints: /:id/current, /:id/versions, /:id/versions/:versionId (GET, PUT, DELETE),
  // /:id/version/:versionId/diff, /:id/draft, /:id/validate, /:id/review, /:id/publish, /:id/rollback.
  registerVersionRoutes(router, { adapter: documentAdapter, permission: "document" });

  // ---- The specification's URL shapes, as aliases onto the same engine functions ------------------------------------

  router.get(
    "/:id/version/:versionId",
    view,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await engine.getVersion(dbOf(req), documentAdapter, idParam(req), idParam(req, "versionId")));
    }),
  );

  router.patch(
    "/:id/draft/:versionId",
    edit,
    validate(saveDraftSchema),
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await engine.saveDraft(dbOf(req), documentAdapter, req.tenantId!, idParam(req), idParam(req, "versionId"), actorOf(req), req.body as z.infer<typeof saveDraftSchema>));
    }),
  );

  router.post(
    "/:id/draft/:versionId/review",
    edit,
    validate(requestReviewSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const body = req.body as z.infer<typeof requestReviewSchema>;
      res.json(await engine.submitForReview(dbOf(req), documentAdapter, req.tenantId!, idParam(req), idParam(req, "versionId"), actorOf(req), body.notes, { reviewerId: body.reviewerId }));
    }),
  );

  for (const decision of ["approve", "reject"] as const) {
    router.post(
      `/:id/version/:versionId/review/${decision}`,
      review,
      validate(decisionSchema),
      asyncHandler(async (req: Request, res: Response) => {
        res.json(await engine.reviewVersion(dbOf(req), documentAdapter, req.tenantId!, idParam(req), idParam(req, "versionId"), actorOf(req), decision === "approve" ? "approved" : "rejected", (req.body as z.infer<typeof decisionSchema>).notes));
      }),
    );
  }

  router.post(
    "/:id/version/:versionId/publish",
    publish,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await engine.publishVersion(dbOf(req), documentAdapter, req.tenantId!, idParam(req), idParam(req, "versionId"), actorOf(req)));
    }),
  );

  // "Select a previous version": the version in the URL is the one whose content is restored, as a new draft.
  router.post(
    "/:id/version/:versionId/rollback",
    edit,
    asyncHandler(async (req: Request, res: Response) => {
      const target = await engine.getVersion(dbOf(req), documentAdapter, idParam(req), idParam(req, "versionId"));
      res.status(201).json(await engine.rollbackTo(dbOf(req), documentAdapter, req.tenantId!, idParam(req), target.versionNumber, actorOf(req)));
    }),
  );

  // ---- Attachments ----------------------------------------------------------------------------------------------------

  router.post(
    "/:id/version/:versionId/attachments",
    edit,
    upload.single("file"),
    asyncHandler(async (req: Request, res: Response) => {
      if (!req.file) throw AppError.badRequest("No file uploaded");
      res.status(201).json(await addAttachment(dbOf(req), req.tenantId!, idParam(req), idParam(req, "versionId"), actorOf(req), req.file));
    }),
  );

  router.delete(
    "/:id/version/:versionId/attachments/:attachmentId",
    edit,
    asyncHandler(async (req: Request, res: Response) => {
      await removeAttachment(dbOf(req), req.tenantId!, idParam(req), idParam(req, "versionId"), idParam(req, "attachmentId"), actorOf(req));
      res.status(204).send();
    }),
  );

  // A short-lived, signed link to one file of one revision. It can go straight into a link, an <img> or an <iframe>.
  router.get(
    "/:id/version/:versionId/attachments/:attachmentId/url",
    view,
    asyncHandler(async (req: Request, res: Response) => {
      const v = await engine.getVersion(dbOf(req), documentAdapter, idParam(req), idParam(req, "versionId"));
      const file = normalizeDocumentPayload(v.payload).attachments.find((a) => a.id === idParam(req, "attachmentId"));
      if (!file) throw AppError.notFound("Attachment");
      res.json({ url: `/documents/files/download?token=${encodeURIComponent(signFileToken(req.tenantId!, file.id, req.user!.id))}`, expiresInSeconds: FILE_LINK_SECONDS, fileName: file.fileName, mimeType: file.mimeType });
    }),
  );

  // ---- Link history: every record this document has ever pointed at, and in which revisions ---------------------------

  router.get(
    "/:id/link-history",
    view,
    asyncHandler(async (req: Request, res: Response) => {
      const id = idParam(req);
      await engine.ensureBootstrapped(dbOf(req), documentAdapter, req.tenantId!, id);
      const rows = await dbOf(req)
        .select({ n: controlledVersions.versionNumber, status: controlledVersions.status, payload: controlledVersions.payload })
        .from(controlledVersions)
        .where(and(eq(controlledVersions.subjectType, "document"), eq(controlledVersions.subjectId, id)))
        .orderBy(asc(controlledVersions.versionNumber));
      const history = new Map<string, { type: LinkType; id: number; label: string; typeLabel: string; firstVersion: number; lastVersion: number; inForce: boolean; versions: number[] }>();
      let newest = 0;
      for (const r of rows) {
        newest = Math.max(newest, r.n);
        for (const l of normalizeDocumentPayload(r.payload).links) {
          const key = `${l.type}:${l.id}`;
          const cur = history.get(key);
          if (cur) {
            cur.lastVersion = r.n;
            cur.label = l.label;
            cur.versions.push(r.n);
            if (r.status === "published") cur.inForce = true;
          } else history.set(key, { type: l.type, id: l.id, label: l.label, typeLabel: LINK_TYPE_LABEL[l.type], firstVersion: r.n, lastVersion: r.n, inForce: r.status === "published", versions: [r.n] });
        }
      }
      res.json({ newestVersion: newest, links: [...history.values()] });
    }),
  );
}

/**
 * Serves a file from a signed link. Deliberately outside the authenticated documents router: the link IS the
 * credential (a browser cannot attach a bearer header to an <img>/<iframe>/download), so it is short-lived, names one
 * file in one organization, and every use is audited with who the link was issued to.
 */
export const documentFilesRouter = Router();
documentFilesRouter.get(
  "/download",
  asyncHandler(async (req: Request, res: Response) => {
    const t = verifyFileToken(String(req.query.token ?? ""));
    const [file] = await ownerDb.select().from(documentFiles).where(and(eq(documentFiles.id, t.fileId)));
    if (!file || !isInsideTenantStorage(t.tenantId, file.filePath) || !existsSync(file.filePath)) throw AppError.notFound("File");

    await recordAuditTrailStandalone(pool, { entityType: DOCUMENT_ENTITY_TYPE, entityId: file.documentId, action: "update", changes: { event: "file_downloaded", fileId: file.id, fileName: file.fileName }, performedBy: t.userId });

    const inline = file.mimeType === "application/pdf" || file.mimeType.startsWith("image/");
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", String(file.sizeBytes));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    createReadStream(file.filePath).pipe(res);
  }),
);
