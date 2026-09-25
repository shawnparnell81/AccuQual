import jwt from "jsonwebtoken";
import { AppError } from "../../utils/appError.js";

export type OfficeDocumentType = "word" | "cell";

/** Word and Excel only — the same two office types controlled documents already accept. */
export function officeDocumentType(fileName: string): OfficeDocumentType | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".docx")) return "word";
  if (lower.endsWith(".xlsx")) return "cell";
  return null;
}

export function editorDocumentKey(fileId: number, sha256: string): string {
  return `f${fileId}-${sha256.slice(0, 16)}`;
}

export interface EditorConfigInput {
  fileId: number;
  fileName: string;
  sha256: string;
  mode: "view" | "edit";
  user: { id: number; name: string };
  fileUrl: string;
  callbackUrl: string;
}

/** Browser config for DocsAPI.DocEditor. The token covers every field except itself. */
export function buildEditorConfig(input: EditorConfigInput, secret: string): Record<string, unknown> {
  const kind = officeDocumentType(input.fileName);
  if (!kind) throw new AppError("Only Word (.docx) and Excel (.xlsx) files can be opened in the editor.", 415);
  const config: Record<string, unknown> = {
    document: {
      fileType: kind === "word" ? "docx" : "xlsx",
      key: editorDocumentKey(input.fileId, input.sha256),
      title: input.fileName,
      url: input.fileUrl,
      permissions: {
        edit: input.mode === "edit",
        download: true,
        print: true,
        review: false,
        comment: input.mode === "edit",
      },
    },
    documentType: kind,
    editorConfig: {
      mode: input.mode,
      callbackUrl: input.callbackUrl,
      user: { id: String(input.user.id), name: input.user.name },
      customization: { forcesave: input.mode === "edit", autosave: input.mode === "edit" },
    },
    type: "desktop",
  };
  return { ...config, token: jwt.sign(config, secret, { algorithm: "HS256" }) };
}
