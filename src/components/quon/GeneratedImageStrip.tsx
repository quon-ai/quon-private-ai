import { useEffect, useState } from "react";
import { Download, ImageOff, Loader2 } from "lucide-react";

import { loadGeneratedImage, type GeneratedImageRef } from "@/lib/chat/generatedImages";
import { downloadBytes } from "@/lib/download";
import { useT } from "@/lib/i18n/i18n";

/**
 * The pictures a model generated for one answer. The message only holds
 * references; the bytes come from the sealed local store, or are fetched and
 * decrypted from the sync relay on a device that did not generate them
 * (chat/generatedImages.ts). Every state is visible: loading, the image, or
 * an honest "only on the other device" line - never a silent gap.
 */
export function GeneratedImageStrip({ images }: { images: GeneratedImageRef[] }) {
  if (!images.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2" data-testid="generated-images">
      {images.map((ref) => (
        <GeneratedImage key={ref.id} image={ref} />
      ))}
    </div>
  );
}

function GeneratedImage({ image }: { image: GeneratedImageRef }) {
  const { t } = useT();
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; url: string; bytes: Uint8Array } | { kind: "missing" }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setState({ kind: "loading" });
    void loadGeneratedImage(image).then((bytes) => {
      if (cancelled) return;
      if (!bytes) {
        setState({ kind: "missing" });
        return;
      }
      url = URL.createObjectURL(new Blob([bytes.slice()], { type: image.mime }));
      setState({ kind: "ready", url, bytes });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // Re-run when the reference gains its chunkCount (synced after the first
    // render on another device) - that is what turns "missing" into the image.
  }, [image.id, image.chunkCount, image.mime]);

  if (state.kind === "loading") {
    return (
      <div className="flex h-40 w-40 items-center justify-center rounded-lg border border-quon-border bg-quon-surface-2 text-[11px] text-quon-muted">
        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> {t("chat.imageLoading")}
      </div>
    );
  }
  if (state.kind === "missing") {
    return (
      <div className="flex max-w-xs items-center gap-2 rounded-lg border border-quon-border bg-quon-surface-2 p-2 text-[11px] text-quon-muted">
        <ImageOff className="h-4 w-4 shrink-0" /> {t("chat.imageUnavailable")}
      </div>
    );
  }
  const ext = image.mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  return (
    <figure className="group relative max-w-full">
      <img
        src={state.url}
        alt={t("chat.generatedImageAlt")}
        className="max-h-[28rem] max-w-full rounded-lg border border-quon-border"
        data-testid="generated-image"
      />
      <button
        onClick={() =>
          downloadBytes(`quon-bild-${image.id.slice(0, 8)}.${ext}`, state.bytes, image.mime)
        }
        title={t("chat.downloadImage")}
        aria-label={t("chat.downloadImage")}
        className="absolute right-2 top-2 rounded-md bg-quon-surface/90 p-1.5 text-quon-text opacity-0 shadow transition group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Download className="h-4 w-4" />
      </button>
    </figure>
  );
}
