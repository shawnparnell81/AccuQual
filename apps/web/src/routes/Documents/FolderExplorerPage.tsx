import { useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { contentRoot, departmentForFolder, FAI_VALIDATION_FOLDER_NAME, folderChain, folderIdByName, isFolderEntry, leftHandFolders, listFolder, openTarget, visibleExplorerFolders } from "../../lib/folderBrowse";
import { ValidationReportsPanel } from "../ValidationReports/ValidationReportsPanel";
import { ChevronDown, ChevronRight, Paperclip, FileText, Download, X, Inbox, UploadCloud, GripVertical, Folder, FolderOpen } from "lucide-react";
import { apiClient } from "../../api/client";
import { TextField } from "../../components/forms/Field";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { FileDropZone, isFileDrag } from "../../components/shared/FileDropZone";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { InAppFilePreview, type PreviewRequest } from "../../components/shared/InAppFilePreview";
import { onlyOfficeFile, previewKind, saveBytes } from "../../lib/filePreview";
import { paneScrollDelta } from "../../lib/dragAutoScroll";
import { folderMoveIsBlocked, planNest, planSiblingGap, planSiblingReorder, type NodePlacement } from "../../lib/folderMove";
import { dropPosition, reorderDropClass, type DropPosition } from "../../lib/listReorder";

const DRAG_FOLDER = "application/x-accuqual-folder";
const DRAG_DOC = "application/x-accuqual-doc";

type DragKind = "folder" | "doc";

function gapKey(parentId: number | null, targetId: number | null, kind: DragKind) {
  const position = targetId == null ? "after" : "before";
  return `${kind}:${parentId ?? "root"}:${position}:${targetId ?? "end"}`;
}

/** The empty strip between siblings. A line here means "place beside this row", not inside it. */
function SiblingGap({
  active,
  className,
  orientation = "row",
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  active: boolean;
  className: string;
  orientation?: "row" | "pill";
  onDragOver: (event: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent) => void;
}) {
  const line =
    orientation === "row"
      ? `h-0.5 w-full ${active ? "bg-primary shadow-[0_0_0_1px_hsl(var(--primary))]" : "bg-primary/40"}`
      : `h-4 w-0.5 ${active ? "bg-primary" : "bg-primary/40"}`;
  return (
    <div
      data-testid="sibling-drop-gap"
      data-drop-active={active ? "true" : "false"}
      className={`z-20 flex items-center justify-center ${className}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className={`pointer-events-none rounded-full ${line}`} />
    </div>
  );
}

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

function FolderTreeBranch({
  folder,
  depth,
  folders,
  selectedId,
  treeOpen,
  draggable,
  isoRoot,
  trailingGap,
  dragKind,
  gapHint,
  hintClass,
  onToggle,
  onSelect,
  onBeginDrag,
  onEndDrag,
  onHoverRow,
  onLeaveRow,
  onDropRow,
  onGapOver,
  onGapLeave,
  onGapDrop,
}: {
  folder: DocumentFolder;
  depth: number;
  folders: DocumentFolder[];
  selectedId: number | null;
  treeOpen: Record<number, boolean>;
  draggable: boolean;
  isoRoot: boolean;
  trailingGap: boolean;
  dragKind: DragKind | null;
  gapHint: string | null;
  hintClass: (id: number) => string;
  onToggle: (id: number) => void;
  onSelect: (folder: DocumentFolder) => void;
  onBeginDrag: (event: DragEvent, id: number, kind: DragKind) => void;
  onEndDrag: () => void;
  onHoverRow: (event: DragEvent, folder: DocumentFolder) => void;
  onLeaveRow: (id: number) => void;
  onDropRow: (event: DragEvent, folder: DocumentFolder) => void;
  onGapOver: (event: DragEvent, parentId: number | null, beforeId: number | null, kind: DragKind) => void;
  onGapLeave: (key: string) => void;
  onGapDrop: (event: DragEvent, parentId: number | null, beforeId: number | null, kind: DragKind) => void;
}) {
  const children = listFolder(folders, folder.id).folders;
  const open = treeOpen[folder.id] ?? isoRoot;
  const selected = selectedId === folder.id;
  const Icon = open && children.length > 0 ? FolderOpen : Folder;
  const showGaps = dragKind === "folder";
  const beforeKey = gapKey(folder.parentId, folder.id, "folder");
  const afterKey = gapKey(folder.parentId, null, "folder");
  return (
    <li className="relative">
      {showGaps && (
        <SiblingGap
          active={gapHint === beforeKey}
          className="absolute inset-x-1 -top-1.5 h-3"
          onDragOver={(event) => onGapOver(event, folder.parentId, folder.id, "folder")}
          onDragLeave={() => onGapLeave(beforeKey)}
          onDrop={(event) => onGapDrop(event, folder.parentId, folder.id, "folder")}
        />
      )}
      <div
        className={`group flex items-center rounded-md border-l-2 pr-1 text-sm ${
          selected ? "border-primary bg-primary/10 font-medium" : "border-transparent hover:bg-muted"
        } ${hintClass(folder.id)}`}
        style={{ paddingLeft: 4 + depth * 14 }}
        draggable={draggable}
        data-folder-id={draggable ? folder.id : undefined}
        data-testid={isoRoot ? "iso-root" : "folder-tree-row"}
        onDragStart={draggable ? (event) => onBeginDrag(event, folder.id, "folder") : undefined}
        onDragEnd={draggable ? onEndDrag : undefined}
        onDragOver={(event) => onHoverRow(event, folder)}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          onLeaveRow(folder.id);
        }}
        onDrop={(event) => onDropRow(event, folder)}
      >
        {children.length > 0 ? (
          <button
            type="button"
            className="grid h-7 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`}
            onClick={() => onToggle(folder.id)}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="h-7 w-6 shrink-0" aria-hidden />
        )}
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left" aria-current={selected ? "page" : undefined} onClick={() => onSelect(folder)}>
          <Icon size={15} className={selected ? "shrink-0 text-primary" : "shrink-0 text-muted-foreground"} />
          <span className="truncate">{folder.name}</span>
        </button>
        {draggable && <GripVertical size={12} className="mr-1 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-70" />}
      </div>
      {open && children.length > 0 && (
        <ul>
          {children.map((child, index) => (
            <FolderTreeBranch
              key={child.id}
              folder={child}
              depth={depth + 1}
              folders={folders}
              selectedId={selectedId}
              treeOpen={treeOpen}
              draggable
              isoRoot={false}
              trailingGap={index === children.length - 1}
              dragKind={dragKind}
              gapHint={gapHint}
              hintClass={hintClass}
              onToggle={onToggle}
              onSelect={onSelect}
              onBeginDrag={onBeginDrag}
              onEndDrag={onEndDrag}
              onHoverRow={onHoverRow}
              onLeaveRow={onLeaveRow}
              onDropRow={onDropRow}
              onGapOver={onGapOver}
              onGapLeave={onGapLeave}
              onGapDrop={onGapDrop}
            />
          ))}
        </ul>
      )}
      {showGaps && trailingGap && (
        <SiblingGap
          active={gapHint === afterKey}
          className="relative mx-1 mt-0.5 h-3"
          onDragOver={(event) => onGapOver(event, folder.parentId, null, "folder")}
          onDragLeave={() => onGapLeave(afterKey)}
          onDrop={(event) => onGapDrop(event, folder.parentId, null, "folder")}
        />
      )}
    </li>
  );
}

function useDragAutoScroll(panes: Array<RefObject<HTMLElement | null>>, dragKindRef: RefObject<DragKind | null>) {
  const panesRef = useRef(panes);
  panesRef.current = panes;
  useEffect(() => {
    let frame = 0;
    let x = 0;
    let y = 0;
    const tick = () => {
      frame = 0;
      if (!dragKindRef.current) return;
      let moving = false;
      for (const pane of panesRef.current) {
        const el = pane.current;
        if (!el) continue;
        const delta = paneScrollDelta(x, y, el.getBoundingClientRect(), getComputedStyle(el).overflowY, el.scrollHeight, el.clientHeight);
        if (delta !== 0) {
          el.scrollTop += delta;
          moving = true;
        }
      }
      if (moving) frame = requestAnimationFrame(tick);
    };
    const onDragOver = (event: globalThis.DragEvent) => {
      if (!dragKindRef.current) return;
      x = event.clientX;
      y = event.clientY;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("dragend", stop, true);
    window.addEventListener("drop", stop, true);
    return () => {
      stop();
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("dragend", stop, true);
      window.removeEventListener("drop", stop, true);
    };
  }, [dragKindRef]);
}

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
  const qc = useQueryClient();

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
  const [treeOpen, setTreeOpen] = useState<Record<number, boolean>>({});
  const [dropHint, setDropHint] = useState<{ id: number; position: DropPosition } | null>(null);
  const [gapHint, setGapHint] = useState<string | null>(null);
  const [dragKind, setDragKind] = useState<DragKind | null>(null);
  const [search, setSearch] = useState("");
  const dragRef = useRef<{ id: number; kind: DragKind } | null>(null);
  const dragKindRef = useRef<DragKind | null>(null);
  const treePaneRef = useRef<HTMLElement>(null);
  const listPaneRef = useRef<HTMLDivElement>(null);
  const boardPaneRef = useRef<HTMLDivElement>(null);
  const [dropHoverId, setDropHoverId] = useState<number | null>(null);
  const [poolHover, setPoolHover] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newDepartmentName, setNewDepartmentName] = useState("");
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
    const nameParam = searchParams.get("name");
    const namedId = nameParam ? folderIdByName(folders, nameParam) : null;
    const explicitId = folderParam && /^\d+$/.test(folderParam) ? Number(folderParam) : null;
    const targetId = explicitId ?? namedId;
    if (targetId != null) {
      const dept = departmentForFolder(folders, targetId);
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

  const folderParam = searchParams.get("folder");
  const nameParam = searchParams.get("name");
  const namedFolderId = nameParam ? folderIdByName(visibleFolders, nameParam) : null;
  const requestedFolderId = folderParam != null && /^\d+$/.test(folderParam) ? Number(folderParam) : namedFolderId;
  const openFolder = requestedFolderId == null ? undefined : visibleFolders.find((folder) => folder.id === requestedFolderId);
  const selectedTreeId = openFolder?.id ?? activeDept?.id ?? null;

  useEffect(() => {
    if (selectedTreeId == null) return;
    const chain = folderChain(visibleFolders, selectedTreeId);
    setTreeOpen((current) => {
      let changed = false;
      const next = { ...current };
      for (const crumb of chain.slice(0, -1)) {
        if (next[crumb.id] !== true) {
          next[crumb.id] = true;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [selectedTreeId, visibleFolders]);

  function beginDrag(event: DragEvent, id: number, kind: DragKind) {
    dragRef.current = { id, kind };
    dragKindRef.current = kind;
    event.dataTransfer.setData(kind === "folder" ? DRAG_FOLDER : DRAG_DOC, String(id));
    event.dataTransfer.effectAllowed = "move";
    // Paint the gap targets after the browser has started the drag. Updating
    // state inside dragstart can cancel the gesture.
    requestAnimationFrame(() => {
      if (dragKindRef.current === kind) setDragKind(kind);
    });
  }
  function endDrag() {
    dragRef.current = null;
    dragKindRef.current = null;
    setDragKind(null);
    setDropHoverId(null);
    setDropHint(null);
    setGapHint(null);
    setPoolHover(false);
  }
  useDragAutoScroll([treePaneRef, listPaneRef, boardPaneRef], dragKindRef);
  function hintClass(id: number) {
    if (dropHoverId === id) return "ring-2 ring-primary";
    if (dropHint?.id === id) return reorderDropClass(dropHint.position);
    return "";
  }
  function rowAllows(target: DocumentFolder, position: DropPosition) {
    const drag = dragRef.current;
    if (!drag || drag.id === target.id) return false;
    const moving = folders.find((folder) => folder.id === drag.id);
    if (!moving) return false;
    if (position === "inside") {
      if (!isFolderEntry(folders, target)) return false;
      return !folderMoveIsBlocked(folders, moving.id, target.id);
    }
    if (isFolderEntry(folders, moving) !== isFolderEntry(folders, target)) return false;
    if (isFolderEntry(folders, moving) && folderMoveIsBlocked(folders, moving.id, target.parentId)) return false;
    return true;
  }
  function hoverRow(event: DragEvent, target: DocumentFolder) {
    setGapHint((current) => (current == null ? current : null));
    if (isFileDrag(event)) {
      event.preventDefault();
      setDropHint(null);
      setDropHoverId(target.id);
      return;
    }
    const position = dropPosition(event.clientY, event.currentTarget.getBoundingClientRect().top, event.currentTarget.getBoundingClientRect().height, isFolderEntry(folders, target));
    if (!rowAllows(target, position)) {
      setDropHint((current) => (current?.id === target.id ? null : current));
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropHoverId(null);
    setDropHint({ id: target.id, position });
  }
  function leaveRow(id: number) {
    setDropHint((current) => (current?.id === id ? null : current));
    setDropHoverId((current) => (current === id ? null : current));
  }
  async function commitPlacements(placements: NodePlacement[] | null) {
    if (!placements || placements.length === 0) return;
    const changed = placements.filter((placement) => {
      const current = folders.find((folder) => folder.id === placement.id);
      return !current || current.parentId !== placement.parentId || current.sortOrder !== placement.sortOrder;
    });
    if (changed.length === 0) return;
    try {
      await Promise.all(
        changed.map((placement) => {
          const current = folders.find((folder) => folder.id === placement.id);
          const body: { sortOrder: number; parentId?: number | null } = { sortOrder: placement.sortOrder };
          if (!current || current.parentId !== placement.parentId) body.parentId = placement.parentId;
          return apiClient.patch(`/document-folders/${placement.id}`, body);
        }),
      );
    } catch (err) {
      toast.error(await extractErrorMessageAsync(err, "Couldn't rearrange that"));
    } finally {
      await qc.invalidateQueries({ queryKey: ["document-folders"] });
    }
  }
  function applyDrop(target: DocumentFolder, position: DropPosition) {
    const drag = dragRef.current;
    if (!drag || drag.id === target.id) return;
    const moving = folders.find((folder) => folder.id === drag.id);
    if (!moving) return;
    if (position === "inside") {
      void commitPlacements(planNest(folders, moving.id, target.id));
      return;
    }
    const movingIsFolder = isFolderEntry(folders, moving);
    if (movingIsFolder !== isFolderEntry(folders, target)) return;
    if (movingIsFolder && folderMoveIsBlocked(folders, moving.id, target.parentId)) return;
    const group = folders.filter((folder) => {
      if (folder.parentId !== target.parentId) return false;
      if (folder.name === LIBRARY_POOL_NAME) return false;
      return isFolderEntry(folders, folder) === movingIsFolder;
    });
    void commitPlacements(planSiblingReorder(group, moving.id, target.id, position, target.parentId));
  }
  function dropRow(event: DragEvent, target: DocumentFolder) {
    if (isFileDrag(event)) {
      event.preventDefault();
      event.stopPropagation();
      setDropHoverId(null);
      setDropHint(null);
      void uploadFiles(target.id, Array.from(event.dataTransfer.files));
      endDrag();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const position = dropPosition(event.clientY, event.currentTarget.getBoundingClientRect().top, event.currentTarget.getBoundingClientRect().height, isFolderEntry(folders, target));
    setDropHint(null);
    setDropHoverId(null);
    if (rowAllows(target, position)) applyDrop(target, position);
    endDrag();
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
  function dropOnParent(event: DragEvent, parentId: number | null) {
    event.preventDefault();
    event.stopPropagation();
    const drag = dragRef.current;
    if (drag && !(drag.kind === "doc" && parentId === null)) void commitPlacements(planNest(folders, drag.id, parentId));
    endDrag();
  }
  function sameSiblingGroup(node: { id: number }, kind: DragKind) {
    const row = folders.find((folder) => folder.id === node.id);
    if (!row || row.name === LIBRARY_POOL_NAME) return false;
    return isFolderEntry(folders, row) === (kind === "folder");
  }
  function gapAccepts(parentId: number | null, kind: DragKind) {
    const drag = dragRef.current;
    if (!drag) return false;
    const moving = folders.find((folder) => folder.id === drag.id);
    if (!moving || !sameSiblingGroup(moving, kind)) return false;
    if (kind === "doc" && parentId == null) return false;
    if (kind === "folder" && folderMoveIsBlocked(folders, moving.id, parentId)) return false;
    return true;
  }
  function hoverGap(event: DragEvent, parentId: number | null, beforeId: number | null, kind: DragKind) {
    if (isFileDrag(event) || !gapAccepts(parentId, kind)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropHint(null);
    setDropHoverId(null);
    setGapHint(gapKey(parentId, beforeId, kind));
  }
  function leaveGap(key: string) {
    setGapHint((current) => (current === key ? null : current));
  }
  function dropGap(event: DragEvent, parentId: number | null, beforeId: number | null, kind: DragKind) {
    event.preventDefault();
    event.stopPropagation();
    const drag = dragRef.current;
    if (drag && !isFileDrag(event) && gapAccepts(parentId, kind)) {
      const position = beforeId == null ? "after" : "before";
      void commitPlacements(planSiblingGap(folders, drag.id, parentId, beforeId, position, (node) => sameSiblingGroup(node, kind)));
    }
    endDrag();
  }
  function sendToLibrary(docId: number) {
    if (poolFolder) void commitPlacements(planNest(folders, docId, poolFolder.id));
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

  const hiddenBlank = requestedFolderId != null && !openFolder && folders.some((folder) => folder.id === requestedFolderId);

  function toggleTree(id: number) {
    setTreeOpen((current) => {
      const wasOpen = current[id] ?? id === isoRoot?.id;
      return { ...current, [id]: !wasOpen };
    });
  }

  function selectTreeFolder(folder: DocumentFolder) {
    setTreeOpen((current) => ({ ...current, [folder.id]: true }));
    const onShelf = folder.id === isoRoot?.id || departments.some((dept) => dept.id === folder.id);
    if (onShelf) {
      setActiveDeptId(folder.id);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("dept", String(folder.id));
        next.delete("folder");
        return next;
      });
      return;
    }
    showFolder(folder.id);
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading folder tree…</p>;
  if (!activeDept) return <p className="text-sm text-muted-foreground">No departments found.</p>;

  const query = search.trim().toLowerCase();
  const treeRoots = (isoRoot ? [isoRoot, ...departments.filter((dept) => dept.parentId !== isoRoot.id)] : departments)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const activeListing = listFolder(visibleFolders, activeDept.id);

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
            Expand a folder to see what is saved in it. While dragging, drop on the line between rows to place an item beside its neighbors. Drop on a folder to put something inside. Blank forms stay under Blank Forms. The Library Pool is where a document goes when you take it out of a folder.
          </p>
        </div>
        <div className="w-56">
          <TextField label="" placeholder="Filter documents…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div ref={boardPaneRef} className="grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-[minmax(220px,17.5rem)_minmax(0,1fr)] md:overflow-hidden">
        <nav ref={treePaneRef} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-2 md:min-h-0 md:overflow-y-auto" aria-label="Document folders">
          <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Folders</p>
          <ul data-testid="folder-tree">
            {treeRoots.map((folder) => (
              <FolderTreeBranch
                key={folder.id}
                folder={folder}
                depth={0}
                folders={visibleFolders}
                selectedId={selectedTreeId}
                treeOpen={treeOpen}
                draggable
                isoRoot={folder.id === isoRoot?.id}
                trailingGap={false}
                dragKind={dragKind}
                gapHint={gapHint}
                hintClass={hintClass}
                onToggle={toggleTree}
                onSelect={selectTreeFolder}
                onBeginDrag={beginDrag}
                onEndDrag={endDrag}
                onHoverRow={hoverRow}
                onLeaveRow={leaveRow}
                onDropRow={dropRow}
                onGapOver={hoverGap}
                onGapLeave={leaveGap}
                onGapDrop={dropGap}
              />
            ))}
          </ul>

          <div
            data-testid="folder-drop-root"
            onDragOver={(e) => {
              if (allowDrop(e, shelfParentId)) setDropHoverId(-1);
            }}
            onDragLeave={() => setDropHoverId((h) => (h === -1 ? null : h))}
            onDrop={(e) => dropOnParent(e, shelfParentId)}
            className={`rounded-md border border-dashed px-3 py-2 text-xs ${dropHoverId === -1 ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}
          >
            Top level
          </div>

          <form
            className="mt-1 flex flex-col gap-1 border-t border-border pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newDepartmentName.trim()) return;
              createFolder.mutate(isoRoot ? { name: newDepartmentName.trim(), parentId: isoRoot.id } : { name: newDepartmentName.trim() });
              setNewDepartmentName("");
            }}
          >
            <TextField label="" placeholder="New department…" value={newDepartmentName} onChange={(e) => setNewDepartmentName(e.target.value)} />
            <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
              + Add department
            </button>
          </form>
        </nav>

        <div ref={listPaneRef} className="flex min-w-0 flex-col gap-3 md:min-h-0 md:overflow-y-auto">
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
              hintClass={hintClass}
              onOpenFolder={showFolder}
              onBackToDepartments={showDepartmentList}
              onBeginDrag={beginDrag}
              onEndDrag={endDrag}
              onAllowDrop={allowDrop}
              onNest={dropOnParent}
              onHoverRow={hoverRow}
              onLeaveRow={leaveRow}
              onDropRow={dropRow}
              onUploadFiles={uploadFiles}
              onUploadClick={requestDocumentUpload}
              onCreateFolder={(name, parentId) => createFolder.mutate({ name, parentId })}
              onRename={(id, name) => updateFolder.mutate({ id, name })}
              onSendToLibrary={sendToLibrary}
              onAttach={requestUpload}
              onRemoveAttachment={(id) => removeTemplate.mutate(id)}
              dragKind={dragKind}
              gapHint={gapHint}
              onGapOver={hoverGap}
              onGapLeave={leaveGap}
              onGapDrop={dropGap}
            />
          ) : (
          <>
          <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <FolderOpen size={18} className="shrink-0 text-primary" />
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

          {activeListing.folders.map((sub, index) => {
            const listing = listFolder(visibleFolders, sub.id);
            const subfolders = listing.folders.filter((row) => !query || row.name.toLowerCase().includes(query));
            const docs = listing.files.filter((row) => !query || row.name.toLowerCase().includes(query));
            const isCollapsed = collapsed[sub.id];
            const isDropTarget = dropHoverId === sub.id;
            const beforeCard = gapKey(activeDept.id, sub.id, "folder");
            const afterCards = gapKey(activeDept.id, null, "folder");
            return (
              <div key={sub.id} className="contents">
              {dragKind === "folder" && (
                <SiblingGap
                  active={gapHint === beforeCard}
                  className="h-4 shrink-0"
                  onDragOver={(event) => hoverGap(event, activeDept.id, sub.id, "folder")}
                  onDragLeave={() => leaveGap(beforeCard)}
                  onDrop={(event) => dropGap(event, activeDept.id, sub.id, "folder")}
                />
              )}
              <FileDropZone
                onFiles={(dropped) => void uploadFiles(sub.id, dropped)}
                overlay={false}
                className={`shrink-0 overflow-hidden rounded-lg border bg-card transition-shadow ${isDropTarget ? "border-primary ring-2 ring-primary" : "border-border"}`}
              >
                <div
                  className={`flex cursor-grab items-center gap-2 border-b border-border bg-muted/40 px-2 py-1.5 active:cursor-grabbing ${hintClass(sub.id)}`}
                  draggable
                  data-folder-id={sub.id}
                  onDragStart={(e) => {
                    e.stopPropagation();
                    beginDrag(e, sub.id, "folder");
                  }}
                  onDragEnd={endDrag}
                  onClick={() => setCollapsed((c) => ({ ...c, [sub.id]: !c[sub.id] }))}
                  onDragOver={(e) => hoverRow(e, sub)}
                  onDragLeave={() => leaveRow(sub.id)}
                  onDrop={(e) => dropRow(e, sub)}
                >
                  <GripVertical size={14} className="text-muted-foreground" />
                  <span className="text-muted-foreground">{isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</span>
                  {isCollapsed ? <Folder size={15} className="shrink-0 text-primary" /> : <FolderOpen size={15} className="shrink-0 text-primary" />}
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
                      dropOnParent(e, sub.id);
                    }}
                  >
                    {subfolders.length === 0 && docs.length === 0 && <span className="text-xs italic text-muted-foreground">{query ? "Nothing in this folder matches." : "Nothing saved here yet."}</span>}
                    {subfolders.map((row, rowIndex) => {
                      const beforeRow = gapKey(sub.id, row.id, "folder");
                      const afterRows = gapKey(sub.id, null, "folder");
                      return (
                      <div key={row.id} className="relative">
                      {dragKind === "folder" && (
                        <SiblingGap
                          active={gapHint === beforeRow}
                          className="absolute inset-x-0 -top-4 h-4"
                          onDragOver={(event) => hoverGap(event, sub.id, row.id, "folder")}
                          onDragLeave={() => leaveGap(beforeRow)}
                          onDrop={(event) => dropGap(event, sub.id, row.id, "folder")}
                        />
                      )}
                      <div
                        data-testid="folder-row"
                        data-folder-id={row.id}
                        draggable
                        onDragStart={(event) => {
                          event.stopPropagation();
                          beginDrag(event, row.id, "folder");
                        }}
                        onDragEnd={endDrag}
                        onDragOver={(event) => hoverRow(event, row)}
                        onDragLeave={() => leaveRow(row.id)}
                        onDrop={(event) => dropRow(event, row)}
                        className={`flex items-center gap-2 rounded-md px-2 py-2 hover:bg-muted ${hintClass(row.id)}`}
                      >
                        <GripVertical size={14} className="text-muted-foreground" />
                        <Folder size={15} className="shrink-0 text-primary" />
                        <button type="button" onClick={() => showFolder(row.id)} className="flex-1 text-left text-sm font-medium" data-testid="folder-title">
                          {row.name}
                        </button>
                        <ChevronRight size={14} className="text-muted-foreground" />
                      </div>
                      {dragKind === "folder" && rowIndex === subfolders.length - 1 && (
                        <SiblingGap
                          active={gapHint === afterRows}
                          className="mt-1 h-4"
                          onDragOver={(event) => hoverGap(event, sub.id, null, "folder")}
                          onDragLeave={() => leaveGap(afterRows)}
                          onDrop={(event) => dropGap(event, sub.id, null, "folder")}
                        />
                      )}
                      </div>
                      );
                    })}
                    <div className="flex flex-wrap gap-2">
                    {docs.map((doc, docIndex) => {
                      const target = openTarget(doc);
                      const beforeDoc = gapKey(sub.id, doc.id, "doc");
                      const afterDocs = gapKey(sub.id, null, "doc");
                      return (
                        <div key={doc.id} className="contents">
                        {dragKind === "doc" && (
                          <SiblingGap
                            orientation="pill"
                            active={gapHint === beforeDoc}
                            className="h-6 w-3 shrink-0"
                            onDragOver={(event) => hoverGap(event, sub.id, doc.id, "doc")}
                            onDragLeave={() => leaveGap(beforeDoc)}
                            onDrop={(event) => dropGap(event, sub.id, doc.id, "doc")}
                          />
                        )}
                        <div
                          className={`inline-flex rounded-full ${hintClass(doc.id)}`}
                          onDragOver={(event) => hoverRow(event, doc)}
                          onDragLeave={() => leaveRow(doc.id)}
                          onDrop={(event) => dropRow(event, doc)}
                        >
                          {target ? (
                            <Link
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
                          ) : (
                            <DocPill
                              doc={doc}
                              onDragStart={(e) => beginDrag(e, doc.id, "doc")}
                              onDragEnd={endDrag}
                              onSendToLibrary={() => sendToLibrary(doc.id)}
                              onAttach={() => requestUpload(doc.id)}
                              onRemoveAttachment={() => removeTemplate.mutate(doc.id)}
                            />
                          )}
                        </div>
                        {dragKind === "doc" && docIndex === docs.length - 1 && (
                          <SiblingGap
                            orientation="pill"
                            active={gapHint === afterDocs}
                            className="h-6 w-3 shrink-0"
                            onDragOver={(event) => hoverGap(event, sub.id, null, "doc")}
                            onDragLeave={() => leaveGap(afterDocs)}
                            onDrop={(event) => dropGap(event, sub.id, null, "doc")}
                          />
                        )}
                        </div>
                      );
                    })}
                    </div>
                  </div>
                )}
              </FileDropZone>
              {dragKind === "folder" && index === activeListing.folders.length - 1 && (
                <SiblingGap
                  active={gapHint === afterCards}
                  className="h-4 shrink-0"
                  onDragOver={(event) => hoverGap(event, activeDept.id, null, "folder")}
                  onDragLeave={() => leaveGap(afterCards)}
                  onDrop={(event) => dropGap(event, activeDept.id, null, "folder")}
                />
              )}
              </div>
            );
          })}

          {activeListing.files.some((file) => !query || file.name.toLowerCase().includes(query)) && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
              <p className="text-xs font-medium text-muted-foreground">Saved in {activeDept.name}</p>
              <div className="flex flex-wrap gap-2">
                {activeListing.files
                  .filter((file) => !query || file.name.toLowerCase().includes(query))
                  .map((doc, index, list) => {
                    const target = openTarget(doc);
                    const beforeDoc = gapKey(activeDept.id, doc.id, "doc");
                    const afterDocs = gapKey(activeDept.id, null, "doc");
                    return (
                      <div key={doc.id} className="contents">
                      {dragKind === "doc" && (
                        <SiblingGap
                          orientation="pill"
                          active={gapHint === beforeDoc}
                          className="h-6 w-3 shrink-0"
                          onDragOver={(event) => hoverGap(event, activeDept.id, doc.id, "doc")}
                          onDragLeave={() => leaveGap(beforeDoc)}
                          onDrop={(event) => dropGap(event, activeDept.id, doc.id, "doc")}
                        />
                      )}
                      <div
                        className={`inline-flex rounded-full ${hintClass(doc.id)}`}
                        onDragOver={(event) => hoverRow(event, doc)}
                        onDragLeave={() => leaveRow(doc.id)}
                        onDrop={(event) => dropRow(event, doc)}
                      >
                        {target ? (
                          <Link
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
                        ) : (
                          <DocPill
                            doc={doc}
                            onDragStart={(event) => beginDrag(event, doc.id, "doc")}
                            onDragEnd={endDrag}
                            onSendToLibrary={() => sendToLibrary(doc.id)}
                            onAttach={() => requestUpload(doc.id)}
                            onRemoveAttachment={() => removeTemplate.mutate(doc.id)}
                          />
                        )}
                      </div>
                      {dragKind === "doc" && index === list.length - 1 && (
                        <SiblingGap
                          orientation="pill"
                          active={gapHint === afterDocs}
                          className="h-6 w-3 shrink-0"
                          onDragOver={(event) => hoverGap(event, activeDept.id, null, "doc")}
                          onDragLeave={() => leaveGap(afterDocs)}
                          onDrop={(event) => dropGap(event, activeDept.id, null, "doc")}
                        />
                      )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

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
            dropOnParent(e, poolFolder.id);
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
                <div
                  key={doc.id}
                  className={`inline-flex rounded-full ${hintClass(doc.id)}`}
                  onDragOver={(event) => hoverRow(event, doc)}
                  onDragLeave={() => leaveRow(doc.id)}
                  onDrop={(event) => dropRow(event, doc)}
                >
                  <DocPill
                    doc={doc}
                    onDragStart={(e) => beginDrag(e, doc.id, "doc")}
                    onDragEnd={endDrag}
                    onAttach={() => requestUpload(doc.id)}
                    onRemoveAttachment={() => removeTemplate.mutate(doc.id)}
                  />
                </div>
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
  hintClass,
  onOpenFolder,
  onBackToDepartments,
  onBeginDrag,
  onEndDrag,
  onAllowDrop,
  onNest,
  onHoverRow,
  onLeaveRow,
  onDropRow,
  onUploadFiles,
  onUploadClick,
  onCreateFolder,
  onRename,
  onSendToLibrary,
  onAttach,
  onRemoveAttachment,
  dragKind,
  gapHint,
  onGapOver,
  onGapLeave,
  onGapDrop,
}: {
  folder: DocumentFolder;
  folders: DocumentFolder[];
  query: string;
  hintClass: (id: number) => string;
  onOpenFolder: (id: number) => void;
  onBackToDepartments: () => void;
  onBeginDrag: (event: DragEvent, id: number, kind: DragKind) => void;
  onEndDrag: () => void;
  onAllowDrop: (event: DragEvent, targetParentId: number | null) => boolean;
  onNest: (event: DragEvent, parentId: number | null) => void;
  onHoverRow: (event: DragEvent, folder: DocumentFolder) => void;
  onLeaveRow: (id: number) => void;
  onDropRow: (event: DragEvent, folder: DocumentFolder) => void;
  onUploadFiles: (parentId: number, files: File[]) => Promise<void>;
  onUploadClick: (parentId: number) => void;
  onCreateFolder: (name: string, parentId: number) => void;
  onRename: (id: number, name: string) => void;
  onSendToLibrary: (id: number) => void;
  onAttach: (id: number) => void;
  onRemoveAttachment: (id: number) => void;
  dragKind: DragKind | null;
  gapHint: string | null;
  onGapOver: (event: DragEvent, parentId: number | null, beforeId: number | null, kind: DragKind) => void;
  onGapLeave: (key: string) => void;
  onGapDrop: (event: DragEvent, parentId: number | null, beforeId: number | null, kind: DragKind) => void;
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

      <div className="flex items-center gap-2">
        <FolderOpen size={18} className="shrink-0 text-primary" />
        <h2 className="text-lg font-semibold">{folder.name}</h2>
      </div>

      {folder.name === FAI_VALIDATION_FOLDER_NAME && <ValidationReportsPanel />}

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
          if (isFileDrag(event)) return;
          onAllowDrop(event, folder.id);
        }}
        onDrop={(event) => {
          if (isFileDrag(event)) return;
          onNest(event, folder.id);
        }}
      >
        {empty && <p className="px-2 py-3 text-sm italic text-muted-foreground">{query ? "Nothing in this folder matches." : "Nothing saved in this folder yet."}</p>}
        {subfolders.map((row, index) => {
          const beforeRow = gapKey(folder.id, row.id, "folder");
          const afterRows = gapKey(folder.id, null, "folder");
          return (
          <div key={row.id}>
          {dragKind === "folder" && (
            <SiblingGap
              active={gapHint === beforeRow}
              className="h-3"
              onDragOver={(event) => onGapOver(event, folder.id, row.id, "folder")}
              onDragLeave={() => onGapLeave(beforeRow)}
              onDrop={(event) => onGapDrop(event, folder.id, row.id, "folder")}
            />
          )}
          <div
            data-testid="folder-row"
            data-folder-id={row.id}
            draggable
            onDragStart={(event) => {
              event.stopPropagation();
              onBeginDrag(event, row.id, "folder");
            }}
            onDragEnd={onEndDrag}
            onDragOver={(event) => onHoverRow(event, row)}
            onDragLeave={() => onLeaveRow(row.id)}
            onDrop={(event) => onDropRow(event, row)}
            className={`flex items-center gap-2 rounded-md px-2 py-2 hover:bg-muted ${hintClass(row.id)}`}
          >
            <GripVertical size={14} className="text-muted-foreground" />
            <Folder size={15} className="shrink-0 text-primary" />
            <button type="button" onClick={() => onOpenFolder(row.id)} className="flex-1 text-left text-sm font-medium" data-testid="folder-title">
              {row.name}
            </button>
            <ChevronRight size={14} className="text-muted-foreground" />
          </div>
          {dragKind === "folder" && index === subfolders.length - 1 && (
            <SiblingGap
              active={gapHint === afterRows}
              className="h-3"
              onDragOver={(event) => onGapOver(event, folder.id, null, "folder")}
              onDragLeave={() => onGapLeave(afterRows)}
              onDrop={(event) => onGapDrop(event, folder.id, null, "folder")}
            />
          )}
          </div>
          );
        })}
        {files.map((file, index) => {
          const target = openTarget(file);
          const beforeFile = gapKey(folder.id, file.id, "doc");
          const afterFiles = gapKey(folder.id, null, "doc");
          return (
            <div key={file.id}>
            {dragKind === "doc" && (
              <SiblingGap
                active={gapHint === beforeFile}
                className="h-3"
                onDragOver={(event) => onGapOver(event, folder.id, file.id, "doc")}
                onDragLeave={() => onGapLeave(beforeFile)}
                onDrop={(event) => onGapDrop(event, folder.id, file.id, "doc")}
              />
            )}
            <div
              className={hintClass(file.id)}
              onDragOver={(event) => onHoverRow(event, file)}
              onDragLeave={() => onLeaveRow(file.id)}
              onDrop={(event) => onDropRow(event, file)}
            >
              {target ? (
                <Link
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
              ) : (
                <div data-testid="file-row" className="px-2 py-1">
                  <DocPill
                    doc={file}
                    onDragStart={(event) => onBeginDrag(event, file.id, "doc")}
                    onDragEnd={onEndDrag}
                    onSendToLibrary={() => onSendToLibrary(file.id)}
                    onAttach={() => onAttach(file.id)}
                    onRemoveAttachment={() => onRemoveAttachment(file.id)}
                  />
                </div>
              )}
            </div>
            {dragKind === "doc" && index === files.length - 1 && (
              <SiblingGap
                active={gapHint === afterFiles}
                className="h-3"
                onDragOver={(event) => onGapOver(event, folder.id, null, "doc")}
                onDragLeave={() => onGapLeave(afterFiles)}
                onDrop={(event) => onGapDrop(event, folder.id, null, "doc")}
              />
            )}
            </div>
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
