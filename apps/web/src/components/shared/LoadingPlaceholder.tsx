/** Shimmer rows in place of a "Loading…" sentence. Motion is disabled when the user prefers reduced motion. */
export function LoadingPlaceholder({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col gap-2 py-2 ${className}`} role="status" aria-label="Loading">
      <div className="skeleton h-4 w-2/3" />
      <div className="skeleton h-4 w-1/2" />
      <div className="skeleton h-4 w-5/12" />
    </div>
  );
}
