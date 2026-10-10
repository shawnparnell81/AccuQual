import { useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { File, FileText, Folder, LayoutTemplate, List, MoreHorizontal } from "lucide-react";
import { StatusBadge } from "../tables/StatusBadge";
import { formatDate } from "../../lib/dates";
import { fileThumbnailKind, storedFileName, type ExplorerView } from "../../lib/explorerView";
import {
  sortFolderDetails,
  type FolderDetailItem,
  type FolderDetailNode,
  type FolderDetailSort,
  type FolderDetailSortKey,
  type FolderItemType,
} from "../../lib/folderDetails";
import { FileThumbnail } from "./FileThumbnail";
import "./explorerView.css";

export interface FolderRowAction {
  id: string;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  testId?: string;
}

const COLUMNS: { key: FolderDetailSortKey; label: string; className: string }[] = [
  { key: "name", label: "Name", className: "min-w-0" },
  { key: "type", label: "Type", className: "" },
  { key: "revision", label: "Rev", className: "" },
  { key: "modified", label: "Modified", className: "" },
  { key: "modifiedBy", label: "Modified by", className: "" },
];

function ItemIcon({ type, size = 15 }: { type: FolderItemType; size?: number }) {
  const className = type === "file" ? "shrink-0 text-muted-foreground" : "shrink-0 text-primary";
  if (type === "folder") return <Folder size={size} className={className} aria-hidden />;
  if (type === "controlled list") return <List size={size} className={className} aria-hidden />;
  if (type === "template") return <LayoutTemplate size={size} className={className} aria-hidden />;
  if (type === "form") return <FileText size={size} className={className} aria-hidden />;
  return <File size={size} className={className} aria-hidden />;
}

function LargeMark<T extends FolderDetailNode>({ item }: { item: FolderDetailItem<T> }) {
  const fallback = <ItemIcon type={item.type} size={40} />;
  const stored = item.node.pdfPath;
  const mime = "pdfMimeType" in item.node ? (item.node as { pdfMimeType?: string | null }).pdfMimeType : undefined;
  const fileName = storedFileName(item.node.name, stored);
  if (!stored || fileThumbnailKind(fileName, mime) === "none") return <div className="explorer-tile-visual">{fallback}</div>;
  return <FileThumbnail folderId={item.node.id} fileName={fileName} mimeType={mime} fallback={fallback} />;
}

function RowMenu({ name, actions }: { name: string; actions: FolderRowAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (actions.length === 0) return <span className="w-7" />;
  return (
    <div ref={ref} className="relative" data-row-chrome="">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${name}`}
        className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-8 z-20 flex min-w-44 flex-col rounded-md border border-border bg-card p-1 text-left text-foreground shadow-sm">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              data-testid={action.testId}
              disabled={action.disabled}
              className={`rounded px-2 py-1 text-left text-xs hover:bg-muted disabled:opacity-40 ${action.destructive ? "text-destructive" : "text-foreground"}`}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                action.onClick();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemName<T extends FolderDetailNode>({ item, onOpen, className }: { item: FolderDetailItem<T>; onOpen?: (item: FolderDetailItem<T>) => void; className: string }) {
  if (item.href) {
    return (
      <Link
        to={item.href}
        data-testid={item.type === "folder" ? undefined : "saved-file"}
        data-open-id={item.node.id}
        className={className}
        title={item.label}
        onClick={(event) => event.stopPropagation()}
      >
        {item.label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={className}
      data-testid={item.type === "folder" ? "folder-title" : "saved-file"}
      title={item.label}
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.(item);
      }}
    >
      {item.label}
    </button>
  );
}

/**
 * One folder's children. List is icon and name. Details adds every column.
 * Small and large icons keep the same drag and move actions. Nothing here scrolls on its own.
 */
export function FolderContentsList<T extends FolderDetailNode>({
  items,
  empty,
  testId = "folder-details",
  view = "list",
  onOpen,
  leading,
  actions,
  rowProps,
  renderBefore,
  renderAfter,
}: {
  items: FolderDetailItem<T>[];
  empty?: ReactNode;
  testId?: string;
  view?: ExplorerView;
  onOpen?: (item: FolderDetailItem<T>) => void;
  leading?: (item: FolderDetailItem<T>) => ReactNode;
  actions?: (item: FolderDetailItem<T>) => FolderRowAction[];
  rowProps?: (item: FolderDetailItem<T>) => HTMLAttributes<HTMLDivElement>;
  renderBefore?: (item: FolderDetailItem<T>, index: number) => ReactNode;
  renderAfter?: (item: FolderDetailItem<T>, index: number) => ReactNode;
}) {
  const navigate = useNavigate();
  const [sort, setSort] = useState<FolderDetailSort>({ key: "name", direction: "asc" });
  const rows = useMemo(() => sortFolderDetails(items, sort), [items, sort]);
  const grid = leading
    ? "grid-cols-[1.75rem_minmax(0,1.8fr)_minmax(0,8.5rem)_minmax(0,3.75rem)_minmax(0,9rem)_minmax(0,8rem)_2rem]"
    : "grid-cols-[minmax(0,1.8fr)_minmax(0,8.5rem)_minmax(0,3.75rem)_minmax(0,9rem)_minmax(0,8rem)_2rem]";

  function toggleSort(key: FolderDetailSortKey) {
    setSort((current) => (current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }));
  }

  function openItem(item: FolderDetailItem<T>) {
    if (item.href) navigate(item.href);
    else onOpen?.(item);
  }

  function rowShell(item: FolderDetailItem<T>) {
    const extra = rowProps?.(item) ?? {};
    const { className: extraClass = "", ...rest } = extra;
    const status = item.node.documentExpirationStatus ?? item.node.documentStatus;
    return { extraClass, rest, status };
  }

  if (view === "small" || view === "large") {
    return (
      <div className="explorer-icons" data-testid={testId} data-explorer-view={view} role="list" aria-label="Folder contents">
        {rows.length === 0 && empty}
        {rows.map((item) => {
          const { extraClass, rest, status } = rowShell(item);
          return (
            <div
              key={item.node.id}
              role="listitem"
              data-testid={item.type === "folder" ? "folder-row" : "folder-detail-row"}
              data-folder-id={item.node.id}
              data-item-type={item.type}
              data-item-label={item.label}
              title={item.label}
              {...rest}
              className={`explorer-tile ${view === "large" ? "explorer-tile-large" : "explorer-tile-small"} cursor-pointer rounded-lg border border-border bg-card px-2 py-2 text-foreground hover:bg-muted ${extraClass}`}
              onClick={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest("[data-row-chrome]") || target.closest("a,button")) return;
                openItem(item);
              }}
            >
              {leading && (
                <span data-row-chrome="" className="absolute left-1 top-1">
                  {leading(item)}
                </span>
              )}
              <span data-row-chrome="" className="absolute right-1 top-1">
                <RowMenu name={item.label} actions={actions?.(item) ?? []} />
              </span>
              {view === "large" ? <LargeMark item={item} /> : <div className="explorer-tile-visual"><ItemIcon type={item.type} size={28} /></div>}
              <ItemName item={item} onOpen={onOpen} className="explorer-tile-title text-xs font-medium text-primary hover:underline" />
              {status && <StatusBadge value={status} />}
            </div>
          );
        })}
      </div>
    );
  }

  if (view === "list") {
    return (
      <div className="explorer-list rounded-lg border border-border bg-card text-sm text-foreground" data-testid={testId} data-explorer-view="list" role="list" aria-label="Folder contents">
        {rows.length === 0 && empty}
        {rows.map((item, index) => {
          const { extraClass, rest, status } = rowShell(item);
          return (
            <div key={item.node.id} className="border-b border-border last:border-b-0">
              {renderBefore?.(item, index)}
              <div
                role="listitem"
                data-testid={item.type === "folder" ? "folder-row" : "folder-detail-row"}
                data-folder-id={item.node.id}
                data-item-type={item.type}
                data-item-label={item.label}
                title={item.label}
                {...rest}
                className={`flex min-w-0 cursor-pointer items-center gap-2 px-2 py-1.5 hover:bg-muted ${extraClass}`}
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest("[data-row-chrome]") || target.closest("a,button")) return;
                  openItem(item);
                }}
              >
                {leading && (
                  <span data-row-chrome="" className="flex justify-center">
                    {leading(item)}
                  </span>
                )}
                <ItemIcon type={item.type} />
                <ItemName item={item} onOpen={onOpen} className="explorer-name min-w-0 flex-1 text-left font-medium text-primary hover:underline" />
                {status && <StatusBadge value={status} />}
                <RowMenu name={item.label} actions={actions?.(item) ?? []} />
              </div>
              {renderAfter?.(item, index)}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="overflow-visible rounded-lg border border-border bg-card text-foreground" data-testid={testId} data-explorer-view="details">
      <div className="min-w-0" role="table" aria-label="Folder contents">
        <div role="row" className={`grid ${grid} items-center gap-2 border-b border-border bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground`}>
          {leading && <span role="columnheader" />}
          {COLUMNS.map((column) => {
            const active = sort.key === column.key;
            return (
              <button
                key={column.key}
                type="button"
                role="columnheader"
                aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                className={`${column.className} text-left hover:text-foreground ${column.key === "name" ? "" : ""}`}
                onClick={() => toggleSort(column.key)}
              >
                {column.label}
                {active ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}
              </button>
            );
          })}
          <span role="columnheader" className="sr-only">
            Actions
          </span>
        </div>
        {rows.length === 0 && empty}
        {rows.map((item, index) => {
          const extra = rowProps?.(item) ?? {};
          const { className: extraClass = "", ...rest } = extra;
          const status = item.node.documentExpirationStatus ?? item.node.documentStatus;
          return (
            <div key={item.node.id} className="border-b border-border last:border-b-0">
              {renderBefore?.(item, index)}
              <div
                role="row"
                data-testid={item.type === "folder" ? "folder-row" : "folder-detail-row"}
                data-folder-id={item.node.id}
                data-item-type={item.type}
                data-item-label={item.label}
                title={item.label}
                {...rest}
                className={`grid ${grid} cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted ${extraClass}`}
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest("[data-row-chrome]")) return;
                  openItem(item);
                }}
              >
                {leading && (
                  <span data-row-chrome="" className="flex justify-center">
                    {leading(item)}
                  </span>
                )}
                <div className="flex min-w-0 items-center gap-2">
                  <ItemIcon type={item.type} />
                  {item.href ? (
                    <Link
                      to={item.href}
                      data-testid={item.type === "folder" ? undefined : "saved-file"}
                      data-open-id={item.node.id}
                      className="min-w-0 flex-1 truncate text-left font-medium text-primary hover:underline"
                      title={item.label}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left font-medium text-foreground"
                      data-testid={item.type === "folder" ? "folder-title" : "saved-file"}
                      title={item.label}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen?.(item);
                      }}
                    >
                      {item.label}
                    </button>
                  )}
                  {status && <StatusBadge value={status} />}
                </div>
                <span className="truncate text-muted-foreground">{item.type}</span>
                <span className="truncate text-muted-foreground">{item.revision ?? "—"}</span>
                <time className="truncate text-muted-foreground" dateTime={item.modifiedAt ?? undefined}>
                  {item.modifiedAt ? formatDate(item.modifiedAt) : "—"}
                </time>
                <span className="truncate text-muted-foreground">{item.modifiedBy ?? "—"}</span>
                <RowMenu name={item.label} actions={actions?.(item) ?? []} />
              </div>
              {renderAfter?.(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
