import { isoQualityForms } from "../../drizzle/schema/isoQualityForms.js";
import { snapshotIsoFormNumber } from "../document-folders/formRecordFiling.js";
import { answersWithTemplateStamp } from "../forms/templateRevision.js";
import { crudFactory } from "../../utils/crudFactory.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export const baseHandlers = crudFactory(isoQualityForms, {
  entityName: "ISO form",
  idColumn: "id",
  prepareCreate: (body) => ({
    ...body,
    data: answersWithTemplateStamp(`iso:${String(body.formType ?? "")}`, undefined, asRecord(body.data), true),
  }),
  mergeUpdate: (existing, patch) => {
    if (!patch.data || typeof patch.data !== "object" || Array.isArray(patch.data)) return patch;
    return {
      ...patch,
      data: answersWithTemplateStamp(`iso:${String(existing.formType ?? "")}`, existing.data, patch.data as Record<string, unknown>, false),
    };
  },
  afterCreate: async (created, req) => {
    if (!req.db) return;
    await snapshotIsoFormNumber(req.db, created);
  },
});
