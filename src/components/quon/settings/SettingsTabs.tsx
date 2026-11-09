/**
 * Tab shell for the Settings screen.
 *
 * Tabs (in order):
 *   Detection  - ProtectionLevelCard · DetectionTypesCard · RedactionListsCard
 *   Providers  - UsageCard (hosted only) · OpenRouterKeyCard · <ProvidersSettings/>
 *   Account    - read-only email + management placeholder
 *   Subscription - coming soon
 *   Connectors - coming soon
 *
 * The tab bar scrolls horizontally at narrow viewports (375 px mobile).
 */
import { Settings2, Shield, User } from "lucide-react";

import { useQuonHealth } from "@/hooks/useQuonHealth";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/lib/i18n/i18n";
import type { MessageKey } from "@/lib/i18n/catalog";

import { ProvidersSettings } from "../ProvidersSettings";
import { AccountSettings } from "./AccountSettings";
import { ContextDefaultCard } from "./ContextDefaultCard";
import { OpenRouterKeyCard } from "./OpenRouterKeyCard";
import { ProtectionLevelCard } from "./ProtectionLevelCard";
import { ReasoningDefaultCard } from "./ReasoningDefaultCard";
import { DetectionTypesCard } from "./DetectionTypesCard";
import { RedactionListsCard } from "./RedactionListsCard";
import { UsageCard } from "./UsageCard";
import { useSettings } from "./useSettings";

const TAB_TRIGGERS: Array<{ value: string; labelKey: MessageKey; Icon: typeof Shield }> = [
  { value: "detection", labelKey: "settings.tabDetection", Icon: Shield },
  { value: "providers", labelKey: "settings.tabProviders", Icon: Settings2 },
  { value: "account", labelKey: "settings.tabAccount", Icon: User },
];

export function SettingsTabs() {
  const { t } = useT();
  const { health } = useQuonHealth();
  const { configured, ownKey, region, connections, reachable, applySettings } = useSettings();

  return (
    <Tabs defaultValue="detection" className="flex min-h-0 flex-1 flex-col">
      {/* Tab bar - scrolls horizontally at 375 px */}
      <TabsList
        className="flex w-full shrink-0 overflow-x-auto rounded-none border-b border-quon-border bg-transparent px-0 pb-0"
        style={{ height: "auto" }}
      >
        {TAB_TRIGGERS.map(({ value, labelKey, Icon }) => (
          <TabsTrigger
            key={value}
            value={value}
            className="
              flex shrink-0 flex-col items-center gap-0.5 rounded-none border-b-2 border-transparent
              px-3 pb-2 pt-1.5 text-[10px] font-semibold uppercase tracking-wide
              text-quon-muted transition-colors
              hover:text-quon-text
              data-[state=active]:border-quon-indigo data-[state=active]:bg-transparent
              data-[state=active]:text-quon-indigo data-[state=active]:shadow-none
              sm:flex-row sm:gap-1.5 sm:px-4 sm:text-xs
            "
          >
            <Icon className="h-3.5 w-3.5 shrink-0 sm:h-3.5 sm:w-3.5" />
            <span>{t(labelKey)}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      {/* Scrollable content area */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Detection */}
        <TabsContent value="detection" className="mt-0 space-y-5 p-5 md:px-8">
          <ProtectionLevelCard />
          <DetectionTypesCard />
          <RedactionListsCard />
        </TabsContent>

        {/* Providers */}
        <TabsContent value="providers" className="mt-0 space-y-5 p-5 md:px-8">
          <UsageCard />
          <OpenRouterKeyCard
            configured={configured}
            ownKey={ownKey}
            region={region}
            reachable={reachable}
            onApply={applySettings}
          />
          <ProvidersSettings
            connections={connections}
            reachable={reachable}
            onChange={applySettings}
          />
          <ReasoningDefaultCard />
          <ContextDefaultCard />
        </TabsContent>

        {/* Account */}
        <TabsContent value="account" className="mt-0 space-y-5 p-5 md:px-8">
          <AccountSettings />
        </TabsContent>
      </div>
    </Tabs>
  );
}
