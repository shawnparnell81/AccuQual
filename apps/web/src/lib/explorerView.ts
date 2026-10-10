import { previewKind } from "./filePreview";

/** Windows Explorer view modes. List is the default. */
export const EXPLORER_VIEWS = ["list", "details", "small", "large"] as const;

export type ExplorerView = (typeof EXPLORER_VIEWS)[number];

/** One preference per page, stored per signed-in user. */
export const EXPLORER_VIEW_PAGES = ["folders", "blank-forms", "form-folders", "form-folder"] as const;

export type ExplorerViewPage = (typeof EXPLORER_VIEW_PAGES)[number];

export const EXPLORER_VIEW_OPTIONS: readonly { id: ExplorerView; label: string }[] = [
  { id: "list", label: "List" },
  { id: "details", label: "Details" },
  { id: "small", label: "Small icons" },
  { id: "large", label: "Large icons" },
];

export function isExplorerView(value: unknown): value is ExplorerView {
  return typeof value === "string" && (EXPLORER_VIEWS as readonly string[]).includes(value);
}

export function viewStorageKey(page: ExplorerViewPage, userId?: number | null): string {
  const base = `accuqual-view:${page}`;
  return userId == null ? base : `${base}:user:${userId}`;
}

export function readExplorerView(storage: Pick<Storage, "getItem"> | null | undefined, key: string): ExplorerView {
  try {
    const raw = storage?.getItem(key);
    return isExplorerView(raw) ? raw : "list";
  } catch {
    return "list";
  }
}

export function writeExplorerView(storage: Pick<Storage, "setItem"> | null | undefined, key: string, view: ExplorerView): void {
  try {
    storage?.setItem(key, view);
  } catch {
    // Preference only. A blocked storage write still keeps the choice for this visit.
  }
}

export function stepExplorerView(current: ExplorerView, direction: 1 | -1): ExplorerView {
  const index = EXPLORER_VIEWS.indexOf(current);
  const next = (index + direction + EXPLORER_VIEWS.length) % EXPLORER_VIEWS.length;
  return EXPLORER_VIEWS[next] ?? "list";
}

/** Arrow keys move the view radiogroup. Home and End jump to the ends. */
export function explorerViewFromKey(current: ExplorerView, key: string): ExplorerView | null {
  if (key === "ArrowRight" || key === "ArrowDown") return stepExplorerView(current, 1);
  if (key === "ArrowLeft" || key === "ArrowUp") return stepExplorerView(current, -1);
  if (key === "Home") return "list";
  if (key === "End") return "large";
  return null;
}

/** Append the stored file's extension when the display name does not already end with it. */
export function storedFileName(name: string, storedPath?: string | null): string {
  const ext = storedPath?.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
  if (!ext || name.toLowerCase().endsWith(ext.toLowerCase())) return name;
  return `${name}${ext}`;
}

/** First-page thumbnails are only drawn for an image or a PDF. Everything else uses a type icon. */
export function fileThumbnailKind(fileName: string, mimeType?: string | null): "image" | "pdf" | "none" {
  const kind = previewKind(fileName, mimeType);
  return kind === "image" || kind === "pdf" ? kind : "none";
}
