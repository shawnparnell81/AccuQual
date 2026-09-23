import { useSites } from "../../hooks/useSites";

/** Tells a list which plant it is showing, so a filtered list doesn't look like missing data. */
export function CurrentPlantNote() {
  const { data, currentSiteId, isLoading } = useSites();
  if (isLoading || !data) return null;
  const plant = data.sites.find((site) => site.id === currentSiteId);
  if (!plant) {
    return <p className="text-sm text-muted-foreground">You aren't assigned to a plant. Ask an admin to add you.</p>;
  }
  return <p className="text-sm text-muted-foreground">Showing {plant.name}. Other plants stay off this list until you switch.</p>;
}
