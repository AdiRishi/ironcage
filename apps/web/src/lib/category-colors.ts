// Top-level spending categories that get their own hue, in the order the palette
// was validated for adjacent contrast. Flows and stacks use this order. Every other
// category shares the neutral tone and is identified by its label.
const colored = [
  "housing",
  "food",
  "transport",
  "shopping",
  "bills",
  "health",
  "entertainment",
  "travel",
] as const;

const topSlug = (slug: string | null) => slug?.split(".")[0] ?? null;

export function categoryColor(slug: string | null) {
  const index = colored.findIndex((item) => item === topSlug(slug));
  return index === -1 ? "var(--category-other)" : `var(--category-${index + 1})`;
}

export function categoryRank(slug: string | null) {
  const index = colored.findIndex((item) => item === topSlug(slug));
  return index === -1 ? colored.length : index;
}
