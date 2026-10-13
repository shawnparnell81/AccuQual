import type { FormModule } from "./formModule";
import { AIR_STRUT_FORM } from "./forms/air_strut";
import { BRAKE_WEAR_FORM } from "./forms/brake_wear";
import { COIL_SPRING_FORM } from "./forms/coil_spring";
import { ELECTRIC_LIFT_FORM } from "./forms/electric_lift";
import { FUEL_INJECTOR_FORM } from "./forms/fuel_injector";
import { REGULAR_GAS_LIFT_FORM } from "./forms/regular_gas_lift";
import { SHOCK_FORM } from "./forms/shock";

/**
 * Every validation form drawn from its Excel workbook. Adding the next form is one entry here plus its layout and module:
 * see docs/validation-forms/ADDING-A-FORM.md. The form's type, number, title, Rev, pass color, workbook layout, formulas,
 * dropdowns and rollups all live on its module; nothing else in the app needs to know the form's rules.
 */
export const REGISTRY: Record<string, FormModule> = {
  shock: SHOCK_FORM,
  brake_wear: BRAKE_WEAR_FORM,
  electric_lift: ELECTRIC_LIFT_FORM,
  coil_spring: COIL_SPRING_FORM,
  fuel_injector: FUEL_INJECTOR_FORM,
  air_strut: AIR_STRUT_FORM,
  regular_gas_lift: REGULAR_GAS_LIFT_FORM,
};

export function registryModule(type: string | null | undefined): FormModule | undefined {
  return type ? REGISTRY[type] : undefined;
}

export function isRegistryForm(type: string | null | undefined): boolean {
  return registryModule(type) != null;
}
