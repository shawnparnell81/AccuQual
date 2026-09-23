import { useState } from "react";
import { Bell } from "lucide-react";
import { useNotifications } from "../../hooks/useNotifications";

/**
 * The in-app notification bell — read-only surfacing of notification_log
 * (an email-send audit log that had no UI reading it back until now), not
 * a new digest/scheduler. Clicking an entry just marks it read; it doesn't
 * try to deep-link into the record (relatedEntityType/Id don't map to a
 * single consistent URL shape across every module that writes here) —
 * that's a reasonable follow-up, not required for a first, honest read
 * surface over what's already being logged.
 */
export function NotificationDropdown() {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, markRead } = useNotifications();

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} title="Notifications" className="relative flex items-center rounded-md p-1.5 text-muted-foreground hover:bg-secondary">
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-medium text-accent-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-30 mt-1 w-80 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg">
            <p className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Notifications</p>
            {notifications.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">Nothing here yet.</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.readAt) markRead(n.id);
                  }}
                  className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left text-sm hover:bg-secondary"
                >
                  <span className="flex w-full items-center gap-1.5">
                    {!n.readAt && <span className="h-1.5 w-1.5 flex-none rounded-full bg-accent" />}
                    <span className={n.readAt ? "text-muted-foreground" : "font-medium"}>{n.subject}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
