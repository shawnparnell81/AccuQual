import { useToast } from "../shared/ToastProvider";

/** Copies the exact path. A clipboard failure falls back to a selected textarea. */
export async function copyFolderPath(path: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(path);
      return true;
    }
  } catch {
    // The browser refused the clipboard. The textarea below still copies the same text.
  }
  const area = document.createElement("textarea");
  area.value = path;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  return ok;
}

/** Selectable folder path and the button that copies that exact text. The button is omitted from print. */
export function FolderPathBar({ path }: { path: string }) {
  if (!path) return null;
  return (
    <div className="folder-path-bar mb-3 flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-foreground" data-testid="folder-path">
      <span className="min-w-0 select-text break-all font-mono text-xs text-foreground" data-testid="folder-path-text" style={{ userSelect: "text" }}>
        {path}
      </span>
      <CopyPathButton path={path} />
    </div>
  );
}

export function CopyPathButton({ path, compact = false }: { path: string; compact?: boolean }) {
  const toast = useToast();
  if (!path) return null;
  return (
    <button
      type="button"
      className={
        compact
          ? "no-print shrink-0 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          : "no-print shrink-0 rounded-md border border-border bg-background px-2 py-0.5 text-xs text-foreground hover:bg-muted"
      }
      data-testid={compact ? "copy-path-row" : "copy-path"}
      aria-label={`Copy path ${path}`}
      title={path}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void copyFolderPath(path).then((ok) => {
          if (ok) toast.success("Path copied");
          else toast.error("Couldn't copy the path.");
        });
      }}
    >
      Copy path
    </button>
  );
}
