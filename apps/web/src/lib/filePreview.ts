/** How a clicked file should open. Unsupported types are downloaded instead. */
export type PreviewKind = "image" | "pdf" | "office" | "download";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);

export function previewKind(fileName: string, mimeType?: string | null): PreviewKind {
  const name = fileName.toLowerCase();
  const mime = (mimeType ?? "").split(";")[0]!.trim().toLowerCase();
  if (IMAGE_EXT.test(name) || IMAGE_MIME.has(mime)) return "image";
  if (name.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (name.endsWith(".docx") || name.endsWith(".xlsx") || name.endsWith(".pptx")) return "office";
  return "download";
}

export function canPreview(fileName: string, mimeType?: string | null): boolean {
  return previewKind(fileName, mimeType) !== "download";
}

/** Saves bytes as a file in the browser. Used by every Download button next to a preview. */
export function saveBytes(data: ArrayBuffer | Blob, fileName: string, mimeType?: string) {
  const blob = data instanceof Blob ? data : new Blob([data], mimeType ? { type: mimeType } : undefined);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
