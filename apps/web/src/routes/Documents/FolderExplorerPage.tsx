import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { TextField } from "../../components/forms/Field";

interface DocumentFolder {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
}

/** Stable accent per department, cycling if there are ever more than 7. */
const DEPARTMENT_COLORS = ["#5B5FEA", "#2451FF", "#0E9F6E", "#C2953B", "#8A4FD6", "#D65F8A", "#2AA7B8"];

function useDocumentFolders() {
  return useQuery({
    queryKey: ["document-folders"],
    queryFn: async () => (await apiClient.get<DocumentFolder[]>("/document-folders")).data,
  });
}

function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; parentId?: number }) => (await apiClient.post<DocumentFolder>("/document-folders", input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document-folders"] }),
  });
}

function useUpdateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: number; name?: string; parentId?: number | null; sortOrder?: number }) =>
      (await apiClient.patch<DocumentFolder>(`/document-folders/${id}`, patch)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document-folders"] }),
  });
}

function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => apiClient.delete(`/document-folders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document-folders"] }),
  });
}

/**
 * Real, persisted version of the folder-tree tool built earlier as a
 * standalone artifact — same 3-tier shape (department -> folder -> document
 * type) and the same drag-and-drop interactions, now backed by
 * `document_folders` (services/api/src/modules/document-folders/) instead of
 * localStorage. The default 7-department taxonomy seeds itself the first
 * time this loads for a tenant with no folders yet.
 */
export function FolderExplorerPage() {
  const { data: folders = [], isLoading } = useDocumentFolders();
  const updateFolder = useUpdateFolder();
  const createFolder = useCreateFolder();
  const deleteFolder = useDeleteFolder();

  const [activeDeptId, setActiveDeptId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [search, setSearch] = useState("");
  const [dragged, setDragged] = useState<{ id: number; kind: "folder" | "doc" } | null>(null);
  const [dropHoverId, setDropHoverId] = useState<number | null>(null);
  const [newFolderName, setNewFolderName] = useState("");

  const byParent = useMemo(() => {
    const map = new Map<number | null, DocumentFolder[]>();
    for (const f of folders) {
      const list = map.get(f.parentId) ?? [];
      list.push(f);
      map.set(f.parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
    return map;
  }, [folders]);

  const departments = byParent.get(null) ?? [];
  const activeDept = departments.find((d) => d.id === activeDeptId) ?? departments[0];

  function countsFor(deptId: number) {
    const subs = byParent.get(deptId) ?? [];
    const docs = subs.reduce((sum, s) => sum + (byParent.get(s.id)?.length ?? 0), 0);
    return { subs: subs.length, docs };
  }

  function moveDoc(docId: number, newFolderId: number) {
    updateFolder.mutate({ id: docId, parentId: newFolderId });
  }
  function moveFolder(folderId: number, newDeptId: number) {
    updateFolder.mutate({ id: folderId, parentId: newDeptId });
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading folder tree…</p>;
  if (!activeDept) return <p className="text-sm text-muted-foreground">No departments found.</p>;

  const query = search.trim().toLowerCase();
  const deptColorIndex = departments.findIndex((d) => d.id === activeDept.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Document Folders</h1>
          <p className="text-sm text-muted-foreground">Drag a document onto a different folder, or a folder header onto a different department.</p>
        </div>
        <div className="w-56">
          <TextField label="" placeholder="Filter documents…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <nav className="flex flex-col gap-1 rounded-lg border border-border bg-card p-2">
          {departments.map((dept, i) => {
            const counts = countsFor(dept.id);
            const color = DEPARTMENT_COLORS[i % DEPARTMENT_COLORS.length];
            return (
              <button
                key={dept.id}
                onClick={() => setActiveDeptId(dept.id)}
                onDragOver={(e) => {
                  if (dragged?.kind === "folder") {
                    e.preventDefault();
                    setDropHoverId(dept.id);
                  }
                }}
                onDragLeave={() => setDropHoverId((h) => (h === dept.id ? null : h))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropHoverId(null);
                  if (dragged?.kind === "folder") moveFolder(dragged.id, dept.id);
                  setDragged(null);
                }}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
                  dept.id === activeDept.id ? "bg-primary/10 font-medium" : "hover:bg-muted"
                } ${dropHoverId === dept.id ? "ring-2 ring-primary" : ""}`}
              >
                <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: color }} />
                <span className="flex-1">{dept.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {counts.subs}/{counts.docs}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 flex-none rounded-full" style={{ backgroundColor: DEPARTMENT_COLORS[deptColorIndex % DEPARTMENT_COLORS.length] }} />
            <h2 className="text-lg font-semibold">{activeDept.name}</h2>
          </div>

          {(byParent.get(activeDept.id) ?? []).map((sub) => {
            const docs = (byParent.get(sub.id) ?? []).filter((d) => !query || d.name.toLowerCase().includes(query));
            const isCollapsed = collapsed[sub.id];
            const isDropTarget = dropHoverId === sub.id;
            return (
              <div key={sub.id} className={`overflow-hidden rounded-lg border bg-card ${isDropTarget ? "border-primary ring-2 ring-primary" : "border-border"}`}>
                <div
                  className="flex cursor-grab items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 active:cursor-grabbing"
                  draggable
                  onDragStart={() => setDragged({ id: sub.id, kind: "folder" })}
                  onDragEnd={() => setDragged(null)}
                  onClick={() => setCollapsed((c) => ({ ...c, [sub.id]: !c[sub.id] }))}
                  onDragOver={(e) => {
                    if (dragged?.kind === "doc") {
                      e.preventDefault();
                      setDropHoverId(sub.id);
                    }
                  }}
                  onDragLeave={() => setDropHoverId((h) => (h === sub.id ? null : h))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropHoverId(null);
                    if (dragged?.kind === "doc") moveDoc(dragged.id, sub.id);
                    setDragged(null);
                  }}
                >
                  <span className="text-xs text-muted-foreground">{isCollapsed ? "▸" : "▾"}</span>
                  <span className="flex-1 text-sm font-semibold">{sub.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{(byParent.get(sub.id) ?? []).length}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete "${sub.name}"? This only works if it's empty.`)) deleteFolder.mutate(sub.id);
                    }}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${sub.name}`}
                  >
                    ×
                  </button>
                </div>
                {!isCollapsed && (
                  <div className="flex flex-wrap gap-2 p-3">
                    {docs.length === 0 && <span className="text-xs italic text-muted-foreground">No documents yet — drop one here</span>}
                    {docs.map((doc) => (
                      <span
                        key={doc.id}
                        draggable
                        onDragStart={() => setDragged({ id: doc.id, kind: "doc" })}
                        onDragEnd={() => setDragged(null)}
                        className="inline-flex cursor-grab items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs active:cursor-grabbing"
                      >
                        {doc.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <form
            className="flex items-center gap-2 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newFolderName.trim()) return;
              createFolder.mutate({ name: newFolderName.trim(), parentId: activeDept.id });
              setNewFolderName("");
            }}
          >
            <div className="max-w-xs flex-1">
              <TextField label="" placeholder="New folder name…" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} />
            </div>
            <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
              + Add folder to {activeDept.name}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
