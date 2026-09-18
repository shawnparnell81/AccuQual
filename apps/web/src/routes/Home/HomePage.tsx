import { useCurrentTenant, useCurrentUser } from "../../hooks/useAuth";
import { DEPARTMENTS, NAV_STRUCTURE } from "../../components/layout/navConfig";
import { HomepageWireframe } from "./HomepageWireframe";
import { ModuleTile } from "./ModuleTile";

/**
 * The tenant portal's landing page at /home. Deliberately lightweight and
 * placeholder-only (per the scoped build this shipped under): reads the
 * same auth/tenant context every other page already uses, reuses
 * navConfig.ts's existing DEPARTMENTS/NAV_STRUCTURE data for the tile grid
 * (real module names and real routes, no invented data), and makes no API
 * calls or data-model changes of its own. The real Dashboard (KPI counts,
 * charts, etc.) is unchanged and still lives at "/" — this page is a
 * separate, distinct entry point, not a replacement for it.
 */
export function HomePage() {
  const user = useCurrentUser();
  const tenant = useCurrentTenant();

  const tiles = DEPARTMENTS.map((dept) => {
    const group = NAV_STRUCTURE.find((g) => g.department === dept.key);
    const firstItem = group ? [...group.items].sort((a, b) => a.priority - b.priority)[0] : undefined;
    return { ...dept, path: firstItem?.path ?? "/" };
  });

  return (
    <HomepageWireframe
      welcomeTitle={`Welcome${user?.name ? `, ${user.name}` : ""}`}
      welcomeSubtitle={tenant?.name}
      tiles={tiles.map((tile) => (
        <ModuleTile key={tile.key} label={tile.label} path={tile.path} icon={tile.icon} text={tile.text} bgSoft={tile.bgSoft} />
      ))}
    />
  );
}
