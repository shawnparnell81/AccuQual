import { validationReports } from "../../drizzle/schema/validationReport.js";
import { crudFactory } from "../../utils/crudFactory.js";

export const baseHandlers = crudFactory(validationReports, { entityName: "Validation Report", idColumn: "id" });
