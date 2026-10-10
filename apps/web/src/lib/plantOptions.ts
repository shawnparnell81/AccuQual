export interface PlantOptionSource {
  id: number;
  name: string;
  status?: string;
}

export interface PlantOption {
  value: string;
  label: string;
  title: string;
}

/**
 * Plant choices share one id space with the top bar.
 * The selected label is the name derived from site_id.
 * A record whose plant is missing from the filtered list still shows that plant,
 * so the control cannot display a different plant than the id it stores.
 */
export function plantSelectOptions(
  sites: PlantOptionSource[],
  current: { siteId: number | null; siteName: string } | null,
): PlantOption[] {
  const active = sites.filter((site) => site.status == null || site.status === "active");
  const options = active.map((site) => {
    const derived = current?.siteId === site.id ? current.siteName.trim() : "";
    const label = derived || site.name;
    return { value: String(site.id), label, title: label };
  });
  if (current?.siteId != null && !options.some((option) => option.value === String(current.siteId))) {
    const label = current.siteName.trim() || `Plant ${current.siteId}`;
    options.unshift({ value: String(current.siteId), label, title: label });
  }
  return options;
}
