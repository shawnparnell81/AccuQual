import { useRef } from "react";
import { Columns3, GalleryThumbnails, Grid3x3, List } from "lucide-react";
import { EXPLORER_VIEW_OPTIONS, explorerViewFromKey, type ExplorerView } from "../../lib/explorerView";
import "./explorerView.css";

const ICONS: Record<ExplorerView, typeof List> = {
  list: List,
  details: Columns3,
  small: Grid3x3,
  large: GalleryThumbnails,
};

/** Toolbar radiogroup: List, Details, Small icons, Large icons. */
export function ExplorerViewSwitcher({ view, onChange }: { view: ExplorerView; onChange: (view: ExplorerView) => void }) {
  const buttons = useRef<Partial<Record<ExplorerView, HTMLButtonElement | null>>>({});

  function choose(next: ExplorerView) {
    onChange(next);
    requestAnimationFrame(() => buttons.current[next]?.focus());
  }

  return (
    <div role="radiogroup" aria-label="View" data-testid="explorer-view" className="inline-flex items-center rounded-md border border-border bg-card p-0.5">
      {EXPLORER_VIEW_OPTIONS.map((option) => {
        const Icon = ICONS[option.id];
        const selected = view === option.id;
        return (
          <button
            key={option.id}
            ref={(node) => {
              buttons.current[option.id] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            data-testid={`explorer-view-${option.id}`}
            tabIndex={selected ? 0 : -1}
            className={`grid h-7 w-7 place-items-center rounded ${selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            onClick={() => choose(option.id)}
            onKeyDown={(event) => {
              const next = explorerViewFromKey(view, event.key);
              if (!next || next === view) return;
              event.preventDefault();
              choose(next);
            }}
          >
            <Icon size={15} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
