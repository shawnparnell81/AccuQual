import { ppapPackages } from "../../drizzle/schema/ppap.js";
import { crudFactory } from "../../utils/crudFactory.js";

export const baseHandlers = crudFactory(ppapPackages, { entityName: "PPAP package", idColumn: "id" });
