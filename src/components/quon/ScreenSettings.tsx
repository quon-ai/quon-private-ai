import { LogOut } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";
import { LegalLinks } from "./LegalPage";
import { SettingsTabs } from "./settings/SettingsTabs";

export function ScreenSettings({ onLogout }: { onLogout: () => void }) {
  const { t } = useT();
  return (
    <div className="flex min-h-0 flex-1 flex-col px-0 py-0">
      <div className="shrink-0 px-5 pb-0 pt-5 md:px-8">
        <h1 className="text-base font-semibold text-quon-text">{t("settings.pageTitle")}</h1>
        <p className="mt-1 text-xs text-quon-muted">{t("settings.pageSubtitle")}</p>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        <SettingsTabs />
      </div>

      <div className="shrink-0 px-5 pb-5 pt-3 md:px-8">
        <button
          onClick={onLogout}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-quon-border bg-quon-surface px-4 py-2.5 text-xs font-semibold text-quon-muted transition hover:border-red-500/40 hover:text-red-400"
        >
          <LogOut className="h-3.5 w-3.5" /> {t("nav.signOut")}
        </button>
        <LegalLinks className="mt-3" />
      </div>
    </div>
  );
}
