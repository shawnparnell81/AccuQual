import { FORM_BUILDER_PERMISSION, isFullAccessRole } from "../roles/roleAccess.js";

export { FORM_BUILDER_PERMISSION };

export type ModuleLevel = "none" | "read" | "edit";

export interface FormBuilderAccessInput {
  roleName: string | null | undefined;
  /** True when this person's system role has the Form Builder permission checked. */
  roleHasPermission: boolean;
  /** Department or custom-role grant from Roles & Permissions. */
  moduleLevel: ModuleLevel;
}

/** Creating a form or changing its structure. Role names are not inspected here. */
export function canEditFormBuilder(input: FormBuilderAccessInput): boolean {
  if (isFullAccessRole(input.roleName)) return true;
  if (input.roleHasPermission) return true;
  return input.moduleLevel === "edit";
}

/** Opening the builder. Filling a published copy uses canFillBuiltForm. */
export function canReadFormBuilder(input: FormBuilderAccessInput): boolean {
  if (canEditFormBuilder(input)) return true;
  return input.moduleLevel === "read";
}

/** A published template can be filled by anyone who can already open Documents. */
export function canFillBuiltForm(input: FormBuilderAccessInput & { documentsLevel: ModuleLevel }): boolean {
  if (canReadFormBuilder(input)) return true;
  return input.documentsLevel === "read" || input.documentsLevel === "edit";
}
