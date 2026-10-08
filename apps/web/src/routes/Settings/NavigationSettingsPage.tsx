import { useArrangedSidebar } from "../../components/layout/sidebarOrganize";
import { SidebarShortcutsButton } from "../../components/layout/sidebarShortcutsPanel";

/** Personal menu. The built-in order stays until this person changes it. */
export function NavigationSettingsPage() {
  const { catalog } = useArrangedSidebar();
  return (
    <div className="max-w-3xl rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
      <h2 className="mb-2 text-base font-medium text-foreground">Menu</h2>
      <p>The sidebar starts as the standard menu. Home stays pinned at the top. You can hide other items, change the order, add a section, or pin a page, a Documents folder, or a form. Blank templates are in Folder Explorer, under Blank Forms Templates. Settings stays at the bottom. Folders remember whether you left them open.</p>
      <p className="mt-3">This is your menu only. It follows you on another device after it saves. Reset to default puts the standard menu back.</p>
      <div className="mt-4">
        <SidebarShortcutsButton catalog={catalog} placement="page" />
      </div>
    </div>
  );
}
