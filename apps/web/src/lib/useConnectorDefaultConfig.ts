import { useCallback, useEffect, useRef } from "react";
import type { ConnectorConfigName, ConnectorConfigProfile } from "@/lib/api";
import {
  useConnectorConfigProfiles,
  useSaveConnectorConfigProfile,
} from "@/lib/queries/connectors";

export type ConnectorConfigDraft = Record<string, unknown>;

export interface ConnectorDefaultConfigState {
  defaultProfile: ConnectorConfigProfile | null;
  error: string | null;
  isPending: boolean;
  loadDefault(): void;
  refresh(): void;
  saveDefault(input: { config: ConnectorConfigDraft; id?: string; label?: string }): Promise<void>;
}

/**
 * Connector default-config persistence over React Query. The shared
 * `["connectors", "config", connector]` query backs the default profile; the
 * save mutation seeds it write-through. The first time a default profile loads
 * it is applied to the caller's form via `onApplyDefault`; afterwards the user
 * re-applies explicitly with `loadDefault()` so a background refetch never
 * clobbers in-progress edits.
 */
export function useConnectorDefaultConfig(
  connector: ConnectorConfigName,
  onApplyDefault: (config: ConnectorConfigDraft, profile: ConnectorConfigProfile) => void,
): ConnectorDefaultConfigState {
  const profilesQuery = useConnectorConfigProfiles(connector);
  const saveMutation = useSaveConnectorConfigProfile();

  const onApplyDefaultRef = useRef(onApplyDefault);
  useEffect(() => {
    onApplyDefaultRef.current = onApplyDefault;
  }, [onApplyDefault]);

  const defaultProfile = profilesQuery.data?.defaultProfile ?? null;

  // Apply each distinct default profile exactly once when it first loads.
  const appliedProfileId = useRef<string | null>(null);
  useEffect(() => {
    if (defaultProfile && appliedProfileId.current !== defaultProfile.id) {
      appliedProfileId.current = defaultProfile.id;
      onApplyDefaultRef.current(defaultProfile.config, defaultProfile);
    }
  }, [defaultProfile]);

  const loadDefault = useCallback(() => {
    if (defaultProfile) {
      onApplyDefaultRef.current(defaultProfile.config, defaultProfile);
    }
  }, [defaultProfile]);

  const refresh = useCallback(() => {
    void profilesQuery.refetch();
  }, [profilesQuery]);

  const saveDefault = useCallback(
    async (input: { config: ConnectorConfigDraft; id?: string; label?: string }) => {
      await saveMutation.mutateAsync({
        connector,
        config: input.config,
        makeDefault: true,
        ...(input.id === undefined ? {} : { id: input.id }),
        ...(input.label === undefined ? {} : { label: input.label }),
      });
    },
    [connector, saveMutation],
  );

  return {
    defaultProfile,
    error: profilesQuery.error ? messageOf(profilesQuery.error) : null,
    isPending: profilesQuery.isFetching || saveMutation.isPending,
    loadDefault,
    refresh,
    saveDefault,
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
