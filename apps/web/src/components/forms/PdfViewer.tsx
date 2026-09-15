import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// Vite's `?url` suffix resolves to the built worker file's final URL so pdf.js can load it off the main thread.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfViewerProps {
  data: Uint8Array | null;
  isLoading?: boolean;
}

/**
 * Renders a PDF (from bytes, e.g. the /forms/:type/:id/export response) via
 * PDF.js — every page, stacked in reading order with its own page number,
 * in a scrollable container, the way a real print preview pane works.
 * Previously rendered page 1 only ("multi-page preview not yet
 * implemented") — real multi-page documents (a filled-in Work Order
 * Traveler with several operations, a long QMS form) silently hid every
 * page after the first.
 */
export function PdfViewer({ data, isLoading }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    const container = containerRef.current;
    if (container) container.innerHTML = "";

    (async () => {
      try {
        setError(null);
        setPageCount(null);
        const pdf = await pdfjsLib.getDocument({ data: data.slice() }).promise;
        if (cancelled || !container) return;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.3 });

          const wrapper = document.createElement("div");
          wrapper.className = "flex flex-col items-center gap-1";

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "max-w-full rounded border border-border shadow-sm";
          const context = canvas.getContext("2d");
          if (!context) continue;
          await page.render({ canvasContext: context, viewport, canvas }).promise;
          if (cancelled) return;

          const label = document.createElement("p");
          label.className = "text-xs text-muted-foreground";
          label.textContent = `Page ${pageNum} of ${pdf.numPages}`;

          wrapper.appendChild(canvas);
          wrapper.appendChild(label);
          container.appendChild(wrapper);
        }

        if (!cancelled) setPageCount(pdf.numPages);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to render PDF");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Rendering preview…</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">No preview yet — export the form to generate one.</p>;

  return (
    <div className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto">
      {pageCount === null && <p className="text-sm text-muted-foreground">Rendering preview…</p>}
      <div ref={containerRef} className="flex flex-col items-center gap-4" />
    </div>
  );
}
