import { describe, expect, it } from "vitest";

import { proxiedImageSrc, splitOnHtmlBreaks } from "./markdownText";

/**
 * Reported from a real answer: a comparison table showed `<br>` verbatim inside
 * its cells, and every product picture was a broken-image icon.
 */
describe("splitOnHtmlBreaks", () => {
  it("splits the shape models actually produce in table cells", () => {
    // A newline would end the row, so `<br>` is the only option a model has -
    // and react-markdown deliberately does not render raw HTML.
    expect(splitOnHtmlBreaks("Klassisch-elegant<br>Sieht aus wie ein Anzug.")).toEqual([
      "Klassisch-elegant",
      "Sieht aus wie ein Anzug.",
    ]);
  });

  it("accepts every spelling and casing", () => {
    expect(splitOnHtmlBreaks("a<br>b<br/>c<br />d<BR>e")).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("leaves text without breaks untouched (single segment, no work)", () => {
    expect(splitOnHtmlBreaks("Nur ein Satz.")).toEqual(["Nur ein Satz."]);
    expect(splitOnHtmlBreaks("")).toEqual([""]);
  });

  it("does not touch any other tag: only line breaks may ever result", () => {
    // The whole point of splitting instead of parsing: nothing here can turn
    // model output into live markup.
    const evil = "<img src=x onerror=alert(1)> und <script>alert(1)</script>";
    expect(splitOnHtmlBreaks(evil)).toEqual([evil]);
  });
});

describe("proxiedImageSrc", () => {
  it("routes a remote image through QUON's own proxy", () => {
    const out = proxiedImageSrc("https://shop.example.com/rucksack.jpg?w=400");
    expect(out).toContain("/link-image?url=");
    expect(decodeURIComponent(out!.split("url=")[1])).toBe(
      "https://shop.example.com/rucksack.jpg?w=400",
    );
  });

  it("passes an inline data image through unchanged", () => {
    const data = "data:image/png;base64,AAAA";
    expect(proxiedImageSrc(data)).toBe(data);
  });

  it("returns null for anything unproxyable, so nothing broken is rendered", () => {
    expect(proxiedImageSrc(undefined)).toBeNull();
    expect(proxiedImageSrc("   ")).toBeNull();
    expect(proxiedImageSrc("/local/relative.png")).toBeNull();
    expect(proxiedImageSrc("javascript:alert(1)")).toBeNull();
    expect(proxiedImageSrc("data:text/html;base64,AAAA")).toBeNull();
  });
});
