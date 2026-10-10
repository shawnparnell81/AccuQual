import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiClient } from "../../api/client";
import { fileThumbnailKind } from "../../lib/explorerView";

const THUMB_BYTE_LIMIT = 8 * 1024 * 1024;
const CACHE_LIMIT = 48;

const thumbCache = new Map<number, string>();
let activeLoads = 0;
const waiters: Array<() => void> = [];

function rememberThumb(folderId: number, url: string) {
  if (thumbCache.has(folderId)) thumbCache.delete(folderId);
  thumbCache.set(folderId, url);
  while (thumbCache.size > CACHE_LIMIT) {
    const oldest = thumbCache.keys().next().value;
    if (oldest == null) break;
    thumbCache.delete(oldest);
  }
}

function acquireLoad(): Promise<void> {
  if (activeLoads < 2) {
    activeLoads += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      activeLoads += 1;
      resolve();
    });
  });
}

function releaseLoad() {
  activeLoads = Math.max(0, activeLoads - 1);
  const next = waiters.shift();
  next?.();
}

async function renderPdfFirstPage(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default as string;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ data: data.slice(0) });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1.25, 360 / Math.max(base.width, 1)) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    return canvas.toDataURL("image/jpeg", 0.72);
  } finally {
    await task.destroy();
  }
}

function bytesToDataUrl(data: ArrayBuffer, mimeType?: string | null): string {
  const blob = new Blob([data], mimeType ? { type: mimeType } : undefined);
  return URL.createObjectURL(blob);
}

/**
 * First page of an attached image or PDF. Other files, and a failed load, keep the type icon.
 * Loads only after the tile is near the viewport, and only a couple at a time.
 */
export function FileThumbnail({
  folderId,
  fileName,
  mimeType,
  fallback,
}: {
  folderId: number;
  fileName: string;
  mimeType?: string | null;
  fallback: ReactNode;
}) {
  const kind = fileThumbnailKind(fileName, mimeType);
  const frame = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(() => thumbCache.get(folderId) ?? null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(kind !== "none" && thumbCache.has(folderId));

  useEffect(() => {
    if (kind === "none" || url) return;
    const node = frame.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [kind, url]);

  useEffect(() => {
    if (!visible || kind === "none" || url) return;
    let cancelled = false;
    void (async () => {
      await acquireLoad();
      try {
        if (cancelled) return;
        const res = await apiClient.get<ArrayBuffer>(`/document-folders/${folderId}/template`, { responseType: "arraybuffer" });
        if (cancelled) return;
        const data = res.data;
        if (!data || data.byteLength > THUMB_BYTE_LIMIT) {
          setFailed(true);
          return;
        }
        const next = kind === "pdf" ? await renderPdfFirstPage(data) : bytesToDataUrl(data, mimeType);
        if (cancelled) {
          if (next.startsWith("blob:")) URL.revokeObjectURL(next);
          return;
        }
        rememberThumb(folderId, next);
        setUrl(next);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        releaseLoad();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, kind, url, folderId, mimeType]);

  return (
    <div ref={frame} className="explorer-tile-visual" data-testid="file-thumbnail">
      {url && !failed ? <img src={url} alt="" /> : fallback}
    </div>
  );
}
