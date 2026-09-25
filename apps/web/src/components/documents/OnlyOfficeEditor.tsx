import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { openOfficeSession, type OfficeSession } from "../../api/onlyoffice";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

interface Props {
  documentId: number;
  versionId: number;
  fileId: number;
  fileName: string;
  onClose: () => void;
}

type DocEditorInstance = { destroyEditor?: () => void };

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (placeholderId: string, config: Record<string, unknown>) => DocEditorInstance;
    };
  }
}

const scriptLoads = new Map<string, Promise<void>>();

function loadEditorScript(documentServerUrl: string): Promise<void> {
  const src = `${documentServerUrl.replace(/\/$/, "")}/web-apps/apps/api/documents/api.js`;
  const existing = scriptLoads.get(src);
  if (existing) return existing;
  const pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoads.delete(src);
      reject(new Error("Couldn't load the office editor."));
    };
    document.body.appendChild(script);
  });
  scriptLoads.set(src, pending);
  return pending;
}

/**
 * Full-screen ONLYOFFICE editor. The session config is produced by the API; this component
 * only loads the document-server script and hosts the iframe the script creates.
 */
export function OnlyOfficeEditor({ documentId, versionId, fileId, fileName, onClose }: Props) {
  const placeholderId = useId().replace(/:/g, "");
  const [session, setSession] = useState<OfficeSession | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    openOfficeSession(documentId, versionId, fileId)
      .then((next) => {
        if (!cancelled) setSession(next);
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err, "Couldn't open that file in the editor."));
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, versionId, fileId]);

  useEffect(() => {
    if (!session) return;
    let editor: DocEditorInstance | undefined;
    let cancelled = false;
    loadEditorScript(session.documentServerUrl)
      .then(() => {
        if (cancelled || !window.DocsAPI) return;
        editor = new window.DocsAPI.DocEditor(placeholderId, session.config);
        if (!cancelled) setReady(true);
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err, "Couldn't load the office editor."));
      });
    return () => {
      cancelled = true;
      try {
        editor?.destroyEditor?.();
      } catch {
        // The script removes its own iframe; a failed destroy on an unmounted node is harmless.
      }
    };
  }, [session, placeholderId]);

  const title = session ? `${session.mode === "edit" ? "Editing" : "Viewing"} ${fileName}` : fileName;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
          <X size={14} /> Close
        </button>
      </div>
      {error ? (
        <p className="p-6 text-sm text-destructive">{error}</p>
      ) : (
        <div className="relative min-h-0 flex-1">
          <div id={placeholderId} className="h-full w-full" />
          {!ready && <p className="absolute left-6 top-6 text-sm text-muted-foreground">Opening the editor…</p>}
        </div>
      )}
    </div>,
    document.body,
  );
}
