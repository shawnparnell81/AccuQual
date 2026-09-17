import { Link } from "react-router-dom";
import { ADMIN_CONSOLE_SECTIONS } from "./AdminConsoleLayout";

export function AdminConsoleHomePage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Admin Console</h1>
        <p className="text-sm text-muted-foreground">Configure this organization without a code change or deploy.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ADMIN_CONSOLE_SECTIONS.map((section) => (
          <Link
            key={section.key}
            to={section.externalPath ?? `/admin/${section.path}`}
            className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 hover:border-primary/40 hover:bg-muted/40"
          >
            <div className="flex items-center gap-2 font-medium">
              <section.icon size={18} className="text-muted-foreground" />
              <span>{section.label}</span>
            </div>
            <p className="text-xs text-muted-foreground">{section.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
