import { eq } from "drizzle-orm";
import { builtForms } from "../../drizzle/schema/builtForms.js";
import type { Db } from "../../lib/requestDb.js";
import { AppError } from "../../utils/appError.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import { canFillBuiltForm } from "../form-builder/access.js";
import { formBuilderAccess } from "../form-builder/service.js";
import { engineeringAccess } from "../quality-engineering-report/livePull.js";
import { getFormImportTemplate, type FormImportTemplate } from "./formImport.templates.js";
import { monthlyQualityFields } from "./reportTargets/monthlyQuality.js";
import { targetFields, targetFieldsForFrm, type TargetField } from "./targets.js";

export type ReportKind = "monthly-quality";

export interface ResolvedTarget {
  kind: "built" | "frm" | "report";
  reportKind?: ReportKind;
  title: string;
  revision: string | null;
  fields: TargetField[];
  builtId?: number;
  frmTemplate?: FormImportTemplate;
  canRead: boolean;
  canEdit: boolean;
}

interface Actor {
  id: number;
  roleName: string | null;
  department: string | null;
}

/**
 * Resolves a targetRef to its fields and permission, exactly the checks each target already
 * uses elsewhere in the app (Form Builder's canFillBuiltForm, the documents level FRM targets
 * use, engineeringAccess for report targets) — shared so /propose, /confirm, and saved mappings
 * all gate the same way. Throws when the actor cannot even read the target.
 */
export async function resolveTarget(db: Db, actor: Actor, ref: string): Promise<ResolvedTarget> {
  if (ref.startsWith("built:")) {
    const id = Number(ref.slice("built:".length));
    if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("Choose a form to import into.");
    const access = await formBuilderAccess(db, actor);
    const canUse = canFillBuiltForm(access);
    if (!canUse) throw AppError.forbidden("You can view this form once Documents is turned on for you.");
    const [row] = await db.select().from(builtForms).where(eq(builtForms.id, id));
    if (!row || row.status !== "published" || row.publishedStructure == null) {
      throw AppError.badRequest("Choose a published form to import into.");
    }
    return { kind: "built", title: row.title, revision: row.revision, fields: targetFields(row.publishedStructure), builtId: id, canRead: canUse, canEdit: canUse };
  }
  if (ref.startsWith("frm:")) {
    const key = ref.slice("frm:".length);
    const template = getFormImportTemplate(key);
    if (!template) throw AppError.badRequest("Choose a form to import into.");
    const level = await getUserAccessLevel(db, actor, "documents");
    if (level === "none") throw AppError.forbidden("No access to 'documents' for your department");
    return { kind: "frm", title: template.title, revision: null, fields: targetFieldsForFrm(template), frmTemplate: template, canRead: true, canEdit: level === "edit" };
  }
  if (ref === "report:monthly-quality") {
    const access = await engineeringAccess(db, actor);
    if (!access.canRead) throw AppError.forbidden("You don't have access to the modules in this report.");
    return { kind: "report", reportKind: "monthly-quality", title: "Monthly Quality Report", revision: null, fields: monthlyQualityFields(), canRead: access.canRead, canEdit: access.canEdit };
  }
  throw AppError.badRequest("Choose a form to import into.");
}
