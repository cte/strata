import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteMcpSettings,
  getMcpSettingsStatus,
  listMcpTools,
  type McpSettingsStatus,
  type McpSettingsUpdateInput,
  updateMcpSettings,
} from "@/lib/api";
import { qk } from "./keys";

export function useMcpSettings() {
  return useQuery<McpSettingsStatus>({
    queryKey: qk.mcps.status,
    queryFn: () => getMcpSettingsStatus(),
  });
}

/** Writes return the fresh status, so seed the cache directly instead of refetching. */
function useMcpStatusWriter() {
  const queryClient = useQueryClient();
  return (status: McpSettingsStatus) => {
    queryClient.setQueryData(qk.mcps.status, status);
  };
}

export function useUpdateMcpSettings() {
  const writeStatus = useMcpStatusWriter();
  return useMutation({
    mutationFn: (input: McpSettingsUpdateInput) => updateMcpSettings(input),
    onSuccess: writeStatus,
  });
}

export function useDeleteMcpSettings() {
  const writeStatus = useMcpStatusWriter();
  return useMutation({
    mutationFn: (slug: string) => deleteMcpSettings(slug),
    onSuccess: writeStatus,
  });
}

/** On-demand tool listing for one server (button-triggered). */
export function useListMcpTools() {
  return useMutation({
    mutationFn: (input: { slug: string; serverUrl?: string }) =>
      listMcpTools(input.slug, input.serverUrl),
  });
}
