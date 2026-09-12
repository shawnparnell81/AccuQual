import type { ComponentType } from "react";
import { GageRRForm } from "./GageRRForm";
import { ParetoChartForm } from "./ParetoChartForm";

export interface CustomFormProps {
  data: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
}

/**
 * formType -> a bespoke React component, for the handful of forms whose
 * calculations don't fit the row-by-row computed-column model the rest of
 * the forms engine uses (layouts/*.ts + GenericFormRenderer) — a
 * spreadsheet-wide statistical study (Gage R&R) and a sort-and-chart tool
 * (Pareto). FormEditor.tsx renders one of these when no layout exists for
 * the form type. Each form type here still has a real, plain FormLayout on
 * the server (services/api's layouts/) purely so PDF export has something
 * to print — that layout is intentionally NOT registered in this package's
 * own layouts/index.ts, so the client always reaches for the component below
 * instead.
 */
export const CUSTOM_FORM_COMPONENTS: Record<string, ComponentType<CustomFormProps>> = {
  gage_rr: GageRRForm,
  pareto_chart: ParetoChartForm,
};

export function getCustomFormComponent(formType: string): ComponentType<CustomFormProps> | undefined {
  return CUSTOM_FORM_COMPONENTS[formType];
}
