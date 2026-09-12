import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
// Vite's `?url` suffix resolves to the built worker file's final URL so pdf.js can load it off the main thread.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfViewerProps {
  data: Uint8Array | null;
  isLoading?: boolean;
}

/** Renders a PDF (from bytes, e.g. the /forms/:type/:id/export response) onto a canvas via PDF.js. */
export function PdfViewer({ data, isLoading }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageInfo, setPageInfo] = useState<{ page: number; total: number } | null>(null);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;

    (async () => {
      try {
        setError(null);
        const pdf = await pdfjsLib.getDocument({ data: data.slice() }).promise;
        if (cancelled) return;

        const page = await pdf.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas) return;

        const viewport = page.getViewport({ scale: 1.3 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext("2d");
        if (!context) return;

        await page.render({ canvasContext: context, viewport, canvas }).promise;
        if (!cancelled) setPageInfo({ page: 1, total: pdf.numPages });
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
    <div className="flex flex-col items-center gap-2">
      <canvas ref={canvasRef} className="max-w-full rounded border border-border shadow-sm" />
      {pageInfo && pageInfo.total > 1 && (
        <p className="text-xs text-muted-foreground">
          Page {pageInfo.page} of {pageInfo.total} (multi-page preview not yet implemented)
        </p>
      )}
    </div>
  );
}
