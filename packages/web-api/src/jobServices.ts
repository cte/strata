import { createDefaultJobRegistry } from "@strata/jobs";

export function listJobs() {
  return { jobs: createDefaultJobRegistry().list() };
}
