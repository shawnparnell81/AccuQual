import { useState, type ReactNode } from "react";

/** Parks optional fields behind one control so a create form starts with the minimum. */
export function DetailsDisclosure({ label = "Add details", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={() => setOpen((value) => !value)} className="w-fit text-sm text-primary hover:underline" aria-expanded={open}>
        {open ? "Hide extra details" : label}
      </button>
      {open && <div className="flex flex-col gap-4">{children}</div>}
    </div>
  );
}
