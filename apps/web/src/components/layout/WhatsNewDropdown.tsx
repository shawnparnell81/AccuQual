import { useState } from "react";
import { Megaphone } from "lucide-react";
import { CHANGELOG } from "../../data/changelog";
import { useChangelogSeen } from "../../hooks/useChangelogSeen";

/**
 * "What's new" — a small header dropdown over the hand-maintained
 * CHANGELOG data, with a per-user "have you opened this since the
 * latest entry" badge (see useChangelogSeen). Same dropdown-panel
 * styling as TopNav.tsx's search/notification dropdowns (absolute,
 * top-full, z-30, border/shadow), kept local here since this is a
 * simple static list, not another search box.
 */
export function WhatsNewDropdown() {
  const [open, setOpen] = useState(false);
  const { hasUnseen, markSeenAsCurrent } = useChangelogSeen();

  return (
    <div className="relative">
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) markSeenAsCurrent();
        }}
        title="What's new"
        className="aq-icon-btn aq-hide-sm"
      >
        <Megaphone size={16} />
        {hasUnseen && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-30 mt-1 w-80 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-card p-3 shadow-lg">
            <h3 className="mb-2 text-sm font-medium">What's new</h3>
            <div className="flex flex-col gap-3">
              {CHANGELOG.map((entry) => (
                <div key={entry.version}>
                  <p className="text-xs font-medium text-muted-foreground">{new Date(entry.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</p>
                  <ul className="mt-1 list-disc pl-4 text-sm">
                    {entry.items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
