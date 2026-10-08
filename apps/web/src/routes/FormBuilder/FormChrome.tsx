import type { ReactNode } from "react";
import { useAuthStore } from "../../store/authStore";

export function FormMasthead({ formNumber, revision, title }: { formNumber: string | null | undefined; revision: string; title?: string }) {
  const logoUrl = useAuthStore((state) => state.company?.branding.logoUrl);
  return (
    <header className="aq-doc-head mb-3 flex items-start justify-between gap-3 border-b border-black/15 pb-2">
      <div className="flex items-center gap-3">
        {logoUrl ? <img src={logoUrl} alt="" className="h-10 w-auto object-contain" /> : <span className="text-sm font-semibold text-[#0A3C7B]">AccuQual</span>}
        {title ? <h1 className="text-lg font-semibold">{title}</h1> : null}
      </div>
      <div className="text-right text-xs">
        <div>Doc ID: {formNumber?.trim() || ""}</div>
        <div>Rev: {revision || "A"}</div>
      </div>
    </header>
  );
}

export function Paper({ wide, children }: { wide?: boolean; children: ReactNode }) {
  return <div className={`aq-paper aq-print-sheet mx-auto max-w-full overflow-auto p-4 shadow-sm ${wide ? "aq-print-wide" : ""}`}>{children}</div>;
}
