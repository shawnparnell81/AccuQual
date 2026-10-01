import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { formatDate } from "../../lib/dates";
import { BLANK_FORMS_PATH, QUARANTINE_NOTICE_PATH } from "../../lib/qualityEntry";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";

export interface QuarantineItemRow {
  id: number;
  partNumber: string;
  quantity: string;
  serialNumber: string | null;
  quarantinedAt: string | null;
  ncrId: number | null;
  releasedAt: string | null;
  disposition: string | null;
  dispositionLabel: string | null;
  status: string;
}

function qty(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}

/**
 * Holds already on the list. A new notice starts from Blank Forms (FRM-NCR-002).
 * Rows open the hold. Items opened from an NCR leave Active when that disposition
 * is completed and stay under Released.
 */
export function QuarantinePage() {
  const [view, setView] = useState<"active" | "released">("active");
  const query = useQuery<QuarantineItemRow[]>({
    queryKey: ["quarantine", "items", view],
    queryFn: async () => (await apiClient.get<QuarantineItemRow[]>("/quarantine/items", { params: { view } })).data,
  });

  const rows = query.data ?? [];
  const showSerial = rows.some((row) => !!row.serialNumber);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Quarantined items</h1>
        <p className="text-sm text-muted-foreground">
          Open a row to see the hold. Start a notice from{" "}
          <Link to={BLANK_FORMS_PATH} className="text-primary hover:underline">
            Blank Forms
          </Link>{" "}
          or{" "}
          <Link to={QUARANTINE_NOTICE_PATH} className="text-primary hover:underline">
            FRM-NCR-002 Quarantine Notice
          </Link>
          . Items opened from an NCR leave this list when that NCR's disposition is completed, and stay under Released.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(
          [
            ["active", "Active"],
            ["released", "Released"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={`px-3 py-2 text-sm ${view === key ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {query.isLoading && <LoadingPlaceholder />}
      {query.isError && <p className="text-sm text-destructive">Couldn't load quarantined items. Refresh the page and try again.</p>}
      {!query.isLoading && !query.isError && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground sm:p-8">
          {view === "active" ? (
            <p>
              No quarantined items yet. Write a notice from{" "}
              <Link to={BLANK_FORMS_PATH} className="text-primary hover:underline">
                Blank Forms
              </Link>{" "}
              or{" "}
              <Link to={QUARANTINE_NOTICE_PATH} className="text-primary hover:underline">
                FRM-NCR-002 Quarantine Notice
              </Link>
              .
            </p>
          ) : (
            <p>No released items yet.</p>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Part #</th>
                <th className="px-3 py-2 font-medium">Qty</th>
                {showSerial && <th className="px-3 py-2 font-medium">S/N</th>}
                <th className="px-3 py-2 font-medium">Date quarantined</th>
                <th className="px-3 py-2 font-medium">NCR #</th>
                {view === "released" && (
                  <>
                    <th className="px-3 py-2 font-medium">Release date</th>
                    <th className="px-3 py-2 font-medium">Disposition</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">
                    <Link to={`/quarantine/${row.id}`} className="text-primary hover:underline">
                      {row.partNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{qty(row.quantity)}</td>
                  {showSerial && <td className="px-3 py-2">{row.serialNumber ?? ""}</td>}
                  <td className="px-3 py-2">{formatDate(row.quarantinedAt)}</td>
                  <td className="px-3 py-2">{row.ncrId ? `NCR #${row.ncrId}` : ""}</td>
                  {view === "released" && (
                    <>
                      <td className="px-3 py-2">{formatDate(row.releasedAt)}</td>
                      <td className="px-3 py-2">{row.dispositionLabel ?? ""}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
