import { Link, useRouterState } from "@tanstack/react-router";
import { Brain, FileText, LayoutDashboard, MessageSquare } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";

const tabs = [
  { titleKey: "nav.dashboard", url: "/dashboard", icon: LayoutDashboard, disabled: false },
  { titleKey: "nav.chat", url: "/chat", icon: MessageSquare, disabled: false },
  { titleKey: "nav.memory", url: "/memory", icon: Brain, disabled: false },
  { titleKey: "nav.documents", url: "/documents", icon: FileText, disabled: false },
] as const;

export function BottomTabBar() {
  const { t } = useT();
  const currentPath = useRouterState({
    select: (router) => router.location.pathname,
  });

  return (
    <nav
      className="sticky bottom-0 z-30 border-t border-quon-border bg-quon-bg/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-5">
        {tabs.map((tab) => {
          const active = currentPath === tab.url;
          const title = t(tab.titleKey);
          if (tab.disabled) {
            return (
              <li key={tab.url}>
                <div
                  aria-disabled
                  title={t("nav.comingSoon")}
                  className="flex cursor-not-allowed flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium text-quon-muted opacity-40"
                >
                  <tab.icon className="h-5 w-5" />
                  <span>{title}</span>
                </div>
              </li>
            );
          }
          return (
            <li key={tab.url}>
              <Link
                to={tab.url}
                className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium transition ${
                  active ? "text-quon-indigo" : "text-quon-muted hover:text-quon-text"
                }`}
              >
                <tab.icon
                  className={`h-5 w-5 ${active ? "drop-shadow-[0_0_6px_var(--quon-indigo)]" : ""}`}
                />
                <span>{title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
