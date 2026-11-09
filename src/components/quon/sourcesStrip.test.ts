import { describe, expect, it } from "vitest";

import { linkImageUrl } from "@/lib/quonApi";
import { dedupeSources, mergePreviews, sourceHost } from "./SourcesStrip";

describe("sourceHost", () => {
  it("shows the bare host without www", () => {
    expect(sourceHost("https://www.techcrunch.com/2026/07/k3")).toBe("techcrunch.com");
    expect(sourceHost("https://venturebeat.com/ai/")).toBe("venturebeat.com");
  });
  it("returns empty for an unparseable URL (caller falls back to the title)", () => {
    expect(sourceHost("not a url")).toBe("");
  });
});

describe("dedupeSources", () => {
  it("keeps the first occurrence of each URL", () => {
    const out = dedupeSources([
      { url: "https://a.example/x", title: "A" },
      { url: "https://b.example/y", title: "B" },
      { url: "https://a.example/x", title: "A again" },
    ]);
    expect(out.map((s) => s.title)).toEqual(["A", "B"]);
  });
  it("handles an empty list", () => {
    expect(dedupeSources([])).toEqual([]);
  });
});

describe("mergePreviews", () => {
  const sources = [
    { url: "https://a.example/x", title: "A" },
    { url: "https://b.example/y", title: "" },
  ];

  it("keeps the model's ranking and attaches the matching preview", () => {
    const out = mergePreviews(sources, [
      {
        url: "https://b.example/y",
        title: "B from og",
        description: "d",
        image: "https://i/b.jpg",
      },
    ]);
    expect(out.map((s) => s.url)).toEqual(sources.map((s) => s.url));
    expect(out[1].title).toBe("B from og"); // empty citation title filled in
    expect(out[1].image).toBe("https://i/b.jpg");
  });

  it("leaves a source without a preview intact, minus the picture", () => {
    const out = mergePreviews(sources, []);
    expect(out[0].title).toBe("A");
    expect(out[0].image).toBeNull();
  });

  it("never lets a preview overwrite the citation's own title", () => {
    const out = mergePreviews(sources, [
      { url: "https://a.example/x", title: "SEO spam title", description: "", image: null },
    ]);
    expect(out[0].title).toBe("A");
  });
});

describe("linkImageUrl", () => {
  it("routes the image through QUON's own proxy, never the origin", () => {
    // The whole privacy point: what lands in <img src> must be our endpoint, and
    // the origin URL must be encoded as a parameter (query strings, & and all).
    const url = linkImageUrl("https://shop.example.com/p.jpg?w=200&h=200");
    expect(url).toContain("/link-image?url=");
    expect(url).not.toContain("shop.example.com/p.jpg?");
    expect(decodeURIComponent(url.split("url=")[1])).toBe(
      "https://shop.example.com/p.jpg?w=200&h=200",
    );
  });
});
