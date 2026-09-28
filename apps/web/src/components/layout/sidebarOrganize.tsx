import { createContext, useContext, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, MoreHorizontal } from "lucide-react";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { isFullAccessRole } from "../../lib/fullAccess";
import { canViewAuditLog } from "../../lib/recordDelete";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { useToast } from "../shared/ToastProvider";
import { SIDEBAR_FOLDERS, visibleSidebar, type SidebarNode } from "./sidebarStructure";
import {
  applySidebarLayout,
  moveSidebarItem,
  nudgeSidebarItem,
  placementParent,
  placementsFromNodes,
  sidebarDestinations,
  type SidebarPlacement,
} from "../../lib/sidebarLayout";

const NAV_DRAG = "application/x-accuqual-nav";

function hasNavDrag(event: DragEvent) {
  return Array.from(event.dataTransfer.types).includes(NAV_DRAG);
}

export function useArrangedSidebar() {
  const user = useCurrentUser();
  const isAdmin = isFullAccessRole(user?.roleName);
  const showAuditLog = canViewAuditLog(user?.roleName);
  const layout = useQuery({
    queryKey: ["sidebar-layout"],
    queryFn: async () => (await apiClient.get<{ layout: SidebarPlacement[] | null }>("/company/sidebar-layout")).data.layout,
  });
  const arranged = useMemo(() => applySidebarLayout(layout.data, SIDEBAR_FOLDERS), [layout.data]);
  const folders = useMemo(() => visibleSidebar(arranged, isAdmin, { auditLog: showAuditLog }), [arranged, isAdmin, showAuditLog]);
  return { arranged, folders, isAdmin };
}

interface OrganizeApi {
  drop: (draggedKey: string, targetKey: string, position: "before" | "after" | "inside") => void;
  moveInto: (key: string, parentKey: string | null) => void;
  nudge: (key: string, direction: -1 | 1) => void;
  destinations: (key: string) => { key: string | null; label: string; depth: number }[];
  startDrag: (key: string) => void;
  readDrag: () => string | null;
  endDrag: () => void;
  reset: () => void;
  saving: boolean;
}

const OrganizeContext = createContext<OrganizeApi | null>(null);

export function SidebarOrganizeProvider({ arranged, children }: { arranged: SidebarNode[]; children: ReactNode }) {
  const toast = useToast();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: async (layout: SidebarPlacement[]) => (await apiClient.put<{ layout: SidebarPlacement[] }>("/company/sidebar-layout", { layout })).data.layout,
    onSuccess: (layout) => qc.setQueryData(["sidebar-layout"], layout),
    onError: async (err) => toast.error(await extractErrorMessageAsync(err, "Couldn't save the sidebar layout")),
  });
  const resetLayout = useMutation({
    mutationFn: async () => (await apiClient.delete<{ layout: null }>("/company/sidebar-layout")).data.layout,
    onSuccess: () => qc.setQueryData(["sidebar-layout"], null),
    onError: async (err) => toast.error(await extractErrorMessageAsync(err, "Couldn't reset the sidebar")),
  });

  function commit(next: SidebarPlacement[] | null) {
    if (!next) return;
    save.mutate(next);
  }

  const draggingKey = useRef<string | null>(null);
  const api: OrganizeApi = {
    saving: save.isPending || resetLayout.isPending,
    startDrag: (key) => {
      draggingKey.current = key;
    },
    readDrag: () => draggingKey.current,
    endDrag: () => {
      draggingKey.current = null;
    },
    destinations: (key) => sidebarDestinations(arranged, key),
    reset: () => resetLayout.mutate(),
    nudge: (key, direction) => commit(nudgeSidebarItem(placementsFromNodes(arranged), key, direction)),
    moveInto: (key, parentKey) => {
      const tree = placementsFromNodes(arranged);
      const parent = parentKey ? findChildren(tree, parentKey) : tree;
      commit(moveSidebarItem(tree, key, parentKey, parent?.length ?? 0));
    },
    drop: (draggedKey, targetKey, position) => {
      const tree = placementsFromNodes(arranged);
      const target = placementParent(tree, targetKey);
      if (!target) return;
      if (position === "inside") {
        commit(moveSidebarItem(tree, draggedKey, targetKey, findChildren(tree, targetKey)?.length ?? 0));
        return;
      }
      const index = position === "before" ? target.index : target.index + 1;
      commit(moveSidebarItem(tree, draggedKey, target.parentKey, index));
    },
  };

  return <OrganizeContext.Provider value={api}>{children}</OrganizeContext.Provider>;
}

function findChildren(tree: SidebarPlacement[], key: string): SidebarPlacement[] | null {
  for (const node of tree) {
    if (node.key === key) return node.children ?? [];
    if (node.children) {
      const nested = findChildren(node.children, key);
      if (nested) return nested;
    }
  }
  return null;
}

export function useSidebarOrganize() {
  return useContext(OrganizeContext);
}

export function useSidebarRow(itemKey: string, folder: boolean) {
  const organize = useSidebarOrganize();
  const hint = useRef<"before" | "after" | "inside" | null>(null);
  const [dropClass, setDropClass] = useState("");

  function onDragOver(event: DragEvent) {
    if (!organize || (!organize.readDrag() && !hasNavDrag(event))) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.height === 0 ? 0.5 : (event.clientY - rect.top) / rect.height;
    const next = folder ? (ratio < 0.28 ? "before" : ratio > 0.72 ? "after" : "inside") : ratio < 0.5 ? "before" : "after";
    hint.current = next;
    setDropClass(`aq-nav-drop-${next}`);
  }

  function onDrop(event: DragEvent) {
    if (!organize) return;
    event.preventDefault();
    event.stopPropagation();
    const dragged = organize.readDrag() || event.dataTransfer.getData(NAV_DRAG);
    const position = hint.current;
    hint.current = null;
    setDropClass("");
    if (!dragged || dragged === itemKey || !position) return;
    organize.drop(dragged, itemKey, position);
  }

  return {
    dropClass,
    onDragOver,
    onDragLeave: () => {
      hint.current = null;
      setDropClass("");
    },
    onDrop,
  };
}

export function SidebarResetButton() {
  const organize = useSidebarOrganize();
  if (!organize) return null;
  return (
    <button type="button" className="aq-side-reset" onClick={organize.reset} disabled={organize.saving}>
      Reset to default
    </button>
  );
}

export function SidebarDragChrome({ itemKey, label }: { itemKey: string; label: string }) {
  const organize = useSidebarOrganize();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  if (!organize) return null;
  const destinations = open ? organize.destinations(itemKey) : [];

  return (
    <div className="aq-nav-organize" ref={menuRef}>
      <button
        type="button"
        className="aq-nav-grip"
        draggable
        aria-label={`Drag ${label}`}
        title={`Drag ${label}`}
        onDragStart={(event) => {
          organize.startDrag(itemKey);
          event.dataTransfer.setData(NAV_DRAG, itemKey);
          event.dataTransfer.effectAllowed = "move";
          event.stopPropagation();
        }}
        onDragEnd={() => organize.endDrag()}
        onClick={(event) => event.preventDefault()}
      >
        <GripVertical size={14} />
      </button>
      <button
        type="button"
        className="aq-nav-move"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Move ${label}`}
        title={`Move ${label}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div className="aq-nav-move-menu" role="menu" aria-label={`Move ${label}`}>
          <button type="button" role="menuitem" onClick={() => { organize.nudge(itemKey, -1); setOpen(false); }}>
            Move up
          </button>
          <button type="button" role="menuitem" onClick={() => { organize.nudge(itemKey, 1); setOpen(false); }}>
            Move down
          </button>
          {destinations.map((destination) => (
            <button
              key={destination.key ?? "root"}
              type="button"
              role="menuitem"
              style={{ paddingLeft: 10 + destination.depth * 12 }}
              onClick={() => {
                organize.moveInto(itemKey, destination.key);
                setOpen(false);
              }}
            >
              Move to {destination.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
