import { isoQualityForms } from "../../drizzle/schema/isoQualityForms.js";
import { crudFactory } from "../../utils/crudFactory.js";

export const baseHandlers = crudFactory(isoQualityForms, { entityName: "ISO form", idColumn: "id" });
