import { Link } from "react-router-dom";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

interface ModuleTileProps {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Tailwind classes, literal (matches navConfig.ts's DepartmentMeta shape) so the same department gets the same accent color here as it does in TopNav's own dropdowns. */
  text: string;
  bgSoft: string;
}

/** One placeholder tile in HomePage's module grid — links via existing routing only, no new data or behavior of its own. */
export function ModuleTile({ label, path, icon: Icon, text, bgSoft }: ModuleTileProps) {
  return (
    <Link
      to={path}
      className="flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-4 hover:bg-muted"
    >
      <span className={clsx("flex h-10 w-10 items-center justify-center rounded-md", bgSoft)}>
        <Icon size={20} className={text} />
      </span>
      <span className="text-sm font-medium text-foreground">{label}</span>
    </Link>
  );
}
