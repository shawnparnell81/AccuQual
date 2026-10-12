import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { faiInspectionApi, FAI_EVENT_TYPES, type FaiDistributionList, type FaiDistributionMember } from "../../api/faiInspection";
import { useSites } from "../../hooks/useSites";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

const TRIGGER_REASONS = ["New part", "New supplier", "Supplier factory change", "Receiving location change", "6-month repeat", "Annual random pull", "Engineering change", "Other"];

interface Person { id: number; name: string | null; email: string }

function useDirectoryPeople() {
  return useQuery<Person[]>({
    queryKey: ["fai-distribution-lists", "people"],
    queryFn: async () => (await apiClient.get("/users")).data,
    retry: false,
    throwOnError: false,
  });
}

function emptyDraft(): Omit<FaiDistributionList, "id"> {
  return { name: "", members: [], matchSiteId: null, matchProductFamily: "", matchTriggerReason: "", matchEventTypes: [], mondaySummary: false };
}

function ListEditor({ initial, onSaved, onCancel }: { initial?: FaiDistributionList; onSaved: () => void; onCancel: () => void }) {
  const { data: sites } = useSites();
  const { data: people } = useDirectoryPeople();
  const [draft, setDraft] = useState(initial ? { ...initial } : emptyDraft());
  const [newEmail, setNewEmail] = useState("");
  const [pickUserId, setPickUserId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: draft.name, members: draft.members,
        matchSiteId: draft.matchSiteId || null,
        matchProductFamily: draft.matchProductFamily?.trim() || null,
        matchTriggerReason: draft.matchTriggerReason || null,
        matchEventTypes: draft.matchEventTypes,
        mondaySummary: draft.mondaySummary,
      };
      return initial ? faiInspectionApi.distributionLists.update(initial.id, body) : faiInspectionApi.distributionLists.create(body);
    },
    onSuccess: onSaved,
    onError: (err) => setError(extractErrorMessage(err, "Could not save this distribution list.")),
  });

  function addEmail() {
    const email = newEmail.trim();
    if (!email) return;
    setDraft((d) => ({ ...d, members: [...d.members, { type: "email", email }] }));
    setNewEmail("");
  }
  function addUser() {
    const userId = Number(pickUserId);
    if (!userId) return;
    if (draft.members.some((m) => m.type === "user" && m.userId === userId)) return;
    setDraft((d) => ({ ...d, members: [...d.members, { type: "user", userId }] }));
    setPickUserId("");
  }
  function removeMember(idx: number) {
    setDraft((d) => ({ ...d, members: d.members.filter((_, i) => i !== idx) }));
  }
  function memberLabel(m: FaiDistributionMember): string {
    if (m.type === "email") return m.email;
    return people?.find((p) => p.id === m.userId)?.email ?? `User`;
  }
  function toggleEventType(key: string) {
    setDraft((d) => ({ ...d, matchEventTypes: d.matchEventTypes.includes(key) ? d.matchEventTypes.filter((k) => k !== key) : [...d.matchEventTypes, key] }));
  }

  return (
    <div className="rounded-lg border p-4 mb-4 bg-gray-50">
      {error && <div className="bg-red-50 text-red-700 p-2 rounded mb-3 text-sm">{error}</div>}
      <label className="block mb-3 text-sm">Name*
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="border rounded px-3 py-2 w-full mt-1" />
      </label>

      <div className="mb-3">
        <div className="text-sm font-medium mb-1">Members</div>
        <div className="flex flex-wrap gap-2 mb-2">
          {draft.members.map((m, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-3 py-1 text-xs">
              {memberLabel(m)}
              <button onClick={() => removeMember(i)} className="text-gray-500 hover:text-gray-800">×</button>
            </span>
          ))}
          {draft.members.length === 0 && <span className="text-xs text-gray-500">No members yet.</span>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@company.com" className="border rounded px-2 py-1 text-sm" />
          <button onClick={addEmail} className="rounded border px-2 py-1 text-sm">Add email</button>
          {people && people.length > 0 && (
            <>
              <select value={pickUserId} onChange={(e) => setPickUserId(e.target.value)} className="border rounded px-2 py-1 text-sm">
                <option value="">Pick an existing user…</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name ?? p.email}</option>)}
              </select>
              <button onClick={addUser} className="rounded border px-2 py-1 text-sm">Add user</button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
        <label className="text-sm">Plant (optional)
          <select value={draft.matchSiteId ?? ""} onChange={(e) => setDraft({ ...draft, matchSiteId: e.target.value ? Number(e.target.value) : null })} className="border rounded px-2 py-1 w-full mt-1">
            <option value="">Any plant</option>
            {(sites?.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Product family (optional)
          <input value={draft.matchProductFamily ?? ""} onChange={(e) => setDraft({ ...draft, matchProductFamily: e.target.value })} className="border rounded px-2 py-1 w-full mt-1" />
        </label>
        <label className="text-sm">Inspection trigger type (optional)
          <select value={draft.matchTriggerReason ?? ""} onChange={(e) => setDraft({ ...draft, matchTriggerReason: e.target.value })} className="border rounded px-2 py-1 w-full mt-1">
            <option value="">Any</option>
            {TRIGGER_REASONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      <div className="mb-3">
        <div className="text-sm font-medium mb-1">Event types (unchecked = all)</div>
        <div className="flex flex-wrap gap-3">
          {FAI_EVENT_TYPES.map((e) => (
            <label key={e.key} className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={draft.matchEventTypes.includes(e.key)} onChange={() => toggleEventType(e.key)} /> {e.label}
            </label>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm mb-4">
        <input type="checkbox" checked={draft.mondaySummary} onChange={(e) => setDraft({ ...draft, mondaySummary: e.target.checked })} />
        Also send this list the Monday 7am weekly summary
      </label>

      <div className="flex gap-3">
        <button onClick={() => save.mutate()} disabled={!draft.name.trim() || save.isPending} className="rounded bg-primary text-primary-foreground px-4 py-2 disabled:opacity-50">
          Save
        </button>
        <button onClick={onCancel} className="rounded border px-4 py-2">Cancel</button>
      </div>
    </div>
  );
}

export function FaiDistributionListsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["fai-distribution-lists"], queryFn: () => faiInspectionApi.distributionLists.list() });
  const [editingId, setEditingId] = useState<number | null | "new">(null);

  const remove = useMutation({
    mutationFn: (id: number) => faiInspectionApi.distributionLists.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fai-distribution-lists"] }),
  });

  function closeEditor() {
    setEditingId(null);
    queryClient.invalidateQueries({ queryKey: ["fai-distribution-lists"] });
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">FAI Email Distribution Lists</h1>
        {editingId === null && (
          <button onClick={() => setEditingId("new")} className="rounded bg-primary text-primary-foreground px-4 py-2">
            New list
          </button>
        )}
      </div>

      {editingId === "new" && <ListEditor onSaved={closeEditor} onCancel={() => setEditingId(null)} />}

      {isLoading ? <div>Loading…</div> : (
        <div className="space-y-3">
          {(data ?? []).map((list) =>
            editingId === list.id ? (
              <ListEditor key={list.id} initial={list} onSaved={closeEditor} onCancel={() => setEditingId(null)} />
            ) : (
              <div key={list.id} className="rounded-lg border p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium">{list.name}</div>
                  <div className="text-sm text-gray-500">{list.members.length} member{list.members.length === 1 ? "" : "s"}{list.mondaySummary ? " · weekly summary" : ""}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditingId(list.id)} className="text-blue-600 hover:underline text-sm">Edit</button>
                  <button onClick={() => remove.mutate(list.id)} className="text-red-600 hover:underline text-sm">Delete</button>
                </div>
              </div>
            ),
          )}
          {(data ?? []).length === 0 && editingId !== "new" && <div className="text-gray-500">No distribution lists yet.</div>}
        </div>
      )}
    </div>
  );
}
