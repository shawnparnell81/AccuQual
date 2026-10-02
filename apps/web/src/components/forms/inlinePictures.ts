/**
 * Inline pictures belong on issue and evidence records.
 * Ordinary forms, title blocks, and master lists do not offer Insert Picture.
 * The company logo on a form header comes from branding, not from this control.
 */
const INLINE_PICTURE_FORM_TYPES = new Set([
  "ncr",
  "capa",
  "eight_d",
  "five_why",
  "complaint",
  "discrepancy_inspection",
]);

export function formAllowsInlinePictures(formType: string): boolean {
  return INLINE_PICTURE_FORM_TYPES.has(formType);
}
