import { useRef } from "react";
import { Paperclip, X } from "lucide-react";
import { FileDropZone } from "./FileDropZone";

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Lets someone add photos or documents while filling in a "new record" form.
 * The files are held here and attached by the caller once the record exists
 * (see lib/attachments.ts's uploadPendingAttachments).
 */
export function PendingFilesField({ files, onChange, label = "Photos and files (optional)" }: { files: File[]; onChange: (files: File[]) => void; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const add = (added: File[]) => onChange([...files, ...added.filter((f) => !files.some((existing) => existing.name === f.name && existing.size === f.size))]);

  return (
    <FileDropZone onFiles={add} overlay={false} className="rounded-lg border-2 border-dashed border-border p-3 transition-colors hover:border-primary/50">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Paperclip size={14} /> {label}
        </span>
        <button type="button" onClick={() => input.current?.click()} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
          Browse…
        </button>
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            add(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {files.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">Drag files here from your computer. They're attached when you save.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1 text-xs">
              <span className="min-w-0 truncate">{file.name}</span>
              <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                {sizeLabel(file.size)}
                <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onChange(files.filter((f) => f !== file))} className="hover:text-destructive">
                  <X size={13} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </FileDropZone>
  );
}
