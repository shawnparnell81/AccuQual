interface DiagramToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onReRunAutoLayout: () => void;
  onDownloadSvg: () => void;
}

const buttonClass = "rounded-md border border-border px-2 py-1 text-xs hover:bg-muted";

export function DiagramToolbar({ onZoomIn, onZoomOut, onResetView, onReRunAutoLayout, onDownloadSvg }: DiagramToolbarProps) {
  return (
    <div className="flex gap-1.5">
      <button type="button" onClick={onZoomOut} className={buttonClass} title="Zoom out">
        −
      </button>
      <button type="button" onClick={onZoomIn} className={buttonClass} title="Zoom in">
        +
      </button>
      <button type="button" onClick={onResetView} className={buttonClass} title="Fit the diagram back to view">
        Reset view
      </button>
      <button type="button" onClick={onReRunAutoLayout} className={buttonClass} title="Recompute positions for every node you haven't manually dragged">
        Re-run auto-layout
      </button>
      <button type="button" onClick={onDownloadSvg} className={buttonClass} title="Download this diagram as a standalone SVG file">
        Download SVG
      </button>
    </div>
  );
}
