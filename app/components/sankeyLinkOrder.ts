// app/components/sankeyLinkOrder.ts

// Plotly's sankey does not re-sort links after applying fixed node x/y, so links attach to
// nodes in a stale order and cross. Pair this with `link.sort: "input"`: ordering by
// (target y, source y) stacks every node's outgoing links by target position and its
// incoming links by source position.
export function orderLinksByNodeY<T extends { source: number[]; target: number[] }>(
  links: T,
  nodeY: number[]
): T {
  const order = links.source
    .map((_, i) => i)
    .sort(
      (a, b) =>
        nodeY[links.target[a]] - nodeY[links.target[b]] ||
        nodeY[links.source[a]] - nodeY[links.source[b]] ||
        a - b
    );
  return Object.fromEntries(
    Object.entries(links).map(([key, values]) => [key, order.map((i) => (values as unknown[])[i])])
  ) as T;
}
