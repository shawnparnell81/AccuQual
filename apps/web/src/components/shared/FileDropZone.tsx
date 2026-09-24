import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { UploadCloud } from "lucide-react";
import { useToast } from "./ToastProvider";

/** True when a drag carries files from the desktop, as opposed to an in-app drag (a document pill, a folder header). */
export function isFileDrag(e: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

/** Same matching rule as <input accept>: ".pdf" extensions, "image/*" wildcards and exact mime types. */
export function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  return accept
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .some((token) => (token.startsWith(".") ? name.endsWith(token) : token.endsWith("/*") ? file.type.toLowerCase().startsWith(token.slice(0, -1)) : file.type.toLowerCase() === token));
}

/**
 * Wraps any upload area so files can be dropped straight onto it from the
 * desktop. The existing "Upload" buttons keep working — this only adds the
 * drop path, with the same accepted types as the button's file picker.
 * In-app drags (moving a document between folders) are ignored, so this can
 * sit around drag-and-drop lists without interfering.
 */
export function FileDropZone({
  onFiles,
  accept,
  multiple = true,
  disabled = false,
  label = "Drop to upload",
  overlay = true,
  className = "",
  children,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  label?: string;
  overlay?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const toast = useToast();
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  function reset() {
    depth.current = 0;
    setOver(false);
  }

  function onDragEnter(e: DragEvent) {
    if (disabled || !isFileDrag(e)) return;
    e.preventDefault();
    depth.current += 1;
    setOver(true);
  }
  function onDragOver(e: DragEvent) {
    if (disabled || !isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
  function onDragLeave(e: DragEvent) {
    if (disabled || !isFileDrag(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  }
  function onDrop(e: DragEvent) {
    if (disabled || !isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    reset();
    const dropped = Array.from(e.dataTransfer.files);
    const accepted = dropped.filter((file) => matchesAccept(file, accept));
    if (accepted.length < dropped.length) {
      toast.error(accepted.length === 0 ? "That file type isn't accepted here." : `${dropped.length - accepted.length} file(s) skipped — type not accepted here.`);
    }
    if (accepted.length === 0) return;
    onFiles(multiple ? accepted : accepted.slice(0, 1));
  }

  return (
    <div className={`relative ${className}`} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {children}
      {over && overlay && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-primary bg-primary/10 backdrop-blur-[1px]">
          <UploadCloud size={26} className="text-primary" />
          <p className="text-sm font-medium text-primary">{label}</p>
        </div>
      )}
      {over && !overlay && <div className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-primary" />}
    </div>
  );
}
