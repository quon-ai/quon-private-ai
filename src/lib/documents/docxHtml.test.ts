/**
 * URL policy for the sanitized DOCX viewer HTML — the one place a mammoth
 * conversion could smuggle something active (javascript:/data: links, remote
 * image beacons). The DOM allowlist walk itself needs a browser DOMParser; in
 * its absence sanitizeDocxHtml must fail closed to "" (→ text-view fallback).
 */
import { describe, expect, it } from "vitest";

import { isSafeDocxUrl, sanitizeDocxHtml } from "./docxHtml";

describe("isSafeDocxUrl", () => {
  it("allows web / mailto / bookmark links", () => {
    expect(isSafeDocxUrl("https://example.com", "href")).toBe(true);
    expect(isSafeDocxUrl("http://example.com", "href")).toBe(true);
    expect(isSafeDocxUrl("mailto:a@b.c", "href")).toBe(true);
    expect(isSafeDocxUrl("#bookmark1", "href")).toBe(true);
  });

  it("blocks active or exfiltrating link schemes", () => {
    expect(isSafeDocxUrl("javascript:alert(1)", "href")).toBe(false);
    expect(isSafeDocxUrl("  JAVASCRIPT:alert(1)", "href")).toBe(false); // case/whitespace tricks
    expect(isSafeDocxUrl("data:text/html,<script>1</script>", "href")).toBe(false);
    expect(isSafeDocxUrl("blob:https://example.com/x", "href")).toBe(false);
    expect(isSafeDocxUrl("vbscript:x", "href")).toBe(false);
    expect(isSafeDocxUrl("//example.com", "href")).toBe(false);
  });

  it("allows only inline data: images as src (no remote beacons, no CSP violations)", () => {
    expect(isSafeDocxUrl("data:image/png;base64,iVBORw0K", "src")).toBe(true);
    expect(isSafeDocxUrl("https://tracker.example/pixel.png", "src")).toBe(false);
    expect(isSafeDocxUrl("data:text/html,x", "src")).toBe(false);
    expect(isSafeDocxUrl("javascript:alert(1)", "src")).toBe(false);
  });
});

describe("sanitizeDocxHtml", () => {
  it("fails closed to empty output without a DOMParser (node env)", () => {
    expect(typeof DOMParser).toBe("undefined"); // precondition of this suite
    expect(sanitizeDocxHtml("<p onclick=alert(1)>hi</p><script>evil()</script>")).toBe("");
  });
});
