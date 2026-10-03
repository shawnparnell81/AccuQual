import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { apiClient } from "../../api/client";
import { useChangelogSeen } from "../../hooks/useChangelogSeen";

interface ReleaseNote {
  id: string;
  text: string;
  createdAt: string;
  createdByName: string;
}

interface ReleaseNotesResponse {
  notes: ReleaseNote[];
  canEdit: boolean;
}

/** What's new comes from the company list. An empty list stays empty — nothing is invented here. */
export function WhatsNewDropdown() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const qc = useQueryClient();
  const notesQuery = useQuery<ReleaseNotesResponse>({
    queryKey: ["company/release-notes"],
    queryFn: async () => (await apiClient.get<ReleaseNotesResponse>("/company/release-notes")).data,
  });
  const notes = notesQuery.data?.notes ?? [];
  const canEdit = notesQuery.data?.canEdit === true;
  const latestId = notes[0]?.id ?? null;
  const { hasUnseen, markSeenAsCurrent } = useChangelogSeen(latestId);

  const create = useMutation({
    mutationFn: async (text: string) => (await apiClient.post<ReleaseNote>("/company/release-notes", { text })).data,
    onSuccess: async () => {
      setDraft("");
      await qc.invalidateQueries({ queryKey: ["company/release-notes"] });
    },
  });
  const archive = useMutation({
    mutationFn: async (id: string) => apiClient.post(`/company/release-notes/${id}/archive`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["company/release-notes"] });
    },
  });

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

  return (
    <div className="relative">
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) markSeenAsCurrent();
        }}
        ref={buttonRef}
        type="button"
        title="What's new"
        aria-label="What's new"
        aria-expanded={open}
        className="aq-icon-btn aq-hide-sm"
      >
        <Megaphone size={16} />
        {hasUnseen && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="aq-menu absolute right-0 top-full z-30 mt-1 w-80 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-card p-3 text-foreground shadow-lg">
            <h3 className="mb-2 text-sm font-medium">What's new</h3>
            {notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing new right now.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {notes.map((note) => (
                  <div key={note.id}>
                    <p className="text-xs font-medium text-muted-foreground">
                      {new Date(note.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      {note.createdByName ? ` · ${note.createdByName}` : ""}
                    </p>
                    <p className="mt-1 text-sm">{note.text}</p>
                    {canEdit && (
                      <button type="button" onClick={() => archive.mutate(note.id)} className="mt-1 text-xs text-muted-foreground hover:underline">
                        Archive
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canEdit && (
              <form
                className="mt-3 flex flex-col gap-2 border-t border-border pt-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = draft.trim();
                  if (text) create.mutate(text);
                }}
              >
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={500}
                  rows={3}
                  aria-label="New note"
                  placeholder="Write a current note"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
                <button type="submit" disabled={create.isPending || draft.trim().length === 0} className="self-end rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">
                  {create.isPending ? "Saving…" : "Add note"}
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}
