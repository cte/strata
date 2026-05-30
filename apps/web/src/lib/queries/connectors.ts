import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ConnectorConfigName,
  type ConnectorConfigProfileSaveInput,
  type ConnectorConfigProfilesResult,
  type ConnectorSummary,
  configureGranola,
  disconnectGranola,
  disconnectNotionMcp,
  type GranolaConfigureInput,
  type GranolaStatus,
  getConnectorConfigProfiles,
  getConnectors,
  getGranolaStatus,
  getNotionMcpStatus,
  listNotionMcpTools,
  type NotionMcpStatus,
  saveConnectorConfigProfile,
  startNotionMcpAuth,
} from "@/lib/api";
import { qk } from "./keys";

/** Shared connector summary list — de-dupes the fetch across all connector pages. */
export function useConnectors() {
  return useQuery<ConnectorSummary[]>({
    queryKey: qk.connectors.list,
    queryFn: () => getConnectors(),
  });
}

export function useGranolaStatus() {
  return useQuery<GranolaStatus>({
    queryKey: qk.connectors.granolaStatus,
    queryFn: () => getGranolaStatus(),
  });
}

export function useNotionMcpStatus() {
  return useQuery<NotionMcpStatus>({
    queryKey: qk.connectors.notionMcpStatus,
    queryFn: () => getNotionMcpStatus(),
  });
}

export function useConnectorConfigProfiles(connector: ConnectorConfigName) {
  return useQuery<ConnectorConfigProfilesResult>({
    queryKey: qk.connectors.configProfiles(connector),
    queryFn: () => getConnectorConfigProfiles(connector),
  });
}

export function useConfigureGranola() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GranolaConfigureInput) => configureGranola(input),
    onSuccess: (status) => {
      queryClient.setQueryData(qk.connectors.granolaStatus, status);
      void queryClient.invalidateQueries({ queryKey: qk.connectors.list });
    },
  });
}

export function useDisconnectGranola() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectGranola(),
    onSuccess: (status) => {
      queryClient.setQueryData(qk.connectors.granolaStatus, status);
      void queryClient.invalidateQueries({ queryKey: qk.connectors.list });
    },
  });
}

export function useStartNotionMcpAuth() {
  return useMutation({
    mutationFn: (origin: string) => startNotionMcpAuth(origin),
  });
}

export function useListNotionMcpTools() {
  return useMutation({
    mutationFn: () => listNotionMcpTools(),
  });
}

export function useDisconnectNotionMcp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectNotionMcp(),
    onSuccess: (status) => {
      queryClient.setQueryData(qk.connectors.notionMcpStatus, status);
    },
  });
}

export function useSaveConnectorConfigProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnectorConfigProfileSaveInput) => saveConnectorConfigProfile(input),
    onSuccess: (result) => {
      queryClient.setQueryData(qk.connectors.configProfiles(result.connector), result);
    },
  });
}
