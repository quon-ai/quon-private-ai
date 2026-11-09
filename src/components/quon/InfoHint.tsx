import { useState } from "react";
import { Info } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/lib/i18n/i18n";

/**
 * Small "i" icon that reveals a longer explanation on demand instead of it
 * sitting on the page as an always-visible paragraph - tap opens the bubble
 * on mobile, and the native `title` gives desktop users an immediate hover
 * tooltip too. Built for the Agents screen but generic - any long explanatory
 * copy elsewhere can reuse it.
 */
export function InfoHint({ text, label }: { text: string; label?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={text}
          aria-label={label ?? t("agents.infoAria")}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-quon-muted transition hover:text-quon-indigo"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-64 rounded-lg border border-quon-border bg-quon-surface p-2.5 text-[11px] leading-relaxed text-quon-muted shadow-lg"
      >
        {text}
      </PopoverContent>
    </Popover>
  );
}
