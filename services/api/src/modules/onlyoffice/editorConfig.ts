import jwt from "jsonwebtoken";
import { AppError } from "../../utils/appError.js";

export type OfficeDocumentType = "word" | "cell" | "slide";

/** Word, Excel, and PowerPoint — the office types the in-app viewer can open. */
export function officeDocumentType(fileName: string): OfficeDocumentType | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".docx")) return "word";
  if (lower.endsWith(".xlsx")) return "cell";
  if (lower.endsWith(".pptx")) return "slide";
  return null;
}

export function officeFileExtension(kind: OfficeDocumentType): string {
  if (kind === "word") return "docx";
  if (kind === "cell") return "xlsx";
  return "pptx";
}

export const OFFICE_TYPE_ERROR = "Only Word (.docx), Excel (.xlsx), and PowerPoint (.pptx) files can be opened in the editor.";

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
  /** Narrow screens ask for the touch layout. Wider screens keep the desktop editor. */
  viewer?: "desktop" | "mobile";
}

/** Browser config for DocsAPI.DocEditor. The token covers every field except itself. */
export function buildEditorConfig(input: EditorConfigInput, secret: string): Record<string, unknown> {
  const kind = officeDocumentType(input.fileName);
  if (!kind) throw new AppError(OFFICE_TYPE_ERROR, 415);
  const config: Record<string, unknown> = {
    document: {
      fileType: officeFileExtension(kind),
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
    type: input.viewer ?? "desktop",
  };
  return { ...config, token: jwt.sign(config, secret, { algorithm: "HS256" }) };
}
