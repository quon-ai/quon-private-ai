/**
 * "Sources" strip under an answer that used web search — the citations the model
 * actually reported (`url_citation` annotations, forwarded by the backend).
 *
 * Deliberately NO direct requests to the cited sites. The obvious implementations
 * (a favicon service, or an `<img src>` pointed straight at the merchant's
 * `og:image`) would tell every one of those sites the user's IP and that this
 * person just asked about them — exactly the passive leak QUON exists to avoid.
 *
 * Preview pictures therefore come through the QUON server: it reads the public
 * page and re-serves the image bytes from our own origin (`/link-previews` +
 * `/link-image`, see quon-scrubber-service/link_preview.py — that endpoint is
 * where the SSRF guard lives, since `og:image` is attacker-controlled input).
 * Best-effort throughout: no previews simply means the plain chips.
 */
import { Globe } from "lucide-react";
import { useEffect, useState } from "react";

import { linkImageUrl, linkPreviews, type LinkPreview, type WebSource } from "@/lib/quonApi";
import { useT } from "@/lib/i18n/i18n";

/** Display host ("www." dropped); "" when the URL doesn't parse. */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** De-duplicate by URL, keeping the first (highest-ranked) occurrence. */
export function dedupeSources(sources: WebSource[]): WebSource[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

export interface PreviewedSource extends WebSource {
  description?: string;
  image?: string | null;
}

/** Fold previews into the cited sources, keeping the model's ranking. A source
 *  the preview pass couldn't reach keeps its own title and loses only the
 *  picture. */
export function mergePreviews(sources: WebSource[], previews: LinkPreview[]): PreviewedSource[] {
  const byUrl = new Map(previews.map((p) => [p.url, p]));
  return sources.map((s) => {
    const p = byUrl.get(s.url);
    return {
      ...s,
      title: s.title || p?.title || "",
      description: p?.description,
      image: p?.image ?? null,
    };
  });
}

/** Previews keyed by the answer's source set. Module-level, so scrolling a long
 *  chat — or leaving and coming back — never re-fetches the same previews.
 *
 *  The IN-FLIGHT promise is what gets cached, not just its result: two strips
 *  mounting in the same tick (and React's double-invoked effects in dev) would
 *  otherwise both miss an empty cache and fire the same request twice. */
const previewCache = new Map<string, Promise<LinkPreview[]>>();
const resolvedPreviews = new Map<string, LinkPreview[]>();

export function SourcesStrip({ sources }: { sources: WebSource[] }) {
  const { t } = useT();
  const list = dedupeSources(sources);
  const key = list.map((s) => s.url).join("|");
  const [previews, setPreviews] = useState<LinkPreview[]>(() => resolvedPreviews.get(key) ?? []);

  useEffect(() => {
    if (!key) return;
    let pending = previewCache.get(key);
    if (!pending) {
      pending = linkPreviews(key.split("|"));
      previewCache.set(key, pending);
    }
    let cancelled = false;
    void pending
      .then((p) => {
        resolvedPreviews.set(key, p);
        if (!cancelled) setPreviews(p);
      })
      .catch(() => {
        /* decoration only — the chips already carry the citation */
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!list.length) return null;

  const merged = mergePreviews(list, previews);
  // Cards only pay off once there is something to look at; a picture-less set
  // stays the compact chip row it has always been.
  const hasImages = merged.some((m) => m.image);

  return (
    <div className="mt-2 border-t border-quon-border pt-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-quon-muted">
        {t("chat.sources", { count: list.length })}
      </div>
      {hasImages ? (
        <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
          {merged.map((s) => {
            const host = sourceHost(s.url);
            return (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                title={s.title ? `${s.title} — ${s.url}` : s.url}
                className="flex w-36 shrink-0 snap-start flex-col overflow-hidden rounded-lg border border-quon-border bg-quon-surface-2 transition hover:border-quon-indigo/50"
              >
                {s.image ? (
                  <img
                    src={linkImageUrl(s.image)}
                    alt=""
                    loading="lazy"
                    className="h-20 w-full bg-quon-surface object-cover"
                    onError={(e) => {
                      // A dead link leaves a clean card, not a broken-image glyph.
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <div className="flex h-20 w-full items-center justify-center bg-quon-surface">
                    <Globe className="h-5 w-5 text-quon-indigo/60" />
                  </div>
                )}
                <div className="flex min-w-0 flex-col gap-0.5 p-1.5">
                  <span className="line-clamp-2 text-[10px] font-medium leading-tight text-quon-text">
                    {s.title || host || s.url}
                  </span>
                  <span className="truncate text-[9px] text-quon-muted">{host}</span>
                </div>
              </a>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {list.map((s) => {
            const host = sourceHost(s.url);
            return (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                title={s.title ? `${s.title} — ${s.url}` : s.url}
                className="flex max-w-[15rem] items-center gap-1.5 rounded-full border border-quon-border bg-quon-surface-2 px-2 py-0.5 text-[10px] text-quon-muted transition hover:border-quon-indigo/50 hover:text-quon-text"
              >
                <Globe className="h-3 w-3 shrink-0 text-quon-indigo" />
                <span className="truncate">{host || s.title || s.url}</span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
