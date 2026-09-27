import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ScanLine } from "lucide-react";
import { apiClient } from "../../api/client";
import type { SearchResult } from "../../api/types";
import { useDialogBehavior } from "../shared/useDialogBehavior";

/**
 * Hardware scanners type into the focused field and send Enter. The lookup
 * is the same global search as the header, so a gage serial, document title,
 * or record number opens the matching page.
 */
export function ScanToFindDialog() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const navigate = useNavigate();
  const dialogRef = useDialogBehavior(open, () => setOpen(false));

  function close() {
    setOpen(false);
    setCode("");
    setResults(null);
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const q = code.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const { data } = await apiClient.get<{ results: SearchResult[] }>("/search", { params: { q } });
      if (data.results.length === 1) {
        navigate(data.results[0]!.path);
        close();
      } else {
        setResults(data.results);
      }
    } catch {
      setError("Couldn't search.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Scan to find"
        aria-label="Scan to find"
        className="aq-icon-btn aq-hide-sm"
      >
        <ScanLine size={18} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={close} />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="scan-title"
            tabIndex={-1}
            className="modal-in fixed left-1/2 top-24 z-50 w-full max-w-sm -translate-x-1/2 rounded-lg border border-border bg-card p-4 shadow-xl outline-none"
          >
            <h2 id="scan-title" className="mb-3 text-sm font-medium">
              Scan to find
            </h2>
            <form onSubmit={submit} className="flex gap-2">
              <input
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Scan or type a record, document, or gage"
                aria-label="Scan code"
                className="flex-1 rounded-md border border-form-field bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <button type="submit" disabled={searching} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
                Find
              </button>
            </form>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            {results !== null && (
              <div className="mt-3 max-h-64 overflow-y-auto">
                {results.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing matches "{code}".</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {results.map((result) => (
                      <li key={`${result.type}-${result.id}`}>
                        <button
                          type="button"
                          onClick={() => {
                            navigate(result.path);
                            close();
                          }}
                          className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary"
                        >
                          <span className="font-medium">{result.label}</span>
                          <span className="text-xs text-muted-foreground">{result.type}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
