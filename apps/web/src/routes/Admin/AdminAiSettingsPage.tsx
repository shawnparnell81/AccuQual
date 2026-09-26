import { useState } from "react";
import { AdminCompanyAiConfigPage } from "./AdminCompanyAiConfigPage";
import { AdminAiUsagePage } from "./AdminAiUsagePage";

const TABS = ["Configuration", "Usage"] as const;
type Tab = (typeof TABS)[number];

/**
 * Consolidates the two pre-existing AI admin pages (AdminCompanyAiConfigPage,
 * AdminAiUsagePage — each already a complete, AdminOnlyGuard'd page with its
 * own real endpoint) into one "AI Settings" console section as tabs, rather
 * than reimplementing either. Each tab renders the real, unmodified page.
 */
export function AdminAiSettingsPage() {
  const [tab, setTab] = useState<Tab>("Configuration");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm ${tab === t ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Configuration" && <AdminCompanyAiConfigPage />}
      {tab === "Usage" && <AdminAiUsagePage />}
    </div>
  );
}
