/**
 * The sidebar is now a fixed set of folders (Engineering, Quality, Operations).
 * The old per-module show/hide toggles no longer change that menu, so they are
 * not shown here — a switch that did nothing would look like it worked.
 */
export function NavigationSettingsPage() {
  return (
    <div className="max-w-3xl rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
      <h2 className="mb-2 text-base font-medium text-foreground">Menu</h2>
      <p>
        The sidebar is Engineering, Quality, and Operations, with Dashboard at the top and Settings at the bottom. Folders remember whether you left them open.
        Company name, logo, users, departments, plants, and numbering formats are on the Company tab.
      </p>
    </div>
  );
}
