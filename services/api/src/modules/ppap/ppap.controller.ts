import { ppapPackages } from "../../drizzle/schema/ppap.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { PPAP_NUMBER } from "../records/recordNumberSpecs.js";

export const baseHandlers = crudFactory(ppapPackages, { entityName: "PPAP package", idColumn: "id", recordNumber: PPAP_NUMBER });
