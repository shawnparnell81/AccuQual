import { SAVED_FORM_FOLDERS_ROOT } from "./folderBrowse";

export interface FormFolderChoice {
  formKey: string;
  formKeys: string[];
  name: string;
}

export type SaveDestination = { kind: "form"; formKey: string; name: string } | { kind: "documents"; folderId: number };

/** The per-form folder whose keys include this blank. */
export function formFolderForTemplate(folders: readonly FormFolderChoice[], formKey: string): FormFolderChoice | null {
  return folders.find((folder) => folder.formKey === formKey || folder.formKeys.includes(formKey)) ?? null;
}

/**
 * Save as opens on the folder named for this form.
 * A copy already filed in a Documents folder stays on that folder.
 */
export function defaultSaveDestination(input: {
  formKey: string;
  folders: readonly FormFolderChoice[];
  filedParentId: number | null;
  filedParentPath: readonly string[];
}): SaveDestination | null {
  const filedInDocuments = input.filedParentId != null && !input.filedParentPath.includes(SAVED_FORM_FOLDERS_ROOT);
  if (filedInDocuments && input.filedParentId != null) return { kind: "documents", folderId: input.filedParentId };
  const match = formFolderForTemplate(input.folders, input.formKey);
  if (match) return { kind: "form", formKey: match.formKey, name: match.name };
  if (input.filedParentId != null) return { kind: "documents", folderId: input.filedParentId };
  return null;
}
