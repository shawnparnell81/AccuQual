import { useArrangedSidebar } from "../../components/layout/sidebarOrganize";
import { SidebarShortcutsButton } from "../../components/layout/sidebarShortcutsPanel";

/**
 * Personal shortcuts sit on top of the shared menu.
 * An administrator can still drag the shared menu into a different order.
 */
export function NavigationSettingsPage() {
  const { catalog, isAdmin } = useArrangedSidebar();
  return (
    <div className="max-w-3xl rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
      <h2 className="mb-2 text-base font-medium text-foreground">Menu</h2>
      <p>
        Dashboard stays at the top and Settings stays at the bottom. Blank templates are in Folder Explorer, under Blank Forms Templates. Filled forms open from Documents.
        Folders remember whether you left them open.
      </p>
      <p className="mt-3">
        Shortcuts are yours. Hiding a menu item, or pinning a page, changes only your sidebar.
        {isAdmin ? " Dragging the menu still changes the shared order for the company." : ""}
      </p>
      <div className="mt-4">
        <SidebarShortcutsButton catalog={catalog} placement="page" />
      </div>
    </div>
  );
}
