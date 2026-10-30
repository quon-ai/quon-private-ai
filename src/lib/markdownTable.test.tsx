import type React from "react";
import { describe, expect, it } from "vitest";

import { extractTable } from "./markdownTable";

/**
 * The mobile card layout is built from what this pulls out of react-markdown's
 * rendered table, so a wrong extraction would silently mangle a user's answer.
 * It must therefore fail CLOSED — anything it doesn't recognise returns null and
 * the caller keeps the plain table.
 */
function table(head: string[], body: string[][]) {
  return [
    <thead key="h">
      <tr>
        {head.map((h, i) => (
          <th key={i}>{h}</th>
        ))}
      </tr>
    </thead>,
    <tbody key="b">
      {body.map((row, r) => (
        <tr key={r}>
          {row.map((c, i) => (
            <td key={i}>{c}</td>
          ))}
        </tr>
      ))}
    </tbody>,
  ];
}

describe("extractTable", () => {
  it("pulls out the header cells and every body row, in order", () => {
    const out = extractTable(
      table(
        ["Merkmal", "SNT", "Labfresh"],
        [
          ["Optischer Eindruck", "elegant", "funktional"],
          ["Material", "Twill", "Baumwoll-Mix"],
        ],
      ),
    );
    expect(out).not.toBeNull();
    expect(out!.headers).toEqual(["Merkmal", "SNT", "Labfresh"]);
    expect(out!.rows).toEqual([
      ["Optischer Eindruck", "elegant", "funktional"],
      ["Material", "Twill", "Baumwoll-Mix"],
    ]);
  });

  it("keeps a cell's inline content as-is, not as text", () => {
    // Bold runs, links and proxied images must survive into the card layout —
    // that is the whole reason this works on rendered children, not on source.
    const rich = <strong>elegant</strong>;
    const out = extractTable([
      <thead key="h">
        <tr>
          <th>Merkmal</th>
          <th>SNT</th>
        </tr>
      </thead>,
      <tbody key="b">
        <tr>
          <td>Optik</td>
          <td>{rich}</td>
        </tr>
      </tbody>,
    ]);
    expect(out!.rows[0][1]).toBe(rich);
  });

  it("finds cells built from OVERRIDE components, not just literal <td> tags", () => {
    // The shape production actually has, and the one this originally got wrong:
    // react-markdown does `createElement(components.td, …)`, so with td/th
    // overridden the element type is the override FUNCTION and the string "td"
    // never appears. Matching on the tag name looked correct and silently
    // extracted nothing, so every table fell back to the desktop layout.
    const Th = ({ children }: { children?: React.ReactNode }) => <th>{children}</th>;
    const Td = ({ children }: { children?: React.ReactNode }) => <td>{children}</td>;
    const out = extractTable([
      <thead key="h">
        <tr>
          <Th>Merkmal</Th>
          <Th>SNT</Th>
        </tr>
      </thead>,
      <tbody key="b">
        <tr>
          <Td>Optik</Td>
          <Td>elegant</Td>
        </tr>
      </tbody>,
    ]);
    expect(out).not.toBeNull();
    expect(out!.headers).toEqual(["Merkmal", "SNT"]);
    expect(out!.rows).toEqual([["Optik", "elegant"]]);
  });

  it("returns null for a single-column table (no label to stack against)", () => {
    expect(extractTable(table(["Nur eine Spalte"], [["Wert"]]))).toBeNull();
  });

  it("returns null when there are no data rows", () => {
    expect(extractTable(table(["A", "B"], []))).toBeNull();
  });

  it("returns null for anything that isn't a thead/tbody table", () => {
    expect(extractTable(null)).toBeNull();
    expect(extractTable("just text")).toBeNull();
    expect(extractTable(<div>nope</div>)).toBeNull();
  });

  it("tolerates whitespace between sections and a header-less tbody row", () => {
    const out = extractTable([
      "\n",
      <thead key="h">
        <tr>
          <th>A</th>
          <th>B</th>
        </tr>
      </thead>,
      "\n",
      <tbody key="b">
        <tr>
          <td>1</td>
          <td>2</td>
        </tr>
      </tbody>,
    ]);
    expect(out!.rows).toEqual([["1", "2"]]);
  });
});
