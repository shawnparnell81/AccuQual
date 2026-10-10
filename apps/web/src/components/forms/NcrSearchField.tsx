import { useMemo, useState } from "react";
import { ncrLinkConfirmation, ncrPickerRows, type NcrSearchRow } from "../../lib/ncrSearch";
import { recordHeading } from "../../lib/userRecordNumber";

export function NcrSearchField({
  ncrs,
  loading = false,
  value,
  onChange,
  label = "NCR",
}: {
  ncrs: NcrSearchRow[];
  loading?: boolean;
  value: number | null;
  onChange: (id: number | null) => void;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = ncrs.find((ncr) => ncr.id === value) ?? null;
  const matches = useMemo(() => ncrPickerRows(ncrs, query).slice(0, 12), [ncrs, query]);

  return (
    <div className="relative flex flex-col gap-1 text-sm">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <input
        aria-label={label}
        aria-expanded={open}
        aria-controls="ncr-search-list"
        role="combobox"
        placeholder="Search by NCR number or title"
        value={selected && !open ? `${recordHeading("NCR", selected.recordNumber)} — ${selected.title}` : query}
        onChange={(event) => {
          setQuery(event.target.value);
          if (value != null) onChange(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="rounded-md border border-border bg-background px-3 py-2"
      />
      {selected && <p className="text-xs text-foreground">{ncrLinkConfirmation(selected)}</p>}
      {value != null && (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground hover:underline"
          onClick={() => {
            onChange(null);
            setQuery("");
          }}
        >
          Clear NCR
        </button>
      )}
      {open && (
        <ul id="ncr-search-list" role="listbox" className="mt-1 max-h-52 overflow-auto rounded-md border border-border bg-card p-1 shadow-lg">
          {loading && <li className="px-2 py-1 text-xs text-muted-foreground">Loading NCRs…</li>}
          {!loading && matches.length === 0 && <li className="px-2 py-1 text-xs text-muted-foreground">No matching NCR</li>}
          {matches.map((ncr) => (
            <li key={ncr.id}>
              <button
                type="button"
                role="option"
                className="w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onChange(ncr.id);
                  setQuery("");
                  setOpen(false);
                }}
              >
                {recordHeading("NCR", ncr.recordNumber)} — {ncr.title}
                {ncr.siteName ? ` · ${ncr.siteName}` : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
