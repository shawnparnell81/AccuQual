import { useEffect, useRef, useState } from "react";

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/**
 * Lets files be dropped ANYWHERE on the current page. Returns `dragging`
 * (true while a file from the desktop is being dragged over the window) so the
 * caller can show a full-page hint. Any more specific drop area on the page
 * (a FileDropZone) handles its own drop first and stops it from reaching here.
 */
export function usePageFileDrop({ enabled, onFiles }: { enabled: boolean; onFiles: (files: File[]) => void }): { dragging: boolean } {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const handler = useRef(onFiles);
  handler.current = onFiles;

  useEffect(() => {
    if (!enabled) return;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) handler.current(files);
    };
    // Runs before any more specific drop area handles (and swallows) the drop, so the page-wide hint always clears.
    const reset = () => {
      depth.current = 0;
      setDragging(false);
    };
    window.addEventListener("drop", reset, true);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("drop", reset, true);
      depth.current = 0;
      setDragging(false);
    };
  }, [enabled]);

  return { dragging };
}
