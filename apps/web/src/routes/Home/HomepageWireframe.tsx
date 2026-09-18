import type { ReactNode } from "react";

interface HomepageWireframeProps {
  /** Plain text only — no data-fetching or context reads happen inside this component; HomePage.tsx supplies real values as props. */
  welcomeTitle: string;
  welcomeSubtitle?: string;
  tiles: ReactNode;
}

/**
 * Structural layout only — the wireframe deliverable itself, kept as real,
 * reusable code rather than a throwaway mockup. No styling beyond basic
 * spacing/borders, no animation, no charts, no data-fetching: HomePage.tsx
 * is the "smart" page that reads auth/tenant context and passes plain
 * values in; this component only arranges them into the four required
 * regions (welcome header, module tile grid, Quick Actions, Recent
 * Activity) and never reaches past its own props.
 */
export function HomepageWireframe({ welcomeTitle, welcomeSubtitle, tiles }: HomepageWireframeProps) {
  return (
    <div className="flex flex-col gap-6">
      {/* Region 1 — welcome header */}
      <section className="border border-border p-4">
        <h1 className="text-xl font-semibold">{welcomeTitle}</h1>
        {welcomeSubtitle && <p className="mt-1 text-sm text-muted-foreground">{welcomeSubtitle}</p>}
      </section>

      {/* Region 2 — module tile grid */}
      <section className="border border-border p-4">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Modules</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{tiles}</div>
      </section>

      {/* Region 3 — Quick Actions placeholder */}
      <section className="border border-border p-4">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Quick Actions</h2>
        <p className="text-sm text-muted-foreground">No quick actions configured yet.</p>
      </section>

      {/* Region 4 — Recent Activity placeholder */}
      <section className="border border-border p-4">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Recent Activity</h2>
        <p className="text-sm text-muted-foreground">No recent activity to show yet.</p>
      </section>
    </div>
  );
}
