import { validationReports } from "../../drizzle/schema/validationReport.js";
import { answersWithTemplateStamp } from "../forms/templateRevision.js";
import { crudFactory } from "../../utils/crudFactory.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A save cannot switch a CSA sheet onto the fuel pump template, or the other way around. */
function validationKind(data: unknown): "csa" | "fuel_pump" {
  return data && typeof data === "object" && (data as { formType?: string }).formType === "fuel_pump" ? "fuel_pump" : "csa";
}

export const baseHandlers = crudFactory(validationReports, {
  entityName: "Validation Report",
  idColumn: "id",
  prepareCreate: (body) => {
    const incoming = asRecord(body.data);
    const kind = validationKind(incoming);
    return { ...body, data: answersWithTemplateStamp(`validation:${kind}`, undefined, { ...incoming, formType: kind }, true) };
  },
  mergeUpdate: (existing, patch) => {
    if (!patch.data || typeof patch.data !== "object" || Array.isArray(patch.data)) return patch;
    const previous = asRecord(existing.data);
    const kind = validationKind(previous);
    return {
      ...patch,
      data: answersWithTemplateStamp(`validation:${kind}`, previous, { ...(patch.data as Record<string, unknown>), formType: kind }, false),
    };
  },
});
