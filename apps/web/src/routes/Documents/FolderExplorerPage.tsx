import { useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { blankFormsFolderHref, contentRoot, departmentForFolder, FAI_VALIDATION_FOLDER_NAME, folderChain, folderDepth, folderIdByName, folderTreeOpen, isBlankTemplateLink, isFolderEntry, leftHandFolders, listFolder, treeOpenForTarget, visibleExplorerFolders } from "../../lib/folderBrowse";
import { folderContents, savedItemRemoval, type FolderDetailItem, type FolderDetailNode } from "../../lib/folderDetails";
import { folderNodePath, joinFolderPath } from "../../lib/folderPath";
import { ValidationReportsPanel } from "../ValidationReports/ValidationReportsPanel";
import { ChevronDown, ChevronLeft, ChevronRight, Paperclip, FileText, Download, X, Inbox, UploadCloud, GripVertical, Folder, FolderOpen, MessageSquare } from "lucide-react";
import { canGoBack, canGoForward, explorerCrumbs, initialExplorerHistory, pushExplorerPlace, stepExplorerHistory, type ExplorerHistory, type ExplorerPlace } from "../../lib/explorerNav";
import { apiClient } from "../../api/client";
import { TextField } from "../../components/forms/Field";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { FileDropZone, isFileDrag } from "../../components/shared/FileDropZone";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { InAppFilePreview, type PreviewRequest } from "../../components/shared/InAppFilePreview";
import { onlyOfficeFile, previewKind, saveBytes } from "../../lib/filePreview";
import { paneScrollDelta } from "../../lib/dragAutoScroll";
import { applyFolderPlacements, folderMoveIsBlocked, libraryPoolDeleteConfirm, planNest, planSiblingGap, planSiblingReorder, unlistFromLibraryPool, type NodePlacement } from "../../lib/folderMove";
import { dropPosition, reorderDropClass, type DropPosition } from "../../lib/listReorder";
import { Modal } from "../../components/modals/Modal";
import { FolderPathBar, copyFolderPath } from "../../components/documents/FolderPathBar";
import { FolderContentsList, type FolderRowAction } from "../../components/documents/FolderContentsList";
import { RemoveSavedFileDialog } from "../../components/documents/RemoveSavedFileDialog";
import { DocumentCommentThread } from "../../components/documents/DocumentCommentThread";
import { DeleteFolderDialog, FolderActionButtons, RenameFolderDialog } from "../../components/documents/FolderNameDialogs";
import { MoveToFolderDialog } from "../../components/documents/MoveToFolderDialog";
import { documentFolderHasContents, folderPathLabel } from "../../lib/folderActions";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import "./folderExplorer.css";

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

interface DocumentFolder extends FolderDetailNode {
  pdfPath: string | null;
  pdfMimeType?: string | null;
  linkedPath: string | null;
  documentId: number | null;
  /** Only present when documentId is set — joined server-side, see document-folders.controller.ts's withLinkedDocumentInfo. */
  documentStatus?: "draft" | "in_review" | "approved" | "obsolete";
  documentExpirationStatus?: "expired" | "expiring_soon" | null;
  removedFromLibraryPool?: boolean;
}

const LIBRARY_POOL_NAME = "Library Pool";

function attachedFileName(doc: DocumentFolder) {
  const ext = doc.pdfPath?.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
  if (!ext || doc.name.toLowerCase().endsWith(ext.toLowerCase())) return doc.name;
  return `${doc.name}${ext}`;
}

async function downloadFolderFile(doc: DocumentFolder) {
  const res = await apiClient.get(`/document-folders/${doc.id}/template`, { responseType: "blob" });
  saveBytes(res.data as Blob, attachedFileName(doc), doc.pdfMimeType ?? undefined);
}

function folderFilePreview(doc: DocumentFolder): PreviewRequest {
  const fileName = attachedFileName(doc);
  return {
    fileName,
    mimeType: doc.pdfMimeType,
    loadBytes: async () => (await apiClient.get(`/document-folders/${doc.id}/template`, { responseType: "arraybuffer" })).data as ArrayBuffer,
    officeSource: onlyOfficeFile(fileName, doc.pdfMimeType) ? { kind: "folder", folderId: doc.id } : undefined,
    download: () => downloadFolderFile(doc),
  };
}

function buildDetailActions(
  item: FolderDetailItem<DocumentFolder>,
  options: {
    path: string;
    canManage: boolean;
    canRename: boolean;
    canDelete: boolean;
    onMove?: () => void;
    onEdit?: () => void;
    onDeleteFolder?: () => void;
    onDeleteTemplate?: () => void;
    onSendToLibrary?: () => void;
    onAttach?: () => void;
    onRemove?: () => void;
    onView?: () => void;
    onDownload?: () => void;
    onComments?: () => void;
    onUploadInto?: () => void;
    onPoolDelete?: () => void;
    poolDeletePending?: boolean;
    onCopy: (path: string) => void;
  },
): FolderRowAction[] {
  const doc = item.node;
  const locked = doc.name === "ISO Compliance Documents" || doc.name === LIBRARY_POOL_NAME;
  const actions: FolderRowAction[] = [];
  if (options.path) actions.push({ id: "copy", label: "Copy path", onClick: () => options.onCopy(options.path) });
  if (item.type === "folder" && options.onUploadInto) actions.push({ id: "upload", label: "Upload document", onClick: options.onUploadInto });
  if (options.canManage && options.onMove) actions.push({ id: "move", label: "Move to…", testId: "move-to", onClick: options.onMove });
  if (item.type === "folder" && !locked && options.canRename && options.onEdit) actions.push({ id: "edit", label: "Edit folder", testId: "edit-folder", onClick: options.onEdit });
  if (item.type === "folder" && !locked && options.canDelete && options.onDeleteFolder) {
    actions.push({ id: "delete-folder", label: "Delete folder", testId: "delete-folder", destructive: true, onClick: options.onDeleteFolder });
  }
  if (item.type !== "folder" && doc.pdfPath && options.onView) actions.push({ id: "view", label: "View file", onClick: options.onView });
  if (item.type !== "folder" && doc.pdfPath && options.onDownload) actions.push({ id: "download", label: "Download", onClick: options.onDownload });
  if (item.type !== "folder" && doc.pdfPath && options.onRemove) actions.push({ id: "remove", label: "Remove uploaded file", destructive: true, onClick: options.onRemove });
  if (item.type !== "folder" && !doc.pdfPath && options.onAttach) actions.push({ id: "attach", label: "Attach a file", onClick: options.onAttach });
  if (item.type !== "folder" && options.onComments) actions.push({ id: "comments", label: "Comments", onClick: options.onComments });
  if (options.canManage && options.onSendToLibrary) actions.push({ id: "library", label: "Send to Library Pool", onClick: options.onSendToLibrary });
  if (options.canManage && options.onDeleteTemplate && isBlankTemplateLink(doc.linkedPath)) {
    actions.push({ id: "delete-template", label: "Delete", destructive: true, onClick: options.onDeleteTemplate });
  }
  if (options.onPoolDelete) {
    actions.push({
      id: "pool-delete",
      label: "Remove from Library Pool",
      testId: "pool-delete",
      destructive: true,
      disabled: options.poolDeletePending,
      onClick: options.onPoolDelete,
    });
  }
  return actions;
}

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
  expandingId,
  busy,
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
  onMove,
  onEditFolder,
  onDeleteFolder,
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
  expandingId: number | null;
  busy: boolean;
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
  onMove?: (folder: DocumentFolder) => void;
  onEditFolder?: (folder: DocumentFolder) => void;
  onDeleteFolder?: (folder: DocumentFolder) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const nameLocked = folder.name === "ISO Compliance Documents" || folder.name === LIBRARY_POOL_NAME;
  const showFolderActions = !nameLocked && (onEditFolder != null || onDeleteFolder != null);
  const children = listFolder(folders, folder.id).folders;
  const open = folderTreeOpen(treeOpen[folder.id], depth);
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
        className={`group flex min-h-8 items-center rounded-md border-l-2 pr-1 text-sm transition-colors ${
          selected ? "border-primary bg-primary/15 font-medium text-foreground" : "border-transparent text-foreground hover:bg-muted"
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
        onContextMenu={(event) => {
          if (!showFolderActions) return;
          event.preventDefault();
          setMenuOpen(true);
        }}
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
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left" aria-current={selected ? "page" : undefined} title={folder.name} onClick={() => onSelect(folder)}>
          <Icon size={16} className={selected ? "shrink-0 text-primary" : "shrink-0 text-muted-foreground"} />
          <span className="min-w-0 flex-1 whitespace-normal break-words text-left leading-snug">{folder.name}</span>
        </button>
        {onMove && (
          <button
            type="button"
            data-testid="move-to"
            className="mr-1 shrink-0 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10"
            aria-label={`Move ${folder.name} to another folder`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onMove(folder);
            }}
          >
            Move to…
          </button>
        )}
        {showFolderActions && (
          <span className="relative mr-1 shrink-0">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`Folder actions for ${folder.name}`}
              className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((open) => !open);
              }}
            >
              ···
            </button>
            {menuOpen && (
              <span role="menu" className="absolute right-0 top-7 z-20 flex min-w-36 flex-col rounded-md border border-border bg-card p-1 text-left shadow-sm">
                {onEditFolder && (
                  <button
                    type="button"
                    role="menuitem"
                    className="rounded px-2 py-1 text-left text-xs text-foreground hover:bg-muted"
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuOpen(false);
                      onEditFolder(folder);
                    }}
                  >
                    Edit folder
                  </button>
                )}
                {onDeleteFolder && (
                  <button
                    type="button"
                    role="menuitem"
                    className="rounded px-2 py-1 text-left text-xs text-destructive hover:bg-muted"
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuOpen(false);
                      onDeleteFolder(folder);
                    }}
                  >
                    Delete folder
                  </button>
                )}
              </span>
            )}
          </span>
        )}
        {draggable && <GripVertical size={12} className="mr-1 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-70" />}
      </div>
      {open && busy && expandingId === folder.id && (
        <div className="flex flex-col gap-1 py-1" style={{ paddingLeft: 18 + depth * 14 }} aria-hidden>
          <div className="skeleton h-7 w-3/4" />
          <div className="skeleton h-7 w-1/2" />
        </div>
      )}
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
              draggable={draggable}
              isoRoot={false}
              trailingGap={index === children.length - 1}
              dragKind={dragKind}
              gapHint={gapHint}
              expandingId={expandingId}
              busy={busy}
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
              onMove={onMove}
              onEditFolder={onEditFolder}
              onDeleteFolder={onDeleteFolder}
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
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["document-folders"] });
      const previous = qc.getQueryData<DocumentFolder[]>(["document-folders"]);
      if (previous) {
        qc.setQueryData<DocumentFolder[]>(
          ["document-folders"],
          previous.map((folder) => (folder.id === patch.id ? { ...folder, ...("name" in patch && patch.name ? { name: patch.name } : {}), ...("parentId" in patch ? { parentId: patch.parentId ?? null } : {}) } : folder)),
        );
      }
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) qc.setQueryData(["document-folders"], context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["document-folders"] }),
  });
}

function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => apiClient.delete(`/document-folders/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["document-folders"] });
      const previous = qc.getQueryData<DocumentFolder[]>(["document-folders"]);
      if (previous) qc.setQueryData<DocumentFolder[]>(["document-folders"], previous.filter((folder) => folder.id !== id));
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(["document-folders"], context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["document-folders"] }),
  });
}

function useRetireFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, destinationId }: { id: number; destinationId: number | null }) => apiClient.post(`/document-folders/${id}/retire`, { destinationId }),
    onMutate: async ({ id, destinationId }) => {
      await qc.cancelQueries({ queryKey: ["document-folders"] });
      const previous = qc.getQueryData<DocumentFolder[]>(["document-folders"]);
      if (previous) {
        qc.setQueryData<DocumentFolder[]>(
          ["document-folders"],
          previous.flatMap((folder) => {
            if (folder.id === id) return [];
            if (folder.parentId === id && destinationId != null) return [{ ...folder, parentId: destinationId }];
            return [folder];
          }),
        );
      }
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) qc.setQueryData(["document-folders"], context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["document-folders"] }),
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
 * Fillable blanks live in Blank Forms Templates. This page lists that folder
 * and the forms or files that were saved into a folder.
 */
export function FolderExplorerPage() {
  const { data: folders = [], isLoading, isFetching } = useDocumentFolders();
  const { effective, isLoading: permissionsLoading } = useEffectivePermissions();
  const canManageFolders = !permissionsLoading && effective?.documents === "edit";
  const canRenameFolders = !permissionsLoading && effective?.["folders.rename"] === "edit";
  const canDeleteFolders = !permissionsLoading && effective?.["folders.delete"] === "edit";
  const visibleFolders = useMemo(() => {
    const seen = new Set<number>();
    return visibleExplorerFolders(folders).filter((folder) => {
      if (seen.has(folder.id)) return false;
      seen.add(folder.id);
      return true;
    });
  }, [folders]);
  const updateFolder = useUpdateFolder();
  const createFolder = useCreateFolder();
  const deleteFolder = useDeleteFolder();
  const retireFolder = useRetireFolder();
  const [nameEdit, setNameEdit] = useState<DocumentFolder | null>(null);
  const [retireTarget, setRetireTarget] = useState<DocumentFolder | null>(null);
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
  const [pendingRemoval, setPendingRemoval] = useState<DocumentFolder | null>(null);
  const [filePreview, setFilePreview] = useState<PreviewRequest | null>(null);
  const [commentDoc, setCommentDoc] = useState<DocumentFolder | null>(null);
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
  const [movingId, setMovingId] = useState<number | null>(null);
  const [movePending, setMovePending] = useState(false);
  const moveLock = useRef(false);
  const [poolSelection, setPoolSelection] = useState<number[]>([]);
  const [poolDeletePending, setPoolDeletePending] = useState(false);
  const poolDeleteLock = useRef(false);
  const [history, setHistory] = useState<ExplorerHistory>(initialExplorerHistory);
  const [expandingId, setExpandingId] = useState<number | null>(null);
  const applyingHistory = useRef(false);
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
  const deptParam = searchParams.get("dept");
  const linkedDeptId = deptParam != null && /^\d+$/.test(deptParam) ? Number(deptParam) : null;
  const expandTargetId = requestedFolderId ?? linkedDeptId;
  const appliedExpand = useRef<number | null>(null);

  useEffect(() => {
    if (expandTargetId == null) return;
    if (appliedExpand.current === expandTargetId) return;
    if (!visibleFolders.some((folder) => folder.id === expandTargetId)) return;
    appliedExpand.current = expandTargetId;
    const required = treeOpenForTarget(visibleFolders, expandTargetId);
    setTreeOpen((current) => ({ ...current, ...required }));
  }, [expandTargetId, visibleFolders]);

  useEffect(() => {
    if (!isFetching) setExpandingId(null);
  }, [isFetching]);

  function beginDrag(event: DragEvent, id: number, kind: DragKind) {
    if (!canManageFolders) {
      event.preventDefault();
      return;
    }
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
  async function commitPlacements(placements: NodePlacement[] | null, lockHeld = false): Promise<boolean> {
    if (!canManageFolders || !placements || placements.length === 0) return false;
    if (!lockHeld && moveLock.current) return false;
    const changed = placements.filter((placement) => {
      const current = folders.find((folder) => folder.id === placement.id);
      return !current || current.parentId !== placement.parentId || current.sortOrder !== placement.sortOrder;
    });
    if (changed.length === 0) return false;
    if (!lockHeld) {
      moveLock.current = true;
      setMovePending(true);
    }
    const snapshot = qc.getQueryData<DocumentFolder[]>(["document-folders"]);
    if (snapshot) qc.setQueryData<DocumentFolder[]>(["document-folders"], applyFolderPlacements(snapshot, changed));
    try {
      await Promise.all(
        changed.map((placement) => {
          const current = folders.find((folder) => folder.id === placement.id);
          const body: { sortOrder: number; parentId?: number | null } = { sortOrder: placement.sortOrder };
          if (!current || current.parentId !== placement.parentId) body.parentId = placement.parentId;
          return apiClient.patch(`/document-folders/${placement.id}`, body);
        }),
      );
      return true;
    } catch (err) {
      if (snapshot) qc.setQueryData(["document-folders"], snapshot);
      const detail = await extractErrorMessageAsync(err, "Couldn't move that");
      toast.error(`${detail} It's back where it was.`);
      return false;
    } finally {
      if (!lockHeld) {
        moveLock.current = false;
        setMovePending(false);
      }
      void qc.invalidateQueries({ queryKey: ["document-folders"] });
    }
  }
  async function moveInto(parentId: number) {
    if (!canManageFolders || movingId == null || moveLock.current) return;
    moveLock.current = true;
    setMovePending(true);
    try {
      const placements = planNest(folders, movingId, parentId);
      if (placements === null) {
        toast.error("A folder cannot be moved into itself.");
        return;
      }
      if (placements.length === 0) {
        toast.error("That item is already in this folder.");
        return;
      }
      const destination = folders.find((folder) => folder.id === parentId);
      setMovingId(null);
      const saved = await commitPlacements(placements, true);
      if (saved && destination) toast.success(`Moved to ${destination.name}.`);
    } finally {
      moveLock.current = false;
      setMovePending(false);
    }
  }
  function openMove(id: number) {
    if (movePending || moveLock.current) return;
    setMovingId(id);
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
  async function removePoolItems(ids: number[]) {
    const rows = poolItems.filter((item) => ids.includes(item.id));
    if (!canManageFolders || rows.length === 0 || poolDeleteLock.current) return;
    if (!confirm(libraryPoolDeleteConfirm(rows.map((row) => row.name)))) return;
    poolDeleteLock.current = true;
    setPoolDeletePending(true);
    const snapshot = qc.getQueryData<DocumentFolder[]>(["document-folders"]);
    const removing = rows.map((row) => row.id);
    if (snapshot) qc.setQueryData<DocumentFolder[]>(["document-folders"], unlistFromLibraryPool(snapshot, removing));
    setPoolSelection((current) => current.filter((id) => !removing.includes(id)));
    try {
      await Promise.all(removing.map((id) => apiClient.delete(`/document-folders/${id}/pool`)));
      toast.success(removing.length === 1 ? "Removed from the Library Pool." : `Removed ${removing.length} items from the Library Pool.`);
    } catch (err) {
      if (snapshot) qc.setQueryData(["document-folders"], snapshot);
      toast.error(`${await extractErrorMessageAsync(err, "Couldn't remove that from the Library Pool")} It's back in the Library Pool.`);
    } finally {
      poolDeleteLock.current = false;
      setPoolDeletePending(false);
      void qc.invalidateQueries({ queryKey: ["document-folders"] });
    }
  }
  function requestUpload(docId: number) {
    pendingUploadTarget.current = docId;
    fileInputRef.current?.click();
  }
  function requestDocumentUpload(parentId: number) {
    pendingUploadParent.current = parentId;
    uploadDocInputRef.current?.click();
  }

  function remember(place: ExplorerPlace) {
    if (applyingHistory.current) return;
    setHistory((current) => pushExplorerPlace(current, place));
  }

  function showFolder(id: number) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("folder", String(id));
      const dept = departmentForFolder(folders, id);
      if (dept) next.set("dept", String(dept.id));
      return next;
    });
    const dept = departmentForFolder(folders, id);
    remember({ deptId: dept?.id ?? null, folderId: id });
  }

  function showDepartmentList() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("folder");
      return next;
    });
    remember({ deptId: activeDeptId, folderId: null });
  }

  function goHistory(delta: number) {
    const next = stepExplorerHistory(history, delta);
    if (next === history) return;
    const place = next.entries[next.index] ?? { deptId: null, folderId: null };
    applyingHistory.current = true;
    setHistory(next);
    if (place.deptId != null) setActiveDeptId(place.deptId);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (place.folderId == null) params.delete("folder");
      else params.set("folder", String(place.folderId));
      if (place.deptId != null) params.set("dept", String(place.deptId));
      else params.delete("dept");
      return params;
    });
    queueMicrotask(() => {
      applyingHistory.current = false;
    });
  }

  const hiddenBlank = requestedFolderId != null && !openFolder && folders.some((folder) => folder.id === requestedFolderId);

  function toggleTree(id: number) {
    setExpandingId(id);
    setTreeOpen((current) => {
      const wasOpen = folderTreeOpen(current[id], folderDepth(visibleFolders, id));
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
      remember({ deptId: folder.id, folderId: null });
      return;
    }
    showFolder(folder.id);
  }

  function copyItemPath(path: string) {
    void copyFolderPath(path).then((ok) => {
      if (ok) toast.success("Path copied");
      else toast.error("Couldn't copy the path.");
    });
  }

  const query = search.trim().toLowerCase();

  function detailItems(parentId: number) {
    return folderContents(visibleFolders, parentId).filter((item) => !query || `${item.label} ${item.node.name}`.toLowerCase().includes(query));
  }

  function actionsFor(item: FolderDetailItem<DocumentFolder>, parentNames: string[], extras?: { pool?: boolean }) {
    const doc = item.node;
    const path = joinFolderPath([...parentNames, doc.name]);
    return buildDetailActions(item, {
      path,
      canManage: canManageFolders,
      canRename: canRenameFolders,
      canDelete: canDeleteFolders,
      onMove: canManageFolders ? () => openMove(doc.id) : undefined,
      onEdit: canRenameFolders ? () => setNameEdit(doc) : undefined,
      onDeleteFolder: canDeleteFolders ? () => setRetireTarget(doc) : undefined,
      onDeleteTemplate: canManageFolders
        ? () => {
            if (confirm(`Remove "${doc.name}" from this folder? It will not be put back.`)) deleteFolder.mutate(doc.id);
          }
        : undefined,
      onSendToLibrary: canManageFolders && !extras?.pool && poolFolder ? () => sendToLibrary(doc.id) : undefined,
      onAttach: () => requestUpload(doc.id),
      onRemove: doc.pdfPath ? () => setPendingRemoval(doc) : undefined,
      onView: doc.pdfPath
        ? () => {
            const kind = previewKind(attachedFileName(doc), doc.pdfMimeType);
            if (kind === "download") void downloadFolderFile(doc);
            else setFilePreview(folderFilePreview(doc));
          }
        : undefined,
      onDownload: doc.pdfPath ? () => void downloadFolderFile(doc) : undefined,
      onComments: () => setCommentDoc(doc),
      onUploadInto: item.type === "folder" ? () => requestDocumentUpload(doc.id) : undefined,
      onPoolDelete: extras?.pool && canManageFolders ? () => void removePoolItems([doc.id]) : undefined,
      poolDeletePending,
      onCopy: copyItemPath,
    });
  }

  const removal = pendingRemoval ? savedItemRemoval(pendingRemoval, visibleFolders.some((folder) => folder.parentId === pendingRemoval.id)) : null;

  if (isLoading) {
    return (
      <div className="folder-explorer" aria-busy="true" aria-label="Loading folders">
        <div className="skeleton h-8 w-64" />
        <div className="skeleton h-4 w-full max-w-xl" />
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="skeleton h-9" style={{ width: `${92 - (index % 4) * 8}%` }} />
        ))}
      </div>
    );
  }
  if (!activeDept) return <p className="folder-explorer text-sm text-muted-foreground">No departments found.</p>;
  const deptChain = folderChain(visibleFolders, activeDept.id);
  const deptPath = folderNodePath(visibleFolders, activeDept.id);
  const deptParent = deptChain.length > 1 ? deptChain[deptChain.length - 2] : undefined;
  const movingFolder = movingId == null ? undefined : folders.find((folder) => folder.id === movingId);

  const treeRoots = (isoRoot ? [isoRoot, ...departments.filter((dept) => dept.parentId !== isoRoot.id)] : departments)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  return (
    <div className="folder-explorer">
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
            Expand a folder to see what is saved in it. Move to… files a folder or saved item somewhere else, and the folder takes everything inside it with it. You can also drag a row onto a folder, or drop on the line between rows to change the order. Blank templates are in Blank Forms Templates.
          </p>
        </div>
        <div className="w-56">
          <TextField label="" placeholder="Filter documents…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div ref={boardPaneRef} className="folder-explorer-board">
        <nav ref={treePaneRef} className="folder-explorer-pane flex flex-col gap-1 rounded-lg border border-border bg-card p-2" aria-label="Document folders">
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
                draggable={canManageFolders}
                isoRoot={folder.id === isoRoot?.id}
                trailingGap={false}
                dragKind={dragKind}
                gapHint={gapHint}
                expandingId={expandingId}
                busy={isFetching}
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
                onMove={canManageFolders ? (row) => openMove(row.id) : undefined}
                onEditFolder={canRenameFolders ? (row) => setNameEdit(row) : undefined}
                onDeleteFolder={canDeleteFolders ? (row) => setRetireTarget(row) : undefined}
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

          {canManageFolders && (
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
          )}
        </nav>

        <div ref={listPaneRef} className="folder-explorer-pane flex min-w-0 flex-col gap-2">
          {requestedFolderId != null && !openFolder ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                {hiddenBlank ? "Those blank templates are in Blank Forms Templates." : "That folder is not in Documents."}
              </p>
              {hiddenBlank && (
                <Link to={blankFormsFolderHref()} className="w-fit text-sm text-primary hover:underline">
                  Open Blank Forms Templates
                </Link>
              )}
              <button type="button" onClick={showDepartmentList} className="w-fit text-sm text-primary hover:underline">
                Back to departments
              </button>
            </div>
          ) : openFolder?.removedFromLibraryPool ? (
            <KeptPoolFile
              doc={openFolder}
              onMove={canManageFolders ? () => openMove(openFolder.id) : undefined}
              moveDisabled={movePending}
              onAttach={() => requestUpload(openFolder.id)}
              onRemoveAttachment={() => setPendingRemoval(openFolder)}
            />
          ) : openFolder ? (
            <FolderBrowser
              folder={openFolder}
              folders={visibleFolders}
              query={query}
              hintClass={hintClass}
              onOpenFolder={showFolder}
              onBackToDepartments={showDepartmentList}
              canBack={canGoBack(history)}
              canForward={canGoForward(history)}
              onBack={() => goHistory(-1)}
              onForward={() => goHistory(1)}
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
              onRename={(id, name) =>
                updateFolder.mutate(
                  { id, name },
                  {
                    onError: (err) => void extractErrorMessageAsync(err, "Couldn't rename that folder.").then((message) => toast.error(message)),
                  },
                )
              }
              onMove={(id) => openMove(id)}
              onEditFolder={canRenameFolders ? (row) => setNameEdit(row) : undefined}
              onDeleteFolder={canDeleteFolders ? (row) => setRetireTarget(row) : undefined}
              folderActionPending={updateFolder.isPending || retireFolder.isPending}
              canManage={canManageFolders}
              detailActions={actionsFor}
              dragKind={dragKind}
              gapHint={gapHint}
              onGapOver={hoverGap}
              onGapLeave={leaveGap}
              onGapDrop={dropGap}
            />
          ) : (
          <>
          <ExplorerPathBar
            crumbs={explorerCrumbs(deptChain)}
            canBack={canGoBack(history)}
            canForward={canGoForward(history)}
            canUp={deptParent != null}
            onBack={() => goHistory(-1)}
            onForward={() => goHistory(1)}
            onUp={() => {
              if (deptParent) selectTreeFolder(deptParent);
            }}
            onCrumb={(id) => {
              if (id == null) return;
              const target = visibleFolders.find((row) => row.id === id);
              if (target) selectTreeFolder(target);
            }}
          />
          <FolderPathBar path={deptPath} />
          <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <FolderOpen size={18} className="shrink-0 text-primary" />
            <h2 className="text-lg font-semibold">{activeDept.name}</h2>
            <button type="button" onClick={() => showFolder(activeDept.id)} className="text-xs text-primary hover:underline">
              Open
            </button>
            {canManageFolders && activeDept.name !== LIBRARY_POOL_NAME && (
              <button type="button" data-testid="move-to" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => openMove(activeDept.id)}>
                Move to…
              </button>
            )}
            {activeDept.name !== LIBRARY_POOL_NAME && activeDept.name !== "ISO Compliance Documents" && (
              <FolderActionButtons
                canRename={canRenameFolders}
                canDelete={canDeleteFolders}
                pending={updateFolder.isPending || retireFolder.isPending}
                onEdit={() => setNameEdit(activeDept)}
                onDelete={() => setRetireTarget(activeDept)}
              />
            )}
            <button
              onClick={() => requestDocumentUpload(activeDept.id)}
              className="ml-1 flex items-center gap-1 rounded-md border border-primary px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
              title={`Upload a document directly into ${activeDept.name}`}
            >
              <UploadCloud size={13} />
              Upload Document
            </button>
          </div>

          <FileDropZone
            onFiles={(dropped) => void uploadFiles(activeDept.id, dropped)}
            overlay={false}
            className="shrink-0 rounded-lg border-2 border-dashed border-border px-4 py-2 text-center text-xs text-muted-foreground transition-colors hover:border-primary/50"
          >
            <span className="inline-flex items-center gap-2">
              <UploadCloud size={14} /> Drag files from your computer onto {activeDept.name}, or onto any folder below, to add them as documents
            </span>
          </FileDropZone>

          <div
            onDragOver={(event) => {
              if (isFileDrag(event)) return;
              allowDrop(event, activeDept.id);
            }}
            onDrop={(event) => {
              if (isFileDrag(event)) return;
              dropOnParent(event, activeDept.id);
            }}
          >
            <FolderContentsList
              items={detailItems(activeDept.id)}
              testId="folder-details"
              empty={<EmptyFolder filtered={query.length > 0} />}
              onOpen={(item) => {
                if (item.type === "folder") showFolder(item.node.id);
              }}
              actions={(item) => actionsFor(item, deptChain.map((crumb) => crumb.name))}
              rowProps={(item) => ({
                draggable: canManageFolders,
                onDragStart: (event) => {
                  event.stopPropagation();
                  beginDrag(event, item.node.id, item.type === "folder" ? "folder" : "doc");
                },
                onDragEnd: endDrag,
                onDragOver: (event) => hoverRow(event, item.node),
                onDragLeave: () => leaveRow(item.node.id),
                onDrop: (event) => dropRow(event, item.node),
                className: hintClass(item.node.id),
              })}
              renderBefore={(item) => {
                const kind = item.type === "folder" ? "folder" : "doc";
                if (dragKind !== kind) return null;
                const before = gapKey(activeDept.id, item.node.id, kind);
                return (
                  <SiblingGap
                    active={gapHint === before}
                    className="h-3"
                    onDragOver={(event) => hoverGap(event, activeDept.id, item.node.id, kind)}
                    onDragLeave={() => leaveGap(before)}
                    onDrop={(event) => dropGap(event, activeDept.id, item.node.id, kind)}
                  />
                );
              }}
            />
            {dragKind === "folder" && (
              <SiblingGap
                active={gapHint === gapKey(activeDept.id, null, "folder")}
                className="h-3"
                onDragOver={(event) => hoverGap(event, activeDept.id, null, "folder")}
                onDragLeave={() => leaveGap(gapKey(activeDept.id, null, "folder"))}
                onDrop={(event) => dropGap(event, activeDept.id, null, "folder")}
              />
            )}
            {dragKind === "doc" && (
              <SiblingGap
                active={gapHint === gapKey(activeDept.id, null, "doc")}
                className="h-3"
                onDragOver={(event) => hoverGap(event, activeDept.id, null, "doc")}
                onDragLeave={() => leaveGap(gapKey(activeDept.id, null, "doc"))}
                onDrop={(event) => dropGap(event, activeDept.id, null, "doc")}
              />
            )}
          </div>

          {canManageFolders && (
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
          )}
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
          className={`folder-explorer-pool rounded-lg border bg-card transition-colors ${
            poolHover ? "border-primary ring-1 ring-inset ring-primary" : "border-border"
          }`}
        >
          <div className="flex flex-col gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <Inbox size={16} className="flex-none text-muted-foreground" />
              <span className="flex-none text-sm font-medium">Library Pool</span>
              <span className="flex-none rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{poolItems.length}</span>
              {canManageFolders && poolItems.length > 0 && (
                <div className="flex flex-none items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      data-testid="pool-select-all"
                      disabled={poolDeletePending}
                      checked={poolItems.every((item) => poolSelection.includes(item.id))}
                      onChange={(event) => setPoolSelection(event.target.checked ? poolItems.map((item) => item.id) : [])}
                    />
                    All
                  </label>
                  <button
                    type="button"
                    data-testid="pool-delete-selected"
                    disabled={poolSelection.length === 0 || poolDeletePending}
                    onClick={() => void removePoolItems(poolSelection)}
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive hover:bg-destructive/15 disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
            {detailItems(poolFolder.id).length === 0 ? (
              <p className="px-4 pb-3 text-xs italic text-muted-foreground">Empty — drag a document here to unassign it</p>
            ) : (
            <FolderContentsList
              items={detailItems(poolFolder.id)}
              testId="library-pool-details"
              empty={<span className="block px-2 py-3 text-xs italic text-muted-foreground">Empty — drag a document here to unassign it</span>}
              leading={
                canManageFolders
                  ? (item) => (
                      <input
                        type="checkbox"
                        data-testid="pool-select"
                        aria-label={`Select ${item.node.name}`}
                        disabled={poolDeletePending}
                        checked={poolSelection.includes(item.node.id)}
                        onChange={(event) =>
                          setPoolSelection((current) => (event.target.checked ? [...current, item.node.id] : current.filter((id) => id !== item.node.id)))
                        }
                        onClick={(event) => event.stopPropagation()}
                      />
                    )
                  : undefined
              }
              actions={(item) => actionsFor(item, [poolFolder.name], { pool: true })}
              rowProps={(item) => ({
                draggable: canManageFolders,
                onDragStart: (event) => {
                  event.stopPropagation();
                  beginDrag(event, item.node.id, "doc");
                },
                onDragEnd: endDrag,
                onDragOver: (event) => hoverRow(event, item.node),
                onDragLeave: () => leaveRow(item.node.id),
                onDrop: (event) => dropRow(event, item.node),
                className: hintClass(item.node.id),
              })}
            />
            )}
          </div>
        </div>
      )}
      {movingFolder && (
        <MoveToFolderDialog folders={visibleFolders} moving={movingFolder} pending={movePending} onClose={() => { if (!movePending) setMovingId(null); }} onMove={(parentId) => void moveInto(parentId)} />
      )}
      <RenameFolderDialog
        open={nameEdit != null}
        name={nameEdit?.name ?? ""}
        pending={updateFolder.isPending}
        onClose={() => {
          if (!updateFolder.isPending) setNameEdit(null);
        }}
        onSave={(name) => {
          if (!nameEdit) return;
          updateFolder.mutate(
            { id: nameEdit.id, name },
            {
              onSuccess: () => {
                toast.success("Folder renamed.");
                setNameEdit(null);
              },
              onError: (err) => void extractErrorMessageAsync(err, "Couldn't rename that folder.").then((message) => toast.error(message)),
            },
          );
        }}
      />
      <DeleteFolderDialog
        open={retireTarget != null}
        folderName={retireTarget?.name ?? ""}
        folderId={retireTarget?.id ?? null}
        folders={visibleFolders}
        savedCount={retireTarget ? (documentFolderHasContents(retireTarget, visibleFolders) ? Math.max(1, visibleFolders.filter((folder) => folder.parentId === retireTarget.id).length) : 0) : 0}
        pending={retireFolder.isPending}
        onClose={() => {
          if (!retireFolder.isPending) setRetireTarget(null);
        }}
        onConfirm={(destinationId) => {
          if (!retireTarget) return;
          retireFolder.mutate(
            { id: retireTarget.id, destinationId },
            {
              onSuccess: () => {
                toast.success("Folder deleted.");
                setRetireTarget(null);
              },
              onError: (err) => void extractErrorMessageAsync(err, "Couldn't delete that folder.").then((message) => toast.error(message)),
            },
          );
        }}
      />
      <RemoveSavedFileDialog
        open={pendingRemoval != null}
        removal={removal}
        pending={removeTemplate.isPending}
        onClose={() => {
          if (!removeTemplate.isPending) setPendingRemoval(null);
        }}
        onConfirm={() => {
          if (!pendingRemoval) return;
          removeTemplate.mutate(pendingRemoval.id, { onSuccess: () => setPendingRemoval(null) });
        }}
      />
      <InAppFilePreview request={filePreview} onClose={() => setFilePreview(null)} />
      <Modal title={commentDoc ? `Comments · ${commentDoc.name}` : "Comments"} isOpen={commentDoc != null} onClose={() => setCommentDoc(null)} wide>
        {commentDoc && (commentDoc.documentId ? <DocumentCommentThread documentId={commentDoc.documentId} canComment /> : <DocumentCommentThread folderId={commentDoc.id} canComment />)}
      </Modal>
    </div>
  );
}

/** A pool item after Delete. The file and the record stay, and this page is their direct link. */
function KeptPoolFile({
  doc,
  onMove,
  moveDisabled,
  onAttach,
  onRemoveAttachment,
}: {
  doc: DocumentFolder;
  onMove?: () => void;
  moveDisabled: boolean;
  onAttach: () => void;
  onRemoveAttachment: () => void;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="kept-file">
      <h2 className="text-lg font-semibold">{doc.name}</h2>
      <p className="text-sm text-muted-foreground">Removed from the Library Pool. Nothing was deleted from AccuQual.</p>
      <div>
        <DocPill
          doc={doc}
          fill
          moveDisabled={moveDisabled}
          onDragStart={() => undefined}
          onDragEnd={() => undefined}
          onAttach={onAttach}
          onRemoveAttachment={onRemoveAttachment}
          onMove={onMove}
        />
      </div>
      {doc.documentId != null && (
        <Link to={`/documents/${doc.documentId}`} className="w-fit text-sm text-primary hover:underline">
          Open the record
        </Link>
      )}
      {doc.linkedPath && (
        <Link to={doc.linkedPath} className="w-fit text-sm text-primary hover:underline">
          Open the record
        </Link>
      )}
    </div>
  );
}

function DocPill({
  doc,
  fill,
  moveDisabled,
  onDragStart,
  onDragEnd,
  onSendToLibrary,
  onAttach,
  onRemoveAttachment,
  onMove,
}: {
  doc: DocumentFolder;
  fill?: boolean;
  moveDisabled?: boolean;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  onSendToLibrary?: () => void;
  onAttach: () => void;
  onRemoveAttachment: () => void;
  onMove?: () => void;
}) {
  const [preview, setPreview] = useState<PreviewRequest | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);

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
    <div
      draggable
      onDragStart={(event) => {
        event.stopPropagation();
        onDragStart(event);
      }}
      onDragEnd={onDragEnd}
      className={`${fill ? "flex min-w-0 flex-1" : "inline-flex"} cursor-grab items-center gap-1.5 rounded-full border px-3 py-1 text-xs active:cursor-grabbing ${
        doc.linkedPath ? "border-primary/40 bg-primary/10" : "border-border bg-muted"
      }`}
      title={doc.pdfPath ? "Has an attached file — click the file icon to view/download it" : "No file attached yet"}
    >
      {doc.linkedPath ? (
        <Link to={doc.linkedPath} draggable={false} className={`text-primary hover:underline ${fill ? "min-w-0 flex-1 truncate" : ""}`} title={doc.name}>
          {doc.name}
        </Link>
      ) : (
        <span className={fill ? "min-w-0 flex-1 truncate" : undefined} title={doc.name}>{doc.name}</span>
      )}
      {doc.documentId && (
        <Link to={`/documents/${doc.documentId}`} draggable={false} className="hover:opacity-80" title="Open the controlled document (revision history, approval, retention)">
          <StatusBadge value={doc.documentExpirationStatus ?? doc.documentStatus ?? "draft"} />
        </Link>
      )}
      {doc.pdfPath ? (
        <>
          <button onClick={viewAttachment} className="text-primary hover:opacity-80" title={previewKind(attachedFileName(), doc.pdfMimeType) === "pdf" ? "View PDF" : "View file"} aria-label={`View attached file for ${doc.name}`}>
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
      <button type="button" onClick={() => setCommentsOpen(true)} className="text-muted-foreground hover:text-primary" title="Comments" aria-label={`Comments on ${doc.name}`}>
        <MessageSquare size={12} />
      </button>
      <Modal title={`Comments · ${doc.name}`} isOpen={commentsOpen} onClose={() => setCommentsOpen(false)} wide>
        {doc.documentId ? (
          <DocumentCommentThread documentId={doc.documentId} canComment />
        ) : (
          <DocumentCommentThread folderId={doc.id} canComment />
        )}
      </Modal>
      {onMove && (
        <button type="button" data-testid="move-to" disabled={moveDisabled} onClick={onMove} className="text-primary hover:underline disabled:opacity-40" aria-label={`Move ${doc.name} to another folder`}>
          Move to…
        </button>
      )}
      {onSendToLibrary && (
        <button onClick={onSendToLibrary} className="text-muted-foreground hover:text-destructive" aria-label={`Send ${doc.name} to the library pool`}>
          <Inbox size={12} />
        </button>
      )}
    </div>
  );
}

function EmptyFolder({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border border-dashed border-border px-3 py-3 text-center" data-testid="folder-empty">
      <Folder size={18} className="text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{filtered ? "Nothing in this folder matches." : "Nothing saved in this folder yet."}</p>
      {!filtered && <p className="text-xs text-muted-foreground">Blank templates are in Blank Forms Templates. A form shows up here after it is saved into this folder.</p>}
    </div>
  );
}

function ExplorerPathBar({
  crumbs,
  canBack,
  canForward,
  canUp,
  onBack,
  onForward,
  onUp,
  onCrumb,
}: {
  crumbs: { id: number | null; name: string }[];
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onCrumb: (id: number | null) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5">
      <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40" aria-label="Back" disabled={!canBack} onClick={onBack}>
        <ChevronLeft size={16} />
      </button>
      <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40" aria-label="Forward" disabled={!canForward} onClick={onForward}>
        <ChevronRight size={16} />
      </button>
      <button type="button" className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40" disabled={!canUp} onClick={onUp}>
        Up
      </button>
      <button
        type="button"
        data-testid="copy-folder-path"
        className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => {
          const path = folderPathLabel(crumbs.map((crumb) => crumb.name));
          void navigator.clipboard?.writeText(path);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy path"}
      </button>
      <nav aria-label="Folder path" data-testid="folder-breadcrumbs" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <span key={`${crumb.id ?? "root"}-${index}`} className="inline-flex min-w-0 items-center gap-1">
              {index > 0 && <span className="text-muted-foreground">/</span>}
              {last ? (
                <span className="truncate font-semibold" data-testid="folder-title" title={crumb.name}>
                  {crumb.name}
                </span>
              ) : (
                <button type="button" className="truncate text-primary hover:underline" title={crumb.name} onClick={() => onCrumb(crumb.id)}>
                  {crumb.name}
                </button>
              )}
            </span>
          );
        })}
      </nav>
    </div>
  );
}

function FolderBrowser({
  folder,
  folders,
  query,
  hintClass,
  onOpenFolder,
  onBackToDepartments,
  canBack,
  canForward,
  onBack,
  onForward,
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
  onMove,
  onEditFolder,
  onDeleteFolder,
  folderActionPending,
  canManage,
  detailActions,
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
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
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
  onMove: (id: number) => void;
  onEditFolder?: (folder: DocumentFolder) => void;
  onDeleteFolder?: (folder: DocumentFolder) => void;
  folderActionPending?: boolean;
  canManage: boolean;
  detailActions: (item: FolderDetailItem<DocumentFolder>, parentNames: string[]) => FolderRowAction[];
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
  const selectedPath = joinFolderPath(chain.map((crumb) => crumb.name));
  const parent = chain.length > 1 ? chain[chain.length - 2] : undefined;
  const items = folderContents(folders, folder.id).filter((item) => !query || `${item.label} ${item.node.name}`.toLowerCase().includes(query));
  const canRename = canManage && folder.name !== LIBRARY_POOL_NAME;

  return (
    <div className="flex flex-col gap-2" data-testid="folder-browser">
      <ExplorerPathBar
        crumbs={explorerCrumbs(chain)}
        canBack={canBack}
        canForward={canForward}
        canUp={parent != null || chain.length > 0}
        onBack={onBack}
        onForward={onForward}
        onUp={() => (parent ? onOpenFolder(parent.id) : onBackToDepartments())}
        onCrumb={(id) => (id == null ? onBackToDepartments() : onOpenFolder(id))}
      />
      <FolderPathBar path={selectedPath} />

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
        {onEditFolder || onDeleteFolder ? (
          folder.name !== LIBRARY_POOL_NAME && folder.name !== "ISO Compliance Documents" && (
            <FolderActionButtons
              canRename={onEditFolder != null}
              canDelete={onDeleteFolder != null}
              pending={folderActionPending}
              onEdit={() => onEditFolder?.(folder)}
              onDelete={() => onDeleteFolder?.(folder)}
            />
          )
        ) : (
          canRename && !renaming && (
            <button
              type="button"
              onClick={() => {
                setRename(folder.name);
                setRenaming(true);
              }}
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
            >
              Edit folder
            </button>
          )
        )}
        {canManage && folder.name !== LIBRARY_POOL_NAME && (
          <button type="button" data-testid="move-to" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => onMove(folder.id)}>
            Move to…
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
          <button type="submit" disabled={folderActionPending} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60">
            {folderActionPending ? "Saving…" : "Save name"}
          </button>
          <button type="button" onClick={() => setRenaming(false)} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
            Cancel
          </button>
        </form>
      )}

      <FileDropZone
        onFiles={(dropped) => void onUploadFiles(folder.id, dropped)}
        overlay={false}
        className="shrink-0 rounded-lg border-2 border-dashed border-border px-4 py-2 text-center text-xs text-muted-foreground transition-colors hover:border-primary/50"
      >
        <span className="inline-flex items-center gap-2">
          <UploadCloud size={14} /> Drag files from your computer onto {folder.name} to add them as documents
        </span>
      </FileDropZone>

      <div
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
        <FolderContentsList
          items={items}
          testId="folder-details"
          empty={<EmptyFolder filtered={query.length > 0} />}
          onOpen={(item) => {
            if (item.type === "folder") onOpenFolder(item.node.id);
          }}
          actions={(item) => detailActions(item, chain.map((crumb) => crumb.name))}
          rowProps={(item) => ({
            draggable: canManage,
            onDragStart: (event) => {
              event.stopPropagation();
              onBeginDrag(event, item.node.id, item.type === "folder" ? "folder" : "doc");
            },
            onDragEnd: onEndDrag,
            onDragOver: (event) => onHoverRow(event, item.node),
            onDragLeave: () => onLeaveRow(item.node.id),
            onDrop: (event) => onDropRow(event, item.node),
            className: hintClass(item.node.id),
          })}
          renderBefore={(item) => {
            const kind = item.type === "folder" ? "folder" : "doc";
            if (dragKind !== kind) return null;
            const before = gapKey(folder.id, item.node.id, kind);
            return (
              <SiblingGap
                active={gapHint === before}
                className="h-3"
                onDragOver={(event) => onGapOver(event, folder.id, item.node.id, kind)}
                onDragLeave={() => onGapLeave(before)}
                onDrop={(event) => onGapDrop(event, folder.id, item.node.id, kind)}
              />
            );
          }}
        />
        {dragKind === "folder" && (
          <SiblingGap
            active={gapHint === gapKey(folder.id, null, "folder")}
            className="h-3"
            onDragOver={(event) => onGapOver(event, folder.id, null, "folder")}
            onDragLeave={() => onGapLeave(gapKey(folder.id, null, "folder"))}
            onDrop={(event) => onGapDrop(event, folder.id, null, "folder")}
          />
        )}
        {dragKind === "doc" && (
          <SiblingGap
            active={gapHint === gapKey(folder.id, null, "doc")}
            className="h-3"
            onDragOver={(event) => onGapOver(event, folder.id, null, "doc")}
            onDragLeave={() => onGapLeave(gapKey(folder.id, null, "doc"))}
            onDrop={(event) => onGapDrop(event, folder.id, null, "doc")}
          />
        )}
      </div>

      {canManage && (
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
      )}
    </div>
  );
}
