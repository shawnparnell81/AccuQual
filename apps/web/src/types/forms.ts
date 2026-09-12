export interface FormField {
  name: string;
  label: string;
  type?: "text" | "textarea" | "date" | "checkbox" | "signature";
}

export interface FormTemplate {
  id: number;
  formType: string;
  pdfPath: string;
  fieldMap: Record<string, string>;
  isDefault: string;
}

export interface FormDataRecord {
  id: number;
  formType: string;
  entityType: string | null;
  entityId: number | null;
  data: Record<string, unknown>;
  version: number;
  updatedAt: string | null;
}

export interface FormVersion {
  id: number;
  formId: number;
  version: number;
  data: Record<string, unknown>;
  createdAt: string;
}
