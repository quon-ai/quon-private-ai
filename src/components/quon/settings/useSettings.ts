/**
 * Shared hook: fetches the settings status once and exposes helpers so both
 * the Detection and Providers cards share a single network request.
 */
import { useEffect, useState } from "react";

import { getSettings, type ProviderConnection, type SettingsStatus } from "@/lib/quonApi";

export interface UseSettingsReturn {
  configured: boolean;
  ownKey: boolean;
  connections: ProviderConnection[];
  reachable: boolean | null;
  applySettings: (s: SettingsStatus) => void;
}

export function useSettings(): UseSettingsReturn {
  const [configured, setConfigured] = useState(false);
  const [ownKey, setOwnKey] = useState(false);
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);

  function applySettings(s: SettingsStatus) {
    setConfigured(s.openrouter_configured);
    setOwnKey(!!s.own_openrouter_key);
    setConnections(s.connections);
  }

  useEffect(() => {
    getSettings()
      .then((s) => {
        applySettings(s);
        setReachable(true);
      })
      .catch(() => setReachable(false));
  }, []);

  return {
    configured,
    ownKey,
    connections,
    reachable,
    applySettings,
  };
}
