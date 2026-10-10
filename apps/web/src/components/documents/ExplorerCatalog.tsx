import type { HTMLAttributes, MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ExplorerView } from "../../lib/explorerView";
import "./explorerView.css";

export interface CatalogColumn<T> {
  key: string;
  label: string;
  render: (item: T) => ReactNode;
  align?: "left" | "right";
}

/**
 * List, details, small icons, and large icons for a page that is not the folder grid.
 * The grid grows with its items. The page scrolls.
 */
export function ExplorerCatalog<T>({
  items,
  view,
  title,
  icon,
  largeVisual,
  href,
  onOpen,
  onRowClick,
  columns,
  trailing,
  testId,
  itemTestId,
  itemAttrs,
  selected,
  disabled,
  empty,
}: {
  items: T[];
  view: ExplorerView;
  title: (item: T) => string;
  icon: (item: T) => ReactNode;
  largeVisual?: (item: T) => ReactNode;
  href?: (item: T) => string | null;
  onOpen?: (item: T) => void;
  onRowClick?: (item: T) => void;
  columns: CatalogColumn<T>[];
  trailing?: (item: T) => ReactNode;
  testId?: string;
  itemTestId?: (item: T) => string | undefined;
  itemAttrs?: (item: T) => HTMLAttributes<HTMLElement> & Record<`data-${string}`, string | undefined>;
  selected?: (item: T) => boolean;
  disabled?: (item: T) => boolean;
  empty?: ReactNode;
}) {
  if (items.length === 0) return empty ?? null;

  if (view === "small" || view === "large") {
    return (
      <div className="explorer-icons" data-explorer-view={view} data-testid={testId} role="list">
        {items.map((item, index) => {
          const name = title(item);
          const picked = selected?.(item) ?? false;
          return (
            <div
              key={itemKey(item, index)}
              role="listitem"
              data-testid={itemTestId?.(item)}
              {...itemAttrs?.(item)}
              title={name}
              className={`explorer-tile ${view === "large" ? "explorer-tile-large" : "explorer-tile-small"} rounded-lg border border-border bg-card px-2 py-2 text-foreground hover:bg-muted ${picked ? "bg-primary/10" : ""}`}
              onClick={(event) => activate(event, item, href?.(item), onOpen, onRowClick, disabled)}
            >
              <div className="explorer-tile-visual">{view === "large" ? (largeVisual?.(item) ?? icon(item)) : icon(item)}</div>
              <OpenControl item={item} name={name} href={href?.(item) ?? null} onOpen={onOpen} disabled={disabled?.(item) ?? false} className="explorer-tile-title text-xs font-medium text-primary" />
              {trailing && <span data-row-chrome="">{trailing(item)}</span>}
            </div>
          );
        })}
      </div>
    );
  }

  if (view === "details") {
    const template = `minmax(0, 1.7fr) ${columns.map(() => "minmax(0, 1fr)").join(" ")}${trailing ? " auto" : ""}`;
    return (
      <div className="explorer-details rounded-lg border border-border bg-card text-sm text-foreground" data-explorer-view="details" data-testid={testId} role="table">
        <div role="row" className="explorer-detail-row border-b border-border bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground" style={{ gridTemplateColumns: template }}>
          <span role="columnheader">Name</span>
          {columns.map((column) => (
            <span key={column.key} role="columnheader" className={column.align === "right" ? "text-right" : "text-left"}>
              {column.label}
            </span>
          ))}
          {trailing && (
            <span role="columnheader" className="sr-only">
              Actions
            </span>
          )}
        </div>
        {items.map((item, index) => {
          const name = title(item);
          const picked = selected?.(item) ?? false;
          return (
            <div
              key={itemKey(item, index)}
              role="row"
              data-testid={itemTestId?.(item)}
              {...itemAttrs?.(item)}
              title={name}
              className={`explorer-detail-row cursor-pointer border-b border-border px-2 py-1.5 last:border-b-0 hover:bg-muted ${picked ? "bg-primary/10" : ""}`}
              style={{ gridTemplateColumns: template }}
              onClick={(event) => activate(event, item, href?.(item), onOpen, onRowClick, disabled)}
            >
              <OpenControl item={item} name={name} href={href?.(item) ?? null} onOpen={onOpen} disabled={disabled?.(item) ?? false} className="explorer-name font-medium text-primary" />
              {columns.map((column) => (
                <div key={column.key} className={`min-w-0 text-muted-foreground ${column.align === "right" ? "text-right" : ""}`}>
                  {column.render(item)}
                </div>
              ))}
              {trailing && <span data-row-chrome="">{trailing(item)}</span>}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="explorer-list rounded-lg border border-border bg-card text-sm text-foreground" data-explorer-view="list" data-testid={testId} role="list">
      {items.map((item, index) => {
        const name = title(item);
        const picked = selected?.(item) ?? false;
        return (
          <div
            key={itemKey(item, index)}
            role="listitem"
            data-testid={itemTestId?.(item)}
            {...itemAttrs?.(item)}
            title={name}
            className={`flex min-w-0 cursor-pointer items-center gap-2 border-b border-border px-2 py-1.5 last:border-b-0 hover:bg-muted ${picked ? "bg-primary/10" : ""}`}
            onClick={(event) => activate(event, item, href?.(item), onOpen, onRowClick, disabled)}
          >
            <span className="shrink-0 text-muted-foreground">{icon(item)}</span>
            <OpenControl item={item} name={name} href={href?.(item) ?? null} onOpen={onOpen} disabled={disabled?.(item) ?? false} className="explorer-name flex-1 text-left font-medium text-primary" />
            {trailing && <span data-row-chrome="">{trailing(item)}</span>}
          </div>
        );
      })}
    </div>
  );
}

function itemKey(item: unknown, index: number): string {
  if (item && typeof item === "object") {
    const row = item as { formKey?: string; recordId?: number; fileName?: string; id?: number };
    if (row.formKey) return row.formKey;
    if (row.recordId != null) return `${row.recordId}-${row.fileName ?? index}`;
    if (row.id != null) return String(row.id);
  }
  return String(index);
}

function activate<T>(
  event: MouseEvent,
  item: T,
  href: string | null | undefined,
  onOpen: ((item: T) => void) | undefined,
  onRowClick: ((item: T) => void) | undefined,
  disabled: ((item: T) => boolean) | undefined,
) {
  const target = event.target as HTMLElement;
  if (target.closest("[data-row-chrome]")) return;
  if (disabled?.(item)) return;
  onRowClick?.(item);
  if (!href && !target.closest("a,button")) onOpen?.(item);
}

function OpenControl<T>({
  item,
  name,
  href,
  onOpen,
  disabled,
  className,
}: {
  item: T;
  name: string;
  href: string | null;
  onOpen?: (item: T) => void;
  disabled: boolean;
  className: string;
}) {
  if (href) {
    return (
      <Link to={href} title={name} className={`${className} hover:underline`}>
        {name}
      </Link>
    );
  }
  return (
    <button
      type="button"
      title={name}
      disabled={disabled}
      className={`${className} hover:underline disabled:opacity-60`}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onOpen?.(item);
      }}
    >
      {name}
    </button>
  );
}
