import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScanLine } from "lucide-react";
import { apiClient } from "../../api/client";
import type { InventoryLotSearchResult } from "../../api/types";

/**
 * "Scan to find" — confirmed with the user this app's floor uses real
 * handheld barcode scanners, not a phone camera. A hardware scanner just
 * types the code into whatever text field has focus, then sends Enter, so
 * there's no new dependency or decode library here — just a dedicated,
 * always-reachable, autofocused input the scanner can type into from any
 * screen, wired to the exact same lookup `InventoryLotsPage.tsx`'s own
 * search box already uses (`GET /inventory/lots?q=`, matching lot #,
 * serial #, or SKU — real fields on real records, no schema change).
 * Equipment/work orders aren't wired in: neither has a short human-
 * friendly code field today (equipment only has an optional free-text
 * serialNumber; work orders only have a bare numeric id) — out of scope
 * for this PR.
 */
export function ScanToFindDialog() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [results, setResults] = useState<InventoryLotSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const navigate = useNavigate();

  function close() {
    setOpen(false);
    setCode("");
    setResults(null);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = code.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const { data } = await apiClient.get<InventoryLotSearchResult[]>("/inventory/lots", { params: { q } });
      if (data.length === 1) {
        navigate(`/inventory/lots/${data[0]!.id}`);
        close();
      } else {
        setResults(data);
      }
    } catch {
      setError("Couldn't search — you may not have access to Inventory.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Scan to find (lot #, serial #, or SKU)"
        className="hidden md:flex shrink-0 p-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ScanLine size={18} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={close} />
          <div className="fixed left-1/2 top-24 z-50 w-full max-w-sm -translate-x-1/2 rounded-lg border border-border bg-card p-4 shadow-xl">
            <h2 className="mb-3 text-sm font-medium">Scan to find</h2>
            <form onSubmit={submit} className="flex gap-2">
              <input
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Scan or type a lot #, serial #, or SKU"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
              <button type="submit" disabled={searching} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
                Find
              </button>
            </form>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            {results !== null && (
              <div className="mt-3 max-h-64 overflow-y-auto">
                {results.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No lot, serial number, or SKU matches "{code}".</p>
                ) : (
                  <>
                    <p className="mb-1 text-xs text-muted-foreground">{results.length} matches — pick one:</p>
                    <ul className="flex flex-col gap-1">
                      {results.map((r) => (
                        <li key={r.id}>
                          <button
                            onClick={() => {
                              navigate(`/inventory/lots/${r.id}`);
                              close();
                            }}
                            className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                          >
                            <span className="font-medium">{r.lotNumber}</span>
                            <span className="text-xs text-muted-foreground">
                              {r.sku} {r.description ? `— ${r.description}` : ""}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
