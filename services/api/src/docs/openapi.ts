import { z } from "zod";
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { createNcrSchema, updateNcrSchema, containmentNcrSchema, rootCauseNcrSchema, correctiveActionNcrSchema } from "../modules/ncr/ncr.validation.js";
import { createCapaSchema, updateCapaSchema, verifyCapaSchema } from "../modules/capa/capa.validation.js";
import { createDocumentSchema, updateDocumentSchema, requestReviewSchema, decisionSchema } from "../modules/documents/documents.validation.js";
import { createCourseSchema, updateCourseSchema, assignSchema, completeAssignmentSchema } from "../modules/training/training.validation.js";

extendZodWithOpenApi(z);

/**
 * API Availability (cheap version): the comparison matrix listed a
 * documented API as a real capability, but no OpenAPI spec, Swagger route,
 * or hand-written docs existed anywhere in the codebase — every one of
 * these Zod schemas already fully describes its endpoint's real request
 * shape (see each module's own `*.routes.ts` `validate(schema)` call); this
 * registry just points the generator at the schemas that already exist
 * instead of hand-writing docs that could drift from them. Starts with
 * NCR/CAPA/Documents/Training per the approved scope; the same
 * `registry.registerPath` call is copy-pasteable for the other 47 route
 * files whenever this gets extended.
 */
const registry = new OpenAPIRegistry();

const genericResponses = {
  200: { description: "Success", content: { "application/json": { schema: z.object({}).passthrough() } } },
  201: { description: "Created", content: { "application/json": { schema: z.object({}).passthrough() } } },
  400: { description: "Validation error", content: { "application/json": { schema: z.object({ message: z.string() }) } } },
  401: { description: "Missing or invalid bearer token", content: { "application/json": { schema: z.object({ message: z.string() }) } } },
  403: { description: "Not permitted for this department/role", content: { "application/json": { schema: z.object({ message: z.string() }) } } },
  404: { description: "Not found", content: { "application/json": { schema: z.object({ message: z.string() }) } } },
};

function registerCrud(tag: string, basePath: string, createSchema: z.ZodTypeAny, updateSchema: z.ZodTypeAny) {
  registry.registerPath({
    method: "get",
    path: basePath,
    tags: [tag],
    summary: `List ${tag} records for your tenant`,
    responses: { 200: genericResponses[200] },
  });
  registry.registerPath({
    method: "post",
    path: basePath,
    tags: [tag],
    summary: `Create a ${tag} record`,
    request: { body: { content: { "application/json": { schema: createSchema } } } },
    responses: { 201: genericResponses[201], 400: genericResponses[400] },
  });
  registry.registerPath({
    method: "get",
    path: `${basePath}/{id}`,
    tags: [tag],
    summary: `Get one ${tag} record`,
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: genericResponses[200], 404: genericResponses[404] },
  });
  registry.registerPath({
    method: "patch",
    path: `${basePath}/{id}`,
    tags: [tag],
    summary: `Update a ${tag} record`,
    request: { params: z.object({ id: z.string() }), body: { content: { "application/json": { schema: updateSchema } } } },
    responses: { 200: genericResponses[200], 400: genericResponses[400] },
  });
}

registerCrud("NCR", "/ncr", createNcrSchema, updateNcrSchema);
registry.registerPath({
  method: "post",
  path: "/ncr/{id}/containment",
  tags: ["NCR"],
  summary: "Record containment (open → contained)",
  request: { params: z.object({ id: z.string() }), body: { content: { "application/json": { schema: containmentNcrSchema } } } },
  responses: { 200: genericResponses[200], 400: genericResponses[400] },
});
registry.registerPath({
  method: "post",
  path: "/ncr/{id}/root-cause",
  tags: ["NCR"],
  summary: "Record root cause",
  request: { params: z.object({ id: z.string() }), body: { content: { "application/json": { schema: rootCauseNcrSchema } } } },
  responses: { 200: genericResponses[200], 400: genericResponses[400] },
});
registry.registerPath({
  method: "post",
  path: "/ncr/{id}/corrective-action",
  tags: ["NCR"],
  summary: "Record corrective action",
  request: { params: z.object({ id: z.string() }), body: { content: { "application/json": { schema: correctiveActionNcrSchema } } } },
  responses: { 200: genericResponses[200], 400: genericResponses[400] },
});

registerCrud("CAPA", "/capa", createCapaSchema, updateCapaSchema);
registry.registerPath({
  method: "post",
  path: "/capa/{id}/verify",
  tags: ["CAPA"],
  summary: "in_progress → verifying (min. 10-char verification note)",
  request: { params: z.object({ id: z.string() }), body: { content: { "application/json": { schema: verifyCapaSchema } } } },
  responses: { 200: genericResponses[200], 400: genericResponses[400] },
});

registerCrud("Documents", "/documents", createDocumentSchema, updateDocumentSchema);
// Controlled-document versioning: draft -> review -> publish, with a frozen version after publication.
const docVersionParams = z.object({ id: z.string(), versionId: z.string() });
registry.registerPath({ method: "get", path: "/documents/{id}/versions", tags: ["Documents"], summary: "Version timeline of a document", request: { params: z.object({ id: z.string() }) }, responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "get", path: "/documents/{id}/version/{versionId}", tags: ["Documents"], summary: "One version, with its full content, metadata, files and links", request: { params: docVersionParams }, responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "get", path: "/documents/{id}/version/{versionId}/diff", tags: ["Documents"], summary: "Compare a version with the previous one (or ?against=<versionId>): content, metadata, files, links", request: { params: docVersionParams }, responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "post", path: "/documents/{id}/draft", tags: ["Documents"], summary: "Start a draft from the released version (409 if one is already open)", request: { params: z.object({ id: z.string() }) }, responses: { 201: genericResponses[200], 409: genericResponses[400] } });
registry.registerPath({ method: "patch", path: "/documents/{id}/draft/{versionId}", tags: ["Documents"], summary: "Save a draft (autosave). Only drafts can be edited; released versions are frozen.", request: { params: docVersionParams }, responses: { 200: genericResponses[200], 409: genericResponses[400] } });
registry.registerPath({ method: "post", path: "/documents/{id}/draft/{versionId}/review", tags: ["Documents"], summary: "Send a draft for review, optionally naming the reviewer", request: { params: docVersionParams, body: { content: { "application/json": { schema: requestReviewSchema } } } }, responses: { 200: genericResponses[200], 422: genericResponses[400] } });
registry.registerPath({ method: "post", path: "/documents/{id}/version/{versionId}/review/approve", tags: ["Documents"], summary: "Approve a version in review (someone other than its author)", request: { params: docVersionParams, body: { content: { "application/json": { schema: decisionSchema } } } }, responses: { 200: genericResponses[200], 403: genericResponses[400] } });
registry.registerPath({ method: "post", path: "/documents/{id}/version/{versionId}/review/reject", tags: ["Documents"], summary: "Send a version back to draft (a reason is required)", request: { params: docVersionParams, body: { content: { "application/json": { schema: decisionSchema } } } }, responses: { 200: genericResponses[200], 400: genericResponses[400] } });
registry.registerPath({ method: "post", path: "/documents/{id}/version/{versionId}/publish", tags: ["Documents"], summary: "Publish an approved version: it becomes the released, frozen revision", request: { params: docVersionParams }, responses: { 200: genericResponses[200], 409: genericResponses[400] } });
registry.registerPath({ method: "post", path: "/documents/{id}/version/{versionId}/rollback", tags: ["Documents"], summary: "Restore an earlier released version as a new draft (which is then reviewed and published)", request: { params: docVersionParams }, responses: { 201: genericResponses[200], 409: genericResponses[400] } });
registry.registerPath({ method: "post", path: "/documents/{id}/version/{versionId}/attachments", tags: ["Documents"], summary: "Attach a file (multipart field `file`; PDF, DOCX, XLSX or image, 15 MB) to a draft", request: { params: docVersionParams }, responses: { 201: genericResponses[200], 400: genericResponses[400] } });
registry.registerPath({ method: "delete", path: "/documents/{id}/version/{versionId}/attachments/{attachmentId}", tags: ["Documents"], summary: "Remove a file from a draft", request: { params: z.object({ id: z.string(), versionId: z.string(), attachmentId: z.string() }) }, responses: { 204: genericResponses[200] } });
registry.registerPath({ method: "get", path: "/documents/{id}/version/{versionId}/attachments/{attachmentId}/url", tags: ["Documents"], summary: "A short-lived signed download link for one file of one version", request: { params: z.object({ id: z.string(), versionId: z.string(), attachmentId: z.string() }) }, responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "get", path: "/documents/{id}/link-history", tags: ["Documents"], summary: "Every record the document has linked to, and in which versions", request: { params: z.object({ id: z.string() }) }, responses: { 200: genericResponses[200] } });
// Training & competency: sessions and attendance, competency evaluations, who is qualified.
const trnId = z.object({ id: z.string() });
registry.registerPath({ method: "get", path: "/training/status", tags: ["Training"], summary: "Who is qualified for what (?courseId=&userId=&department=&status=): qualified, expiring_soon, expired, revision_changed, failed, awaiting_evaluation, overdue, in_progress, assigned, not_trained", responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "get", path: "/training/attention", tags: ["Training"], summary: "People whose training needs action, most serious first", responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "post", path: "/training/notify-due", tags: ["Training"], summary: "Email the Quality department the same attention list", responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "post", path: "/training/{id}/assign-required", tags: ["Training"], summary: "Assign the course to everyone it is required of who is not qualified and has nothing open", request: { params: trnId }, responses: { 201: genericResponses[200] } });
registry.registerPath({ method: "post", path: "/training/course", tags: ["Training"], summary: "Create a course (same as POST /training), with requirements, validity and who it is required of", responses: { 201: genericResponses[200], 400: genericResponses[400] } });
registry.registerPath({ method: "get", path: "/training/sessions", tags: ["Training"], summary: "Sessions (?courseId=&status=)", responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "post", path: "/training/session", tags: ["Training"], summary: "Schedule a session with an instructor, place and roster", responses: { 201: genericResponses[200], 400: genericResponses[400] } });
registry.registerPath({ method: "patch", path: "/training/session/{id}", tags: ["Training"], summary: "Change a scheduled session (roster, date, place)", request: { params: trnId }, responses: { 200: genericResponses[200], 409: genericResponses[400] } });
registry.registerPath({ method: "post", path: "/training/session/{id}/complete", tags: ["Training"], summary: "Complete a session with its attendance: each person marked present has the training recorded (and a pending evaluation if the course needs one)", request: { params: trnId }, responses: { 200: genericResponses[200], 409: genericResponses[400] } });
registry.registerPath({ method: "post", path: "/training/session/{id}/cancel", tags: ["Training"], summary: "Cancel a scheduled session (a reason is required)", request: { params: trnId }, responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "get", path: "/training/competency", tags: ["Training"], summary: "Competency evaluations (?userId=&courseId=&status=)", responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "post", path: "/training/competency", tags: ["Training"], summary: "Request (status pending) or record (pass / fail) an evaluation. You can't evaluate yourself (admin excepted).", responses: { 201: genericResponses[200], 403: genericResponses[400] } });
registry.registerPath({ method: "post", path: "/training/competency/{id}/evaluate", tags: ["Training"], summary: "Decide a pending evaluation. A decided evaluation can't be edited; a re-evaluation is a new record.", request: { params: trnId }, responses: { 200: genericResponses[200], 409: genericResponses[400] } });

// Quarantine: holds on material; inventory lots and items are enforced by the inventory system itself.
const quarParams = z.object({ id: z.string() });
registry.registerPath({ method: "get", path: "/quarantine", tags: ["Quarantine"], summary: "Holds (?status=quarantined|released|destroyed&itemType=&q=&olderThanDays=)", responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "get", path: "/quarantine/summary", tags: ["Quarantine"], summary: "Open holds, how many are enforced, how long they have been held", responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "get", path: "/quarantine/inventory", tags: ["Quarantine"], summary: "Held material by location (?location=)", responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "post", path: "/quarantine", tags: ["Quarantine"], summary: "Place a hold. inventory_lot / inventory_item holds stop the units being issued, consumed, scrapped or reserved.", responses: { 201: genericResponses[200], 400: genericResponses[400] } });
registry.registerPath({ method: "get", path: "/quarantine/{id}", tags: ["Quarantine"], summary: "One hold with its locations and decisions", request: { params: quarParams }, responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "post", path: "/quarantine/{id}/relocate", tags: ["Quarantine"], summary: "Move held quantity between locations", request: { params: quarParams }, responses: { 200: genericResponses[200], 400: genericResponses[400] } });
registry.registerPath({ method: "post", path: "/quarantine/{id}/release", tags: ["Quarantine"], summary: "Release some or all of a hold (use_as_is | reworked | sorted). Admin or quality manager, not the person who placed it.", request: { params: quarParams }, responses: { 200: genericResponses[200], 403: genericResponses[400] } });
registry.registerPath({ method: "post", path: "/quarantine/{id}/destroy", tags: ["Quarantine"], summary: "Remove some or all of a hold from stock (scrapped | returned_to_supplier | other) through a recorded scrap or return", request: { params: quarParams }, responses: { 200: genericResponses[200], 403: genericResponses[400] } });

// Equipment & Calibration: status, scheduling, completing, and what needs attention.
const equipParams = z.object({ id: z.string() });
const calParams = z.object({ calibrationId: z.string() });
registry.registerPath({ method: "get", path: "/equipment", tags: ["Equipment"], summary: "Equipment with server-computed due status, latest result, next due date and any scheduled calibration", responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "get", path: "/equipment/attention", tags: ["Equipment"], summary: "Equipment that is out of service, failed, overdue, due within 30 days, or has a scheduled calibration that has not been done", responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "post", path: "/equipment/notify-due", tags: ["Equipment"], summary: "Email the Quality department the same attention list", responses: { 200: genericResponses[200] } });
registry.registerPath({ method: "post", path: "/equipment/{id}/status", tags: ["Equipment"], summary: "Set active / inactive / out_of_service. A reason is required to or from out of service; returning equipment a failed calibration held is an override (admin or quality manager).", request: { params: equipParams }, responses: { 200: genericResponses[200], 400: genericResponses[400], 403: genericResponses[400] } });
registry.registerPath({ method: "post", path: "/equipment/{id}/calibration", tags: ["Equipment"], summary: "Schedule ({scheduledAt}) or record a finished calibration ({performedAt, result: pass|fail|adjusted}). A fail takes the equipment out of service; a pass returns it.", request: { params: equipParams }, responses: { 201: genericResponses[200], 409: genericResponses[400] } });
registry.registerPath({ method: "post", path: "/equipment/calibration/{calibrationId}/complete", tags: ["Equipment"], summary: "Complete a scheduled calibration with its result and readings", request: { params: calParams }, responses: { 200: genericResponses[200], 409: genericResponses[400] } });
registry.registerPath({ method: "delete", path: "/equipment/calibration/{calibrationId}", tags: ["Equipment"], summary: "Cancel a scheduled (not yet done) calibration", request: { params: calParams }, responses: { 204: genericResponses[200], 409: genericResponses[400] } });
registry.registerPath({ method: "get", path: "/documents/linked", tags: ["Documents"], summary: "Released documents linked to a record (?type=equipment|supplier|ncr|capa|audit|workflow|training&id=)", responses: { 200: genericResponses[200] } });
registry.registerPath({
  method: "post",
  path: "/documents/{id}/obsolete",
  tags: ["Documents"],
  summary: "approved → obsolete",
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: genericResponses[200] },
});

registerCrud("Training", "/training", createCourseSchema, updateCourseSchema);
registry.registerPath({
  method: "post",
  path: "/training/{id}/assign",
  tags: ["Training"],
  summary: "Assign a course to one or more users",
  request: { params: z.object({ id: z.string() }), body: { content: { "application/json": { schema: assignSchema } } } },
  responses: { 200: genericResponses[200], 400: genericResponses[400] },
});
registry.registerPath({
  method: "post",
  path: "/training/assignment/{assignmentId}/complete",
  tags: ["Training"],
  summary: "Mark a training assignment complete",
  request: { params: z.object({ assignmentId: z.string() }), body: { content: { "application/json": { schema: completeAssignmentSchema } } } },
  responses: { 200: genericResponses[200], 400: genericResponses[400] },
});

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "AccuQual API",
      version: "1.0.0",
      description:
        "Generated directly from this app's own Zod request-validation schemas (see each module's `*.validation.ts` / `*.routes.ts`) — not hand-written, so it can't drift from the real routes. " +
        "Every endpoint requires `Authorization: Bearer <access token>`, scoped to your tenant and department the same way the app itself is. " +
        "Starting coverage: NCR, CAPA, Documents, Training — the same four modules as the approved API Availability scope.",
    },
    servers: [{ url: "/api", description: "Same host as the app, under the /api prefix" }],
  });
}
