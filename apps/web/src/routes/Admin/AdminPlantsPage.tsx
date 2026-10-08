import { useEffect, useState } from "react";
import { isFullAccessRole } from "../../lib/fullAccess";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import type { AppUser } from "../../api/types";
import { TextField } from "../../components/forms/Field";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useCurrentUser } from "../../hooks/useAuth";
import { useSites, type PlantContext, type PlantSummary } from "../../hooks/useSites";
import { formatPerson } from "../../lib/opsLanguage";
import { useDialogBehavior } from "../../components/shared/useDialogBehavior";

const userHooks = createResourceHooks<AppUser>("users");

/**
 * Admin Console section for plants. Same card-and-form pattern as Users &
 * Roles: admins create and rename plants, and choose who works at each one.
 */
export function AdminPlantsPage() {
  const user = useCurrentUser();
  const isAdmin = isFullAccessRole(user?.roleName);
  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Plants are managed by an administrator. Ask one to add a plant or assign you to it.
      </div>
    );
  }
  return <PlantsEditor />;
}

function PlantsEditor() {
  const { data, isLoading } = useSites();
  const { data: users = [] } = userHooks.useList();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const createPlant = useMutation({
    mutationFn: async () => (await apiClient.post("/sites", { name, code: code.trim() || undefined })).data,
    onSuccess: () => {
      toast.success("Plant added.");
      setName("");
      setCode("");
      void queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't add that plant.")),
  });

  const [confirmPlant, setConfirmPlant] = useState<PlantSummary | null>(null);

  const deletePlant = useMutation({
    mutationFn: async (id: number) => (await apiClient.delete(`/sites/${id}`)).data,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["sites"] });
      const previous = queryClient.getQueryData<PlantContext>(["sites"]);
      queryClient.setQueryData<PlantContext>(["sites"], (current) => {
        if (!current) return current;
        const sites = current.sites.filter((site) => site.id !== id);
        const currentSiteId = current.currentSiteId === id ? (sites.find((site) => site.isDefault)?.id ?? sites[0]?.id ?? null) : current.currentSiteId;
        return { ...current, sites, currentSiteId };
      });
      setSelectedId((current) => (current === id ? null : current));
      return { previous };
    },
    onSuccess: (result: { name?: string }) => {
      toast.success(`${result.name ?? "Plant"} deleted.`);
      setConfirmPlant(null);
    },
    onError: (err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(["sites"], context.previous);
      toast.error(extractErrorMessage(err, "Couldn't delete that plant."));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });

  const plants = data?.sites ?? [];
  const selected = plants.find((plant) => plant.id === selectedId) ?? plants[0] ?? null;
  const canDelete = Boolean(data?.canDelete);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Plants</h1>
        <p className="text-sm text-muted-foreground">
          Issues, fixes, and audits belong to one plant. Controlled documents stay shared across every plant.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-medium">Plants in this organization</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading plants…</p>
        ) : (
          <table className="mb-4 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2">Name</th>
                <th className="pb-2">Code</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {plants.map((plant) => (
                <tr key={plant.id} className="border-t border-border">
                  <td className="py-1.5">
                    {plant.name}
                    {plant.isDefault ? <span className="ml-2 text-xs text-muted-foreground">Main</span> : null}
                  </td>
                  <td className="py-1.5 text-muted-foreground">{plant.code}</td>
                  <td className="space-x-3 py-1.5 text-right">
                    <button type="button" onClick={() => setSelectedId(plant.id)} className="text-xs text-primary hover:underline">
                      People
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        disabled={deletePlant.isPending}
                        onClick={() => setConfirmPlant(plant)}
                        className="text-xs text-destructive hover:underline disabled:opacity-60"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form
          className="grid gap-2 border-t border-border pt-3 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            createPlant.mutate();
          }}
        >
          <TextField label="Plant name" required value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Short code (optional)" value={code} onChange={(e) => setCode(e.target.value)} placeholder="east-plant" />
          <button type="submit" disabled={createPlant.isPending || !name.trim()} className="w-fit self-end rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
            {createPlant.isPending ? "Adding…" : "Add plant"}
          </button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">Deleting a plant removes it from every list. Records that already use it keep the plant name.</p>
      </div>

      {selected && <MembersEditor plant={selected} users={users} />}
      {confirmPlant && (
        <DeletePlantDialog
          plant={confirmPlant}
          pending={deletePlant.isPending}
          onCancel={() => {
            if (!deletePlant.isPending) setConfirmPlant(null);
          }}
          onConfirm={() => deletePlant.mutate(confirmPlant.id)}
        />
      )}
    </div>
  );
}

function DeletePlantDialog({ plant, pending, onCancel, onConfirm }: { plant: PlantSummary; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  const ref = useDialogBehavior(true, onCancel);
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onCancel} />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-plant-title"
        aria-describedby="delete-plant-message"
        tabIndex={-1}
        className="modal-in fixed left-1/2 top-24 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-xl outline-none"
      >
        <h2 id="delete-plant-title" className="text-sm font-medium">
          Delete {plant.name}?
        </h2>
        <p id="delete-plant-message" className="mt-2 text-sm text-muted-foreground">
          {plant.name} will disappear from plant lists, pickers, and the switcher. Issues, fixes, equipment, people, and audit history that already use {plant.name} keep that name.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={pending} className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-60">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={pending} className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground disabled:opacity-60">
            {pending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </>
  );
}

function MembersEditor({ plant, users }: { plant: PlantSummary; users: AppUser[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: ["site-members", plant.id],
    queryFn: async () => (await apiClient.get<{ userIds: number[] }>(`/sites/${plant.id}/members`)).data.userIds,
  });
  const [draft, setDraft] = useState<number[] | null>(null);
  useEffect(() => setDraft(null), [plant.id]);
  const selected = draft ?? members.data ?? [];

  const save = useMutation({
    mutationFn: async () => (await apiClient.put(`/sites/${plant.id}/members`, { userIds: selected })).data,
    onSuccess: () => {
      toast.success(`People updated for ${plant.name}.`);
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["site-members", plant.id] });
      void queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't update who works at this plant.")),
  });

  function toggle(id: number) {
    const base = draft ?? members.data ?? [];
    setDraft(base.includes(id) ? base.filter((userId) => userId !== id) : [...base, id]);
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-1 text-sm font-medium">Who works at {plant.name}</h3>
      <p className="mb-3 text-xs text-muted-foreground">Someone must stay assigned to at least one plant. Admins can open every plant whether or not they are checked.</p>
      {members.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading people…</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-1 text-sm">
          {users.map((person) => (
            <li key={person.id}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={selected.includes(person.id)} onChange={() => toggle(person.id)} />
                <span>{formatPerson(person)}</span>
                <span className="text-xs text-muted-foreground">{person.email}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        disabled={save.isPending || draft == null}
        onClick={() => save.mutate()}
        className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
      >
        {save.isPending ? "Saving…" : "Save assignments"}
      </button>
    </div>
  );
}
