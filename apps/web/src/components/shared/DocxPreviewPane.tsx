import { useEffect, useRef, useState } from "react";
import "./officePreview.css";

/**
 * Renders a .docx in the page. The library and its styles load with this pane,
 * not with the rest of the app.
 */
export function DocxPreviewPane({ data }: { data: ArrayBuffer }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let cancelled = false;
    setError(null);
    node.replaceChildren();
    void (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;
        node.replaceChildren();
        await renderAsync(data, node, undefined, {
          className: "docx",
          inWrapper: true,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          useBase64URL: true,
        });
      } catch {
        if (!cancelled) setError("Couldn't preview that document.");
      }
    })();
    return () => {
      cancelled = true;
      node.replaceChildren();
    };
  }, [data]);

  return (
    <div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div ref={host} className="office-docx aq-paper" />
    </div>
  );
}
