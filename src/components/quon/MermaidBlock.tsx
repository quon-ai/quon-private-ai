import { useEffect, useRef, useState } from "react";
import { Code2, Workflow } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";
import { renderMermaid } from "@/lib/mermaid";

/**
 * A mermaid diagram in a chat answer.
 *
 * Two rules the implementation exists to keep:
 * - **The source is never lost.** A syntax error (models produce those) falls
 *   back to the code block instead of swallowing what was written, and the
 *   user can always switch to the source deliberately.
 * - **Mermaid loads only when a diagram is actually shown** (~500KB) - the
 *   import lives behind renderMermaid(), so a chat without diagrams never
 *   pays. Answers stream token-by-token, so an incomplete diagram would fail
 *   to parse mid-stream; we therefore only render when `streaming` is false.
 */
export function MermaidBlock({ code, streaming = false }: { code: string; streaming?: boolean }) {
  const { t } = useT();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (streaming || showSource) return;
    let cancelled = false;
    setFailed(false);
    renderMermaid(code)
      .then((out) => {
        if (!cancelled) setSvg(out);
      })
      .catch(() => {
        // Broken/partial diagram source - show it as code rather than nothing.
        if (!cancelled) {
          setSvg(null);
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, streaming, showSource]);

  const source = (
    <pre className="mb-2 overflow-x-auto rounded-lg bg-quon-surface-2 p-2 text-[0.85em] last:mb-0">
      <code>{code}</code>
    </pre>
  );

  // While the answer is still streaming, or after a parse failure, the source
  // Is the honest rendering.
  if (streaming || failed || (showSource && svg === null)) {
    return (
      <div className="mb-2 last:mb-0">
        {source}
        {failed && <p className="mt-1 text-[11px] text-quon-muted">{t("chat.mermaidBroken")}</p>}
      </div>
    );
  }

  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 flex justify-end">
        <button
          onClick={() => setShowSource((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-quon-border px-1.5 py-0.5 text-[10px] text-quon-muted transition hover:text-quon-text"
        >
          {showSource ? (
            <>
              <Workflow className="h-3 w-3" /> {t("chat.mermaidShowDiagram")}
            </>
          ) : (
            <>
              <Code2 className="h-3 w-3" /> {t("chat.mermaidShowSource")}
            </>
          )}
        </button>
      </div>
      {showSource ? (
        source
      ) : svg ? (
        // mermaid runs with securityLevel:"strict" (labels sanitised, no click
        // handlers), and the CSP forbids inline script execution regardless -
        // so injecting the generated SVG markup is safe. See lib/mermaid.ts.
        <div
          ref={container}
          className="overflow-x-auto rounded-lg bg-quon-surface-2 p-2 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        source
      )}
    </div>
  );
}
