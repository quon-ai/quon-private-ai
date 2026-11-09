import { Children, isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * Pull the header cells and body rows out of the element tree react-markdown
 * produced for a GFM table, so the renderer can lay the same content out two
 * ways (a real table on wide screens, stacked cards on a phone).
 *
 * Works on the rendered children rather than the source AST on purpose: the
 * cells already contain their inline formatting - bold runs, links, proxied
 * images, the `<br>` handling - so nothing has to be re-implemented or lost for
 * the mobile layout.
 *
 * Returns null whenever the shape isn't the plain thead/tbody table we know how
 * to restructure; the caller then just renders the table as-is. Being wrong
 * here would silently mangle content, so it fails closed to the boring layout.
 */
export interface ExtractedTable {
  headers: ReactNode[];
  rows: ReactNode[][];
}

function tagOf(node: ReactNode): string | null {
  return isValidElement(node) && typeof node.type === "string" ? node.type : null;
}

function childrenOf(node: ReactNode): ReactNode[] {
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return Children.toArray(node.props.children);
}

/**
 * Cells of one `<tr>`, in order; null when the row holds no cells.
 *
 * Matches on "is an element", not on the tag name. react-markdown builds a cell
 * as `createElement(components.td, ...)`, so when `td`/`th` are overridden - which
 * they are - the element's `type` is the override FUNCTION and the string "td"
 * never appears until React renders it. Checking for the tag looked right and
 * silently found nothing.
 */
function cellsOfRow(row: ReactNode): ReactNode[] | null {
  const cells = childrenOf(row).filter(isValidElement);
  if (!cells.length) return null;
  return cells.map((c) => (c as ReactElement<{ children?: ReactNode }>).props.children);
}

export function extractTable(tableChildren: ReactNode): ExtractedTable | null {
  const sections = Children.toArray(tableChildren);
  let headers: ReactNode[] | null = null;
  const rows: ReactNode[][] = [];

  for (const section of sections) {
    const tag = tagOf(section);
    if (tag !== "thead" && tag !== "tbody") continue;
    for (const row of childrenOf(section)) {
      if (tagOf(row) !== "tr") continue;
      const cells = cellsOfRow(row);
      if (!cells) continue;
      if (tag === "thead" && headers === null) headers = cells;
      else rows.push(cells);
    }
  }

  // A header row and at least one data row - otherwise there is nothing to
  // label the stacked cells with, and the plain table is the honest fallback.
  if (!headers || headers.length < 2 || rows.length === 0) return null;
  return { headers, rows };
}
