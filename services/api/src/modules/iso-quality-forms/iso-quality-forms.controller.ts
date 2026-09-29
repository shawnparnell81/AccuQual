import { isoQualityForms } from "../../drizzle/schema/isoQualityForms.js";
import { snapshotIsoFormNumber } from "../document-folders/formRecordFiling.js";
import { crudFactory } from "../../utils/crudFactory.js";

export const baseHandlers = crudFactory(isoQualityForms, {
  entityName: "ISO form",
  idColumn: "id",
  afterCreate: async (created, req) => {
    if (!req.db) return;
    await snapshotIsoFormNumber(req.db, created);
  },
});
