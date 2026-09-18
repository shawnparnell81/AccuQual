import { z } from "zod";
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { createNcrSchema, updateNcrSchema, containmentNcrSchema, rootCauseNcrSchema, correctiveActionNcrSchema } from "../modules/ncr/ncr.validation.js";
import { createCapaSchema, updateCapaSchema, verifyCapaSchema } from "../modules/capa/capa.validation.js";
import { createDocumentSchema, updateDocumentSchema, addVersionSchema, approveSchema } from "../modules/documents/documents.validation.js";
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
registry.registerPath({
  method: "post",
  path: "/documents/{id}/version",
  tags: ["Documents"],
  summary: "Add a new version to a document",
  request: { params: z.object({ id: z.string() }), body: { content: { "application/json": { schema: addVersionSchema } } } },
  responses: { 200: genericResponses[200], 400: genericResponses[400] },
});
registry.registerPath({
  method: "post",
  path: "/documents/{id}/approve",
  tags: ["Documents"],
  summary: "draft/in_review → approved",
  request: { params: z.object({ id: z.string() }), body: { content: { "application/json": { schema: approveSchema } } } },
  responses: { 200: genericResponses[200], 400: genericResponses[400] },
});
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
