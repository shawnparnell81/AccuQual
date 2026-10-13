/**
 * Pure product-type inference, separated out so it's testable without a database. Case-insensitive.
 * Order matters: the first pattern that matches wins, and every pattern uses word boundaries.
 * air_strut is checked before csa so "air strut assembly" is not a CSA, and electric_lift before
 * regular_gas_lift. Anything else (including empty/missing text) is null.
 */
export type FaiProductType =
  | "csa"
  | "fuel_pump"
  | "air_strut"
  | "air_spring"
  | "fuel_injector"
  | "brake_wear"
  | "electric_lift"
  | "regular_gas_lift"
  | "coil_spring"
  | "shock";

const RULES: [Exclude<FaiProductType, never>, RegExp][] = [
  ["air_strut", /\bair\s*strut|\bair\s*suspension/],
  ["air_spring", /\bair\s*(spring|bag)/],
  ["csa", /\bcsa\b|complete strut|strut assembl/],
  ["fuel_pump", /\bfuel\s*pump/],
  ["fuel_injector", /\bfuel\s*injector/],
  ["brake_wear", /\bbrake\s*wear/],
  ["electric_lift", /\belectric\s*lift|\bpower\s*lift/],
  ["regular_gas_lift", /\bgas\s*lift|\bgas\s*spring|\bgas\s*strut/],
  ["coil_spring", /\bcoil\s*spring/],
  ["shock", /\bshocks?\b|\bshock\s*absorber/],
];

export function productTypeFor(text: string | null | undefined): FaiProductType | null {
  if (!text) return null;
  const t = text.toLowerCase();
  for (const [type, pattern] of RULES) if (pattern.test(t)) return type;
  return null;
}
