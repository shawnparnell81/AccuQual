import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { useNotifications } from "../../hooks/useNotifications";
import { recordPath } from "../../lib/opsLanguage";

function groupLabel(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString() ? "Today" : "Earlier";
}

/**
 * The in-app notification bell. A click marks the row read and, when the
 * logged entity has a stable page, opens that record.
 */
export function NotificationDropdown() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead, markAllRead, markingAll } = useNotifications();

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const groups = ["Today", "Earlier"]
    .map((label) => ({ label, items: notifications.filter((entry) => groupLabel(entry.createdAt) === label) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="relative">
      <button ref={buttonRef} type="button" onClick={() => setOpen((o) => !o)} title="Notifications" aria-label="Notifications" aria-expanded={open} className="aq-icon-btn">
        <Bell size={16} />
        {unreadCount > 0 && <span className="aq-dotn">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => { setOpen(false); buttonRef.current?.focus(); }} />
          <div className="absolute right-0 top-full z-30 mt-1 w-80 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg" role="dialog" aria-label="Notifications">
            <div className="flex items-center justify-between px-2 py-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notifications</p>
              <button type="button" className="text-xs text-primary hover:underline disabled:opacity-50" disabled={unreadCount === 0 || markingAll} onClick={() => markAllRead()}>
                Mark all read
              </button>
            </div>
            {notifications.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">No notifications yet.</p>
            ) : (
              groups.map((group) => (
                <div key={group.label}>
                  <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{group.label}</p>
                  {group.items.map((n) => {
                    const path = recordPath(n.relatedEntityType, n.relatedEntityId);
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => {
                          if (!n.readAt) markRead(n.id);
                          if (path) {
                            navigate(path);
                            setOpen(false);
                          }
                        }}
                        className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left text-sm hover:bg-secondary"
                      >
                        <span className="flex w-full items-center gap-1.5">
                          {!n.readAt && <span className="h-1.5 w-1.5 flex-none rounded-full bg-accent" />}
                          <span className={n.readAt ? "text-muted-foreground" : "font-medium"}>{n.subject}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(n.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          {path ? " · Open" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
            <button
              type="button"
              className="mt-1 w-full rounded-md px-2 py-2 text-left text-sm text-primary hover:bg-secondary"
              onClick={() => {
                setOpen(false);
                navigate("/notifications");
              }}
            >
              View all
            </button>
          </div>
        </>
      )}
    </div>
  );
}
