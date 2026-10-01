/** How an open-work metric card narrows the records table under it. */

export interface OpenWorkFilterCard {
  href: string | null;
  module: string | null;
  /** Set when the card covers more than one table module. */
  modules?: string[] | null;
}

/** Modules this card filters to. Null means the card navigates with `href` instead. */
export function cardFilterKeys(card: OpenWorkFilterCard): string[] | null {
  if (card.module) return [card.module];
  if (card.modules && card.modules.length > 0) return card.modules;
  return null;
}

/** Select value for a card filter. A single module stays its own key so the type menu can show it. */
export function filterToken(keys: string[]): string {
  return keys.length === 1 ? keys[0]! : `+${keys.join("+")}`;
}

export function rowInModuleFilter(rowModule: string, selected: string): boolean {
  if (!selected) return true;
  if (selected.startsWith("+")) return selected.slice(1).split("+").includes(rowModule);
  return rowModule === selected;
}
