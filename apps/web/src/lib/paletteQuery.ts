export const PALETTE_FILTER_KEYS = ["type", "plant", "status", "assigned"] as const;
export type PaletteFilterKey = (typeof PALETTE_FILTER_KEYS)[number];

export interface PaletteFilter {
  key: PaletteFilterKey;
  value: string;
}

const TOKEN = /(^|\s)(type|plant|status|assigned):(?:"([^"]*)"|(\S+))/gi;

/** Pull `type:`, `plant:`, `status:`, and `assigned:` tokens out of a palette query. */
export function parsePaletteQuery(raw: string): { text: string; filters: PaletteFilter[] } {
  const filters: PaletteFilter[] = [];
  const text = raw
    .replace(TOKEN, (_match, _lead, key: string, quoted: string | undefined, bare: string | undefined) => {
      const value = (quoted ?? bare ?? "").trim();
      const normalized = key.toLowerCase();
      if (value && (PALETTE_FILTER_KEYS as readonly string[]).includes(normalized)) {
        filters.push({ key: normalized as PaletteFilterKey, value });
      }
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { text, filters };
}

export function formatPaletteFilter(filter: PaletteFilter): string {
  return filter.value.includes(" ") ? `${filter.key}:"${filter.value}"` : `${filter.key}:${filter.value}`;
}

/** Drop one chip and keep the rest of the query. */
export function paletteQueryWithout(raw: string, key: PaletteFilterKey, value: string): string {
  const parsed = parsePaletteQuery(raw);
  const kept = parsed.filters.filter((filter) => !(filter.key === key && filter.value === value));
  return [...kept.map(formatPaletteFilter), parsed.text].filter(Boolean).join(" ");
}

export function paletteFilterValue(filters: PaletteFilter[], key: PaletteFilterKey): string | undefined {
  return filters.find((filter) => filter.key === key)?.value;
}
