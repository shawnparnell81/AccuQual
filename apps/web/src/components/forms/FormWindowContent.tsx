import { FormEditor } from "./FormEditor";

interface FormWindowContentProps {
  formType: string;
  entityId?: number;
  windowId: string;
}

/** Bridges a WindowInstance (which may lack an entityId in theory) to FormEditor (which requires one). */
export function FormWindowContent({ formType, entityId, windowId }: FormWindowContentProps) {
  if (entityId === undefined) {
    return <p className="text-sm text-destructive">This form window has no linked record — nothing to load.</p>;
  }
  return <FormEditor formType={formType} entityId={entityId} windowId={windowId} />;
}
