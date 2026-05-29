import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  type ConnectorConfigName,
  type ConnectorConfigProfile,
  type ConnectorConfigProfileSaveInput,
  getConnectorConfigProfiles,
  saveConnectorConfigProfile,
} from "@/lib/api";

export type ConnectorConfigDraft = Record<string, unknown>;

export interface ConnectorDefaultConfigState {
  defaultProfile: ConnectorConfigProfile | null;
  error: string | null;
  isPending: boolean;
  loadDefault(): void;
  refresh(): void;
  saveDefault(input: { config: ConnectorConfigDraft; id?: string; label?: string }): Promise<void>;
}

export function useConnectorDefaultConfig(
  connector: ConnectorConfigName,
  onApplyDefault: (config: ConnectorConfigDraft, profile: ConnectorConfigProfile) => void,
): ConnectorDefaultConfigState {
  const [defaultProfile, setDefaultProfile] = useState<ConnectorConfigProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const onApplyDefaultRef = useRef(onApplyDefault);

  useEffect(() => {
    onApplyDefaultRef.current = onApplyDefault;
  }, [onApplyDefault]);

  const refresh = useCallback(() => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await getConnectorConfigProfiles(connector);
        setDefaultProfile(result.defaultProfile);
        if (result.defaultProfile) {
          onApplyDefaultRef.current(result.defaultProfile.config, result.defaultProfile);
        }
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  }, [connector]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadDefault = useCallback(() => {
    if (defaultProfile) {
      onApplyDefaultRef.current(defaultProfile.config, defaultProfile);
    }
  }, [defaultProfile]);

  const saveDefault = useCallback(
    async (input: { config: ConnectorConfigDraft; id?: string; label?: string }) => {
      setError(null);
      const payload: ConnectorConfigProfileSaveInput = {
        connector,
        config: input.config,
        makeDefault: true,
      };
      if (input.id !== undefined) {
        payload.id = input.id;
      }
      if (input.label !== undefined) {
        payload.label = input.label;
      }
      const result = await saveConnectorConfigProfile(payload);
      setDefaultProfile(result.defaultProfile);
    },
    [connector],
  );

  return {
    defaultProfile,
    error,
    isPending,
    loadDefault,
    refresh,
    saveDefault,
  };
}
