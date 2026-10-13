/**
 * Which samples to print, from text like "1-3, 5". Returns the sample numbers (sorted, no repeats) or a plain sentence saying
 * what is wrong. "all" or an empty string means every sample.
 */
export function parseSampleSelection(text: string, total: number): { samples: number[] } | { error: string } {
  const trimmed = text.trim().toLowerCase();
  if (total < 1) return { error: "This record has no samples yet." };
  if (trimmed === "" || trimmed === "all") return { samples: Array.from({ length: total }, (_, index) => index + 1) };
  const picked = new Set<number>();
  for (const part of trimmed.replace(/\s*-\s*/g, "-").split(/[,\s]+/).filter(Boolean)) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    const single = /^\d+$/.exec(part);
    if (!range && !single) return { error: `"${part}" is not a sample number or a range like 2-4.` };
    const from = Number(range ? range[1] : part);
    const to = Number(range ? range[2] : part);
    if (from < 1 || to < from) return { error: `"${part}" is not a valid range.` };
    if (to > total) return { error: `This record has ${total} sample${total === 1 ? "" : "s"}, so ${to} is too high.` };
    for (let n = from; n <= to; n += 1) picked.add(n);
  }
  return picked.size === 0 ? { error: "Choose at least one sample." } : { samples: [...picked].sort((a, b) => a - b) };
}
