import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { contentRoot, departmentForFolder, folderChain, leftHandFolders, listFolder, openTarget, visibleExplorerFolders } from "../../lib/folderBrowse";
import { Paperclip, FileText, Download, X, Inbox, UploadCloud, GripVertical } from "lucide-react";
import { apiClient } from "../../api/client";
import { TextField } from "../../components/forms/Field";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { FileDropZone, isFileDrag } from "../../components/shared/FileDropZone";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { InAppFilePreview, type PreviewRequest } from "../../components/shared/InAppFilePreview";
import { onlyOfficeFile, previewKind, saveBytes } from "../../lib/filePreview";
import { folderMoveIsBlocked, nextSortOrder } from "../../lib/folderMove";

const DRAG_FOLDER = "application/x-accuqual-folder";
const DRAG_DOC = "application/x-accuqual-doc";

interface DocumentFolder {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  pdfPath: string | null;
  pdfMimeType?: string | null;
  linkedPath: string | null;
  documentId: number | null;
  /** Only present when documentId is set — joined server-side, see document-folders.controller.ts's withLinkedDocumentInfo. */
  documentStatus?: "draft" | "in_review" | "approved" | "obsolete";
  documentExpirationStatus?: "expired" | "expiring_soon" | null;
}

const LIBRARY_POOL_NAME = "Library Pool";

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

function useUploadTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      return (await apiClient.post<DocumentFolder>(`/document-folders/${id}/template`, form)).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document-folders"] }),
  });
}

function useRemoveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await apiClient.delete<DocumentFolder>(`/document-folders/${id}/template`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document-folders"] }),
  });
}

/** The one-step "upload a document into this folder" action — see document-folders.controller.ts's uploadDocument for why this is a single request, not create-then-attach. */
function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ parentId, file }: { parentId: number; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      form.append("parentId", String(parentId));
      return (await apiClient.post<DocumentFolder>("/document-folders/upload", form)).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["document-folders"] }),
  });
}

/**
 * Real, persisted version of the folder-tree tool built earlier as a
 * standalone artifact — same 3-tier shape (department -> folder -> document
 * type) and the same drag-and-drop interactions, now backed by
 * `document_folders` (services/api/src/modules/document-folders/) instead of
 * localStorage, plus (this pass): a Library Pool shelf that removed forms
 * land in instead of disappearing, and per-document PDF attach/view/remove.
 * The default 7-department taxonomy seeds itself the first time this loads
 * for a company with no folders yet; the Library Pool self-heals every load.
 * Blank templates are not listed here. They stay on Blank Forms and QMS Forms.
 * This page lists the folder and the forms or files that were saved into it.
 */
export function FolderExplorerPage() {
  const { data: folders = [], isLoading } = useDocumentFolders();
  const visibleFolders = useMemo(() => visibleExplorerFolders(folders), [folders]);
  const updateFolder = useUpdateFolder();
  const createFolder = useCreateFolder();
  const deleteFolder = useDeleteFolder();
  const uploadTemplate = useUploadTemplate();
  const uploadDocument = useUploadDocument();
  const removeTemplate = useRemoveTemplate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  /** Files dropped from the desktop become real controlled documents in the target folder, one request each. */
  async function uploadFiles(parentId: number, files: File[]) {
    let uploaded = 0;
    for (const file of files) {
      try {
        await uploadDocument.mutateAsync({ parentId, file });
        uploaded += 1;
      } catch (err) {
        toast.error(`${file.name}: ${await extractErrorMessageAsync(err, "couldn't upload")}`);
      }
    }
    if (uploaded > 0) toast.success(uploaded === 1 ? "Document uploaded." : `${uploaded} documents uploaded.`);
  }

  const [activeDeptId, setActiveDeptId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [search, setSearch] = useState("");
  const dragRef = useRef<{ id: number; kind: "folder" | "doc" } | null>(null);
  const [dropHoverId, setDropHoverId] = useState<number | null>(null);
  const [poolHover, setPoolHover] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadTarget = useRef<number | null>(null);
  const uploadDocInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadParent = useRef<number | null>(null);

  const byParent = useMemo(() => {
    const map = new Map<number | null, DocumentFolder[]>();
    for (const f of visibleFolders) {
      const list = map.get(f.parentId) ?? [];
      list.push(f);
      map.set(f.parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
    return map;
  }, [visibleFolders]);

  const topLevel = byParent.get(null) ?? [];
  const poolFolder = topLevel.find((f) => f.name === LIBRARY_POOL_NAME);
  const isoRoot = contentRoot(visibleFolders);
  const departments = leftHandFolders(visibleFolders);
  const poolItems = poolFolder ? byParent.get(poolFolder.id) ?? [] : [];
  const shelfParentId = isoRoot?.id ?? null;

  // Deep link from the nav bar's dynamic Documents dropdown (?dept=<id>).
  // Deliberately depends on folders.length (a stable proxy) instead of
  // `departments` itself, which is a new array reference every render and
  // would re-fire this on every render if listed directly.
  useEffect(() => {
    const folderParam = searchParams.get("folder");
    if (folderParam && /^\d+$/.test(folderParam)) {
      const dept = departmentForFolder(folders, Number(folderParam));
      if (dept) setActiveDeptId(dept.id);
      return;
    }
    const deptParam = searchParams.get("dept");
    if (deptParam && folders.some((folder) => folder.id === Number(deptParam))) {
      setActiveDeptId(Number(deptParam));
    }
  }, [searchParams, folders.length]);

  const activeDept =
    (isoRoot && activeDeptId === isoRoot.id ? isoRoot : undefined) ?? departments.find((d) => d.id === activeDeptId) ?? departments[0] ?? isoRoot;

  function countsFor(deptId: number) {
    const subs = byParent.get(deptId) ?? [];
    const docs = subs.reduce((sum, sub) => {
      const listing = listFolder(visibleFolders, sub.id);
      return sum + listing.folders.length + listing.files.length;
    }, 0);
    return { subs: subs.length, docs };
  }

  function beginDrag(event: DragEvent, id: number, kind: "folder" | "doc") {
    dragRef.current = { id, kind };
    event.dataTransfer.setData(kind === "folder" ? DRAG_FOLDER : DRAG_DOC, String(id));
    event.dataTransfer.effectAllowed = "move";
  }
  function endDrag() {
    dragRef.current = null;
    setDropHoverId(null);
    setPoolHover(false);
  }
  function allowDrop(event: DragEvent, targetParentId: number | null) {
    const drag = dragRef.current;
    if (!drag || isFileDrag(event)) return false;
    if (drag.kind === "doc") {
      if (targetParentId === null) {
        event.stopPropagation();
        return false;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      return true;
    }
    if (folderMoveIsBlocked(folders, drag.id, targetParentId)) {
      event.stopPropagation();
      event.dataTransfer.dropEffect = "none";
      return false;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    return true;
  }
  async function moveDoc(docId: number, newFolderId: number) {
    const current = folders.find((folder) => folder.id === docId);
    if (!current || current.parentId === newFolderId) return;
    try {
      await updateFolder.mutateAsync({ id: docId, parentId: newFolderId, sortOrder: nextSortOrder(folders, newFolderId, docId) });
    } catch (err) {
      toast.error(await extractErrorMessageAsync(err, "Couldn't move that document"));
    }
  }
  async function moveFolder(folderId: number, newParentId: number | null) {
    const current = folders.find((folder) => folder.id === folderId);
    if (!current || current.parentId === newParentId) return;
    if (folderMoveIsBlocked(folders, folderId, newParentId)) return;
    try {
      await updateFolder.mutateAsync({ id: folderId, parentId: newParentId, sortOrder: nextSortOrder(folders, newParentId, folderId) });
    } catch (err) {
      toast.error(await extractErrorMessageAsync(err, "Couldn't move that folder"));
    }
  }
  function dropOn(event: DragEvent, targetParentId: number | null) {
    event.preventDefault();
    event.stopPropagation();
    const drag = dragRef.current;
    if (drag?.kind === "doc" && targetParentId !== null) void moveDoc(drag.id, targetParentId);
    else if (drag?.kind === "folder" && !folderMoveIsBlocked(folders, drag.id, targetParentId)) void moveFolder(drag.id, targetParentId);
    endDrag();
  }
  function sendToLibrary(docId: number) {
    if (poolFolder) moveDoc(docId, poolFolder.id);
  }
  function requestUpload(docId: number) {
    pendingUploadTarget.current = docId;
    fileInputRef.current?.click();
  }
  function requestDocumentUpload(parentId: number) {
    pendingUploadParent.current = parentId;
    uploadDocInputRef.current?.click();
  }

  function showFolder(id: number) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("folder", String(id));
      const dept = departmentForFolder(folders, id);
      if (dept) next.set("dept", String(dept.id));
      return next;
    });
  }

  function showDepartmentList() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("folder");
      return next;
    });
  }

  const folderParam = searchParams.get("folder");
  const requestedFolderId = folderParam != null && /^\d+$/.test(folderParam) ? Number(folderParam) : null;
  const openFolder = requestedFolderId == null ? undefined : visibleFolders.find((folder) => folder.id === requestedFolderId);
  const hiddenBlank = requestedFolderId != null && !openFolder && folders.some((folder) => folder.id === requestedFolderId);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading folder tree…</p>;
  if (!activeDept) return <p className="text-sm text-muted-foreground">No departments found.</p>;

  const query = search.trim().toLowerCase();
  const deptColorIndex = departments.findIndex((d) => d.id === activeDept.id);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <input
        ref={uploadDocInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const parentId = pendingUploadParent.current;
          if (file && parentId != null) uploadDocument.mutate({ parentId, file });
          e.target.value = "";
          pendingUploadParent.current = null;
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const targetId = pendingUploadTarget.current;
          if (file && targetId != null) uploadTemplate.mutate({ id: targetId, file });
          e.target.value = "";
          pendingUploadTarget.current = null;
        }}
      />

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Document Folders</h1>
          <p className="text-sm text-muted-foreground">
            ISO Compliance Documents is the top folder. Engineering, Quality, and the other departments stay in the list on the left. A folder shows its name and the forms or files saved into it. Start a new blank from Blank Forms. Drag a folder onto another folder to move it, or onto Top level. Drag a saved document onto a folder to file it there, or into the Library Pool to take it out.
          </p>
        </div>
        <div className="w-56">
          <TextField label="" placeholder="Filter documents…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-[220px_minmax(0,1fr)] md:overflow-hidden">
        <nav className="flex flex-col gap-1 rounded-lg border border-border bg-card p-2 md:min-h-0 md:overflow-y-auto">
          {isoRoot && (
            <button
              type="button"
              data-testid="iso-root"
              onClick={() => {
                setActiveDeptId(isoRoot.id);
                setSearchParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set("dept", String(isoRoot.id));
                  next.delete("folder");
                  return next;
                });
              }}
              className={`rounded-md px-3 py-2 text-left text-sm font-medium ${activeDept?.id === isoRoot.id ? "bg-primary/10" : "hover:bg-muted"}`}
            >
              {isoRoot.name}
            </button>
          )}
          {departments.map((dept, i) => {
            const counts = countsFor(dept.id);
            const color = DEPARTMENT_COLORS[i % DEPARTMENT_COLORS.length];
            return (
              <button
                key={dept.id}
                draggable
                data-folder-id={dept.id}
                onClick={() => {
                  setActiveDeptId(dept.id);
                  setSearchParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set("dept", String(dept.id));
                    next.delete("folder");
                    return next;
                  });
                }}
                onDragStart={(e) => beginDrag(e, dept.id, "folder")}
                onDragEnd={endDrag}
                onDragOver={(e) => {
                  if (isFileDrag(e)) {
                    e.preventDefault();
                    setDropHoverId(dept.id);
                    return;
                  }
                  if (allowDrop(e, dept.id)) setDropHoverId(dept.id);
                }}
                onDragLeave={() => setDropHoverId((h) => (h === dept.id ? null : h))}
                onDrop={(e) => {
                  if (isFileDrag(e)) {
                    e.preventDefault();
                    setDropHoverId(null);
                    void uploadFiles(dept.id, Array.from(e.dataTransfer.files));
                    endDrag();
                    return;
                  }
                  dropOn(e, dept.id);
                }}
                className={`flex cursor-grab items-center gap-2 rounded-md py-2 text-left text-sm transition-colors active:cursor-grabbing ${isoRoot ? "pr-3 pl-5" : "px-3"} ${
                  dept.id === activeDept.id ? "bg-primary/10 font-medium" : "hover:bg-muted"
                } ${dropHoverId === dept.id ? "ring-2 ring-primary" : ""}`}
              >
                <GripVertical size={14} className="text-muted-foreground" />
                <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: color }} />
                <span className="flex-1">{dept.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {counts.subs}/{counts.docs}
                </span>
              </button>
            );
          })}

          <div
            data-testid="folder-drop-root"
            onDragOver={(e) => {
              if (allowDrop(e, shelfParentId)) setDropHoverId(-1);
            }}
            onDragLeave={() => setDropHoverId((h) => (h === -1 ? null : h))}
            onDrop={(e) => dropOn(e, shelfParentId)}
            className={`rounded-md border border-dashed px-3 py-2 text-xs ${dropHoverId === -1 ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}
          >
            Top level
          </div>

          <form
            className="flex flex-col gap-1 border-t border-border pt-2 mt-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newFolderName.trim()) return;
              createFolder.mutate(isoRoot ? { name: newFolderName.trim(), parentId: isoRoot.id } : { name: newFolderName.trim() });
              setNewFolderName("");
            }}
          >
            <TextField label="" placeholder="New department…" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} />
            <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
              + Add department
            </button>
          </form>
        </nav>

        <div className="flex min-w-0 flex-col gap-3 md:min-h-0 md:overflow-y-auto">
          {requestedFolderId != null && !openFolder ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                {hiddenBlank ? "Blank templates are listed under Blank Forms. This folder shows saved work only." : "That folder is not in Documents."}
              </p>
              {hiddenBlank && (
                <Link to="/blank-forms" className="w-fit text-sm text-primary hover:underline">
                  Open Blank Forms
                </Link>
              )}
              <button type="button" onClick={showDepartmentList} className="w-fit text-sm text-primary hover:underline">
                Back to departments
              </button>
            </div>
          ) : openFolder ? (
            <FolderBrowser
              folder={openFolder}
              folders={visibleFolders}
              query={query}
              dropHoverId={dropHoverId}
              onOpenFolder={showFolder}
              onBackToDepartments={showDepartmentList}
              onBeginDrag={beginDrag}
              onEndDrag={endDrag}
              onAllowDrop={allowDrop}
              onDrop={dropOn}
              onHover={setDropHoverId}
              onUploadFiles={uploadFiles}
              onUploadClick={requestDocumentUpload}
              onCreateFolder={(name, parentId) => createFolder.mutate({ name, parentId })}
              onRename={(id, name) => updateFolder.mutate({ id, name })}
              onSendToLibrary={sendToLibrary}
              onAttach={requestUpload}
              onRemoveAttachment={(id) => removeTemplate.mutate(id)}
            />
          ) : (
          <>
          <div className="flex shrink-0 items-center gap-2">
            <span className="h-3 w-3 flex-none rounded-full" style={{ backgroundColor: DEPARTMENT_COLORS[deptColorIndex % DEPARTMENT_COLORS.length] }} />
            <h2 className="text-lg font-semibold">{activeDept.name}</h2>
            <button type="button" onClick={() => showFolder(activeDept.id)} className="text-xs text-primary hover:underline">
              Open
            </button>
            <button
              onClick={() => requestDocumentUpload(activeDept.id)}
              className="ml-1 flex items-center gap-1 rounded-md border border-primary px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
              title={`Upload a document directly into ${activeDept.name}`}
            >
              <UploadCloud size={13} />
              Upload Document
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete the "${activeDept.name}" department? Only works if it's empty.`)) deleteFolder.mutate(activeDept.id);
              }}
              className="ml-1 text-muted-foreground hover:text-destructive"
              aria-label={`Delete ${activeDept.name}`}
            >
              <X size={14} />
            </button>
          </div>

          <FileDropZone
            onFiles={(dropped) => void uploadFiles(activeDept.id, dropped)}
            overlay={false}
            className="shrink-0 rounded-lg border-2 border-dashed border-border px-4 py-3 text-center text-xs text-muted-foreground transition-colors hover:border-primary/50"
          >
            <span className="inline-flex items-center gap-2">
              <UploadCloud size={14} /> Drag files from your computer onto {activeDept.name}, or onto any folder below, to add them as documents
            </span>
          </FileDropZone>

          {(byParent.get(activeDept.id) ?? []).map((sub) => {
            const listing = listFolder(visibleFolders, sub.id);
            const subfolders = listing.folders.filter((row) => !query || row.name.toLowerCase().includes(query));
            const docs = listing.files.filter((row) => !query || row.name.toLowerCase().includes(query));
            const isCollapsed = collapsed[sub.id];
            const isDropTarget = dropHoverId === sub.id;
            return (
              <FileDropZone
                key={sub.id}
                onFiles={(dropped) => void uploadFiles(sub.id, dropped)}
                overlay={false}
                className={`shrink-0 overflow-hidden rounded-lg border bg-card transition-shadow ${isDropTarget ? "border-primary ring-2 ring-primary" : "border-border"}`}
              >
                <div
                  className="flex cursor-grab items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 active:cursor-grabbing"
                  draggable
                  data-folder-id={sub.id}
                  onDragStart={(e) => {
                    e.stopPropagation();
                    beginDrag(e, sub.id, "folder");
                  }}
                  onDragEnd={endDrag}
                  onClick={() => setCollapsed((c) => ({ ...c, [sub.id]: !c[sub.id] }))}
                  onDragOver={(e) => {
                    if (isFileDrag(e)) return;
                    if (allowDrop(e, sub.id)) {
                      e.stopPropagation();
                      setDropHoverId(sub.id);
                    }
                  }}
                  onDragLeave={() => setDropHoverId((h) => (h === sub.id ? null : h))}
                  onDrop={(e) => {
                    if (isFileDrag(e)) {
                      e.preventDefault();
                      e.stopPropagation();
                      void uploadFiles(sub.id, Array.from(e.dataTransfer.files));
                      return;
                    }
                    dropOn(e, sub.id);
                  }}
                >
                  <GripVertical size={14} className="text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{isCollapsed ? "▸" : "▾"}</span>
                  <span className="flex-1 text-sm font-semibold" data-testid="folder-title">
                    {sub.name}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      showFolder(sub.id);
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    Open
                  </button>
                  <span className="font-mono text-[10px] text-muted-foreground">{subfolders.length + docs.length}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      requestDocumentUpload(sub.id);
                    }}
                    className="text-muted-foreground hover:text-primary"
                    aria-label={`Upload a document into ${sub.name}`}
                    title={`Upload a document into ${sub.name}`}
                  >
                    <UploadCloud size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete "${sub.name}"? This only works if it's empty.`)) deleteFolder.mutate(sub.id);
                    }}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${sub.name}`}
                  >
                    <X size={13} />
                  </button>
                </div>
                {!isCollapsed && (
                  <div
                    className="flex flex-col gap-3 p-3"
                    onDragOver={(e) => {
                      if (allowDrop(e, sub.id)) setDropHoverId(sub.id);
                    }}
                    onDrop={(e) => {
                      if (isFileDrag(e)) return;
                      dropOn(e, sub.id);
                    }}
                  >
                    {subfolders.length === 0 && docs.length === 0 && <span className="text-xs italic text-muted-foreground">{query ? "Nothing in this folder matches." : "Nothing saved here yet."}</span>}
                    {subfolders.map((row) => (
                      <div
                        key={row.id}
                        data-testid="folder-row"
                        data-folder-id={row.id}
                        draggable
                        onDragStart={(event) => {
                          event.stopPropagation();
                          beginDrag(event, row.id, "folder");
                        }}
                        onDragEnd={endDrag}
                        onDragOver={(event) => {
                          if (isFileDrag(event)) return;
                          if (allowDrop(event, row.id)) {
                            event.stopPropagation();
                            setDropHoverId(row.id);
                          }
                        }}
                        onDragLeave={() => setDropHoverId((current) => (current === row.id ? null : current))}
                        onDrop={(event) => {
                          if (isFileDrag(event)) {
                            event.preventDefault();
                            event.stopPropagation();
                            void uploadFiles(row.id, Array.from(event.dataTransfer.files));
                            return;
                          }
                          dropOn(event, row.id);
                        }}
                        className={`flex items-center gap-2 rounded-md px-2 py-2 ${dropHoverId === row.id ? "bg-primary/10 ring-2 ring-primary" : "hover:bg-muted"}`}
                      >
                        <GripVertical size={14} className="text-muted-foreground" />
                        <button type="button" onClick={() => showFolder(row.id)} className="flex-1 text-left text-sm font-medium" data-testid="folder-title">
                          {row.name}
                        </button>
                        <span className="text-xs text-muted-foreground">Folder</span>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                    {docs.map((doc) => {
                      const target = openTarget(doc);
                      if (target) {
                        return (
                          <Link
                            key={doc.id}
                            to={target}
                            data-testid="saved-file"
                            draggable
                            onDragStart={(event) => {
                              event.stopPropagation();
                              beginDrag(event, doc.id, "doc");
                            }}
                            onDragEnd={endDrag}
                            className="inline-flex cursor-grab items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary hover:underline active:cursor-grabbing"
                          >
                            <FileText size={12} />
                            {doc.name}
                          </Link>
                        );
                      }
                      return (
                      <DocPill
                        key={doc.id}
                        doc={doc}
                        onDragStart={(e) => beginDrag(e, doc.id, "doc")}
                        onDragEnd={endDrag}
                        onSendToLibrary={() => sendToLibrary(doc.id)}
                        onAttach={() => requestUpload(doc.id)}
                        onRemoveAttachment={() => removeTemplate.mutate(doc.id)}
                      />
                      );
                    })}
                    </div>
                  </div>
                )}
              </FileDropZone>
            );
          })}

          <form
            className="flex shrink-0 items-center gap-2 pt-1"
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
          </>
          )}
        </div>
      </div>

      {/* In normal flow under the folder library, so the shelf stays on screen
          without covering Forms & Templates or any other folder card. The
          folder column scrolls on its own. */}
      {poolFolder && (
        <div
          onDragOver={(e) => {
            if (dragRef.current?.kind === "doc" && allowDrop(e, poolFolder.id)) setPoolHover(true);
          }}
          onDragLeave={() => setPoolHover(false)}
          onDrop={(e) => {
            if (dragRef.current?.kind !== "doc") return;
            setPoolHover(false);
            dropOn(e, poolFolder.id);
          }}
          className={`shrink-0 rounded-lg border bg-card transition-colors ${
            poolHover ? "border-primary ring-1 ring-inset ring-primary" : "border-border"
          }`}
        >
          <div className="flex items-start gap-3 px-4 py-3">
            <Inbox size={16} className="mt-0.5 flex-none text-muted-foreground" />
            <span className="mt-0.5 flex-none text-sm font-medium">Library Pool</span>
            <span className="mt-0.5 flex-none rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{poolItems.length}</span>
            <div className="flex max-h-28 min-w-0 flex-1 flex-wrap gap-2 overflow-y-auto">
              {poolItems.length === 0 && <span className="text-xs italic text-muted-foreground">Empty — drag a document here to unassign it</span>}
              {poolItems.map((doc) => (
                <DocPill
                  key={doc.id}
                  doc={doc}
                  onDragStart={(e) => beginDrag(e, doc.id, "doc")}
                  onDragEnd={endDrag}
                  onAttach={() => requestUpload(doc.id)}
                  onRemoveAttachment={() => removeTemplate.mutate(doc.id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DocPill({
  doc,
  onDragStart,
  onDragEnd,
  onSendToLibrary,
  onAttach,
  onRemoveAttachment,
}: {
  doc: DocumentFolder;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  onSendToLibrary?: () => void;
  onAttach: () => void;
  onRemoveAttachment: () => void;
}) {
  const [preview, setPreview] = useState<PreviewRequest | null>(null);

  function attachedFileName() {
    const ext = doc.pdfPath?.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
    if (!ext || doc.name.toLowerCase().endsWith(ext.toLowerCase())) return doc.name;
    return `${doc.name}${ext}`;
  }

  async function downloadAttachment() {
    const res = await apiClient.get(`/document-folders/${doc.id}/template`, { responseType: "blob" });
    saveBytes(res.data as Blob, attachedFileName(), doc.pdfMimeType ?? undefined);
  }

  function viewAttachment() {
    const fileName = attachedFileName();
    const kind = previewKind(fileName, doc.pdfMimeType);
    if (kind === "download") {
      void downloadAttachment();
      return;
    }
    setPreview({
      fileName,
      mimeType: doc.pdfMimeType,
      loadBytes: async () => (await apiClient.get(`/document-folders/${doc.id}/template`, { responseType: "arraybuffer" })).data as ArrayBuffer,
      officeSource: onlyOfficeFile(fileName, doc.pdfMimeType) ? { kind: "folder", folderId: doc.id } : undefined,
      download: downloadAttachment,
    });
  }

  return (
    <span
      draggable
      onDragStart={(event) => {
        event.stopPropagation();
        onDragStart(event);
      }}
      onDragEnd={onDragEnd}
      className={`inline-flex cursor-grab items-center gap-1.5 rounded-full border px-3 py-1 text-xs active:cursor-grabbing ${
        doc.linkedPath ? "border-primary/40 bg-primary/10" : "border-border bg-muted"
      }`}
      title={doc.pdfPath ? "Has an attached file — click the file icon to view/download it" : "No file attached yet"}
    >
      {doc.linkedPath ? (
        <Link to={doc.linkedPath} draggable={false} className="text-primary hover:underline" title="Open">
          {doc.name}
        </Link>
      ) : (
        doc.name
      )}
      {doc.documentId && (
        <Link to={`/documents/${doc.documentId}`} draggable={false} className="hover:opacity-80" title="Open the controlled document (revision history, approval, retention)">
          <StatusBadge value={doc.documentExpirationStatus ?? doc.documentStatus ?? "draft"} />
        </Link>
      )}
      {doc.pdfPath ? (
        <>
          <button onClick={viewAttachment} className="text-primary hover:opacity-80" aria-label={`View attached file for ${doc.name}`}>
            <FileText size={12} />
          </button>
          <button onClick={() => void downloadAttachment()} className="text-muted-foreground hover:text-primary" aria-label={`Download attached file for ${doc.name}`}>
            <Download size={12} />
          </button>
          <button onClick={onRemoveAttachment} className="text-muted-foreground hover:text-destructive" aria-label={`Remove attached file for ${doc.name}`}>
            <X size={11} />
          </button>
          <InAppFilePreview request={preview} onClose={() => setPreview(null)} />
        </>
      ) : (
        <button onClick={onAttach} className="text-muted-foreground hover:text-primary" aria-label={`Attach a file to ${doc.name}`}>
          <Paperclip size={12} />
        </button>
      )}
      {onSendToLibrary && (
        <button onClick={onSendToLibrary} className="text-muted-foreground hover:text-destructive" aria-label={`Send ${doc.name} to the library pool`}>
          <Inbox size={12} />
        </button>
      )}
    </span>
  );
}

function FolderBrowser({
  folder,
  folders,
  query,
  dropHoverId,
  onOpenFolder,
  onBackToDepartments,
  onBeginDrag,
  onEndDrag,
  onAllowDrop,
  onDrop,
  onHover,
  onUploadFiles,
  onUploadClick,
  onCreateFolder,
  onRename,
  onSendToLibrary,
  onAttach,
  onRemoveAttachment,
}: {
  folder: DocumentFolder;
  folders: DocumentFolder[];
  query: string;
  dropHoverId: number | null;
  onOpenFolder: (id: number) => void;
  onBackToDepartments: () => void;
  onBeginDrag: (event: DragEvent, id: number, kind: "folder" | "doc") => void;
  onEndDrag: () => void;
  onAllowDrop: (event: DragEvent, targetParentId: number | null) => boolean;
  onDrop: (event: DragEvent, targetParentId: number | null) => void;
  onHover: (id: number | null) => void;
  onUploadFiles: (parentId: number, files: File[]) => Promise<void>;
  onUploadClick: (parentId: number) => void;
  onCreateFolder: (name: string, parentId: number) => void;
  onRename: (id: number, name: string) => void;
  onSendToLibrary: (id: number) => void;
  onAttach: (id: number) => void;
  onRemoveAttachment: (id: number) => void;
}) {
  const [name, setName] = useState("");
  const [rename, setRename] = useState(folder.name);
  const [renaming, setRenaming] = useState(false);
  useEffect(() => {
    setRenaming(false);
    setRename(folder.name);
  }, [folder.id, folder.name]);
  const chain = folderChain(folders, folder.id);
  const listing = listFolder(folders, folder.id);
  const parent = chain.length > 1 ? chain[chain.length - 2] : undefined;
  const subfolders = listing.folders.filter((row) => !query || row.name.toLowerCase().includes(query));
  const files = listing.files.filter((row) => !query || row.name.toLowerCase().includes(query));
  const empty = subfolders.length === 0 && files.length === 0;
  const canRename = folder.name !== LIBRARY_POOL_NAME;

  return (
    <div className="flex flex-col gap-3" data-testid="folder-browser">
      <nav aria-label="Folder path" data-testid="folder-breadcrumbs" className="flex flex-wrap items-center gap-1 text-sm">
        <button type="button" onClick={onBackToDepartments} className="text-primary hover:underline">
          Documents
        </button>
        {chain.map((crumb, index) => (
          <span key={crumb.id} className="inline-flex items-center gap-1">
            <span className="text-muted-foreground">/</span>
            {index === chain.length - 1 ? (
              <span className="font-semibold" data-testid="folder-title">
                {crumb.name}
              </span>
            ) : (
              <button type="button" onClick={() => onOpenFolder(crumb.id)} className="text-primary hover:underline">
                {crumb.name}
              </button>
            )}
          </span>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => (parent ? onOpenFolder(parent.id) : onBackToDepartments())}
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          Up
        </button>
        <button
          type="button"
          onClick={() => onUploadClick(folder.id)}
          className="flex items-center gap-1 rounded-md border border-primary px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
        >
          <UploadCloud size={13} />
          Upload Document
        </button>
        {canRename && !renaming && (
          <button
            type="button"
            onClick={() => {
              setRename(folder.name);
              setRenaming(true);
            }}
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            Rename
          </button>
        )}
      </div>

      {canRename && renaming && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const next = rename.trim();
            if (!next || next === folder.name) {
              setRenaming(false);
              return;
            }
            onRename(folder.id, next);
            setRenaming(false);
          }}
        >
          <div className="w-full max-w-xs">
            <TextField label="Folder name" value={rename} onChange={(event) => setRename(event.target.value)} />
          </div>
          <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
            Save name
          </button>
          <button type="button" onClick={() => setRenaming(false)} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
            Cancel
          </button>
        </form>
      )}

      <FileDropZone
        onFiles={(dropped) => void onUploadFiles(folder.id, dropped)}
        overlay={false}
        className="shrink-0 rounded-lg border-2 border-dashed border-border px-4 py-3 text-center text-xs text-muted-foreground transition-colors hover:border-primary/50"
      >
        <span className="inline-flex items-center gap-2">
          <UploadCloud size={14} /> Drag files from your computer onto {folder.name} to add them as documents
        </span>
      </FileDropZone>

      <div
        className="flex flex-col gap-1 rounded-lg border border-border bg-card p-2"
        data-testid="folder-contents"
        onDragOver={(event) => {
          if (onAllowDrop(event, folder.id)) onHover(folder.id);
        }}
        onDrop={(event) => {
          if (isFileDrag(event)) return;
          onDrop(event, folder.id);
        }}
      >
        {empty && <p className="px-2 py-3 text-sm italic text-muted-foreground">{query ? "Nothing in this folder matches." : "Nothing saved in this folder yet."}</p>}
        {subfolders.map((row) => (
          <div
            key={row.id}
            data-testid="folder-row"
            data-folder-id={row.id}
            draggable
            onDragStart={(event) => {
              event.stopPropagation();
              onBeginDrag(event, row.id, "folder");
            }}
            onDragEnd={onEndDrag}
            onDragOver={(event) => {
              if (isFileDrag(event)) return;
              if (onAllowDrop(event, row.id)) {
                event.stopPropagation();
                onHover(row.id);
              }
            }}
            onDragLeave={() => onHover(dropHoverId === row.id ? null : dropHoverId)}
            onDrop={(event) => {
              if (isFileDrag(event)) {
                event.preventDefault();
                event.stopPropagation();
                void onUploadFiles(row.id, Array.from(event.dataTransfer.files));
                return;
              }
              onDrop(event, row.id);
            }}
            className={`flex items-center gap-2 rounded-md px-2 py-2 ${dropHoverId === row.id ? "bg-primary/10 ring-2 ring-primary" : "hover:bg-muted"}`}
          >
            <GripVertical size={14} className="text-muted-foreground" />
            <button type="button" onClick={() => onOpenFolder(row.id)} className="flex-1 text-left text-sm font-medium" data-testid="folder-title">
              {row.name}
            </button>
            <span className="text-xs text-muted-foreground">Folder</span>
          </div>
        ))}
        {files.map((file) => {
          const target = openTarget(file);
          if (!target) {
            return (
              <div key={file.id} data-testid="file-row" className="px-2 py-1">
                <DocPill
                  doc={file}
                  onDragStart={(event) => onBeginDrag(event, file.id, "doc")}
                  onDragEnd={onEndDrag}
                  onSendToLibrary={() => onSendToLibrary(file.id)}
                  onAttach={() => onAttach(file.id)}
                  onRemoveAttachment={() => onRemoveAttachment(file.id)}
                />
              </div>
            );
          }
          return (
            <Link
              key={file.id}
              to={target}
              data-testid={`open-file-${file.id}`}
              draggable
              onDragStart={(event) => {
                event.stopPropagation();
                onBeginDrag(event, file.id, "doc");
              }}
              onDragEnd={onEndDrag}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted"
            >
              <FileText size={14} className="text-primary" />
              <span className="flex-1 text-primary">{file.name}</span>
              <span className="text-xs text-muted-foreground">Open</span>
            </Link>
          );
        })}
      </div>

      <form
        className="flex shrink-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          onCreateFolder(name.trim(), folder.id);
          setName("");
        }}
      >
        <div className="max-w-xs flex-1">
          <TextField label="" placeholder="New folder name…" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
          + Add folder to {folder.name}
        </button>
      </form>
    </div>
  );
}
