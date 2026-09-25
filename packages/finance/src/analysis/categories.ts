import type { CategoryId, CategoryTree } from "@repo/contracts/finance";

export type CategoryNode = {
  id: typeof CategoryId.Type;
  parentId: typeof CategoryId.Type | null;
  name: string;
  slug: string | null;
  tree: CategoryTree;
  position: number;
};
type Placement = Pick<CategoryNode, "id" | "parentId">;

// The category and the categories above it, top-level first. Empty for a category that
// does not exist.
export function categoryPath<Node extends Placement>(
  nodes: readonly Node[],
  id: typeof CategoryId.Type,
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: Node[] = [];
  for (let at = byId.get(id); at; at = at.parentId ? byId.get(at.parentId) : undefined)
    path.unshift(at);
  return path;
}

export function hasChildren(nodes: readonly Placement[], id: typeof CategoryId.Type) {
  return nodes.some((node) => node.parentId === id);
}

// The row each category's facts add to when `open` is open: the child of `open` on the
// category's path, or `open` itself for facts placed on it, which its unspecified row
// holds. With nothing open, every category adds to its top-level category. Categories
// outside `open` have no row, so the keys are the categories `open` covers.
export function rollupKeys(nodes: readonly Placement[], open: typeof CategoryId.Type | null) {
  const parents = new Map(nodes.map((node) => [node.id, node.parentId]));
  const keys = new Map<typeof CategoryId.Type, typeof CategoryId.Type>();
  for (const node of nodes) {
    let at: typeof CategoryId.Type | null = node.id;
    while (at && parents.get(at) !== open) at = parents.get(at) ?? null;
    if (at) keys.set(node.id, at);
  }
  if (open) keys.set(open, open);
  return keys;
}
