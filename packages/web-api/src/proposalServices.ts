import path from "node:path";
import {
  applyLearningProposal,
  listLearningProposals,
  readLearningProposal,
  updateLearningProposalStatus,
} from "@strata/core/proposal-store";
import {
  applyIngestTaxonomyProposal,
  parseIngestTaxonomyOperationFromProposal,
} from "@strata/ingest/ingest-taxonomy";
import { repoRoot, type WebApiOptions } from "./runtime.js";
import type { ProposalActionRpcInput, ProposalGetRpcInput, ProposalListRpcInput } from "./trpc.js";

export async function listProposalsForWeb(
  input: ProposalListRpcInput,
  options: WebApiOptions = {},
) {
  return {
    proposals: await listLearningProposals(repoRoot(options), input),
  };
}

export async function getProposalForWeb(input: ProposalGetRpcInput, options: WebApiOptions = {}) {
  const detail = await readLearningProposal(repoRoot(options), input.id);
  if (detail === undefined) {
    return null;
  }
  if (detail.proposal.kind === "schema" && isIngestTaxonomyProposal(detail.content)) {
    return {
      ...detail,
      apply: {
        supported: true,
        mode: "ingest.taxonomy" as const,
        targetPath: ".strata/ingest/taxonomy.json",
        message: "This schema proposal can update the local ingest taxonomy.",
        ...(detail.apply.previewFingerprint === undefined
          ? {}
          : { previewFingerprint: detail.apply.previewFingerprint }),
      },
    };
  }
  return detail;
}

export async function applyProposalFromWeb(
  input: ProposalActionRpcInput,
  options: WebApiOptions = {},
) {
  const root = repoRoot(options);
  const detail = await readLearningProposal(root, input.id);
  if (detail?.proposal.kind === "schema" && isIngestTaxonomyProposal(detail.content)) {
    const result = await applyIngestTaxonomyProposal(root, {
      selector: input.id,
      actor: "web",
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    });
    return {
      proposal: result.proposal,
      applied: true,
      mode: "ingest.taxonomy" as const,
      writtenPaths: [path.relative(root, result.path)],
      message: `${result.changed ? "Applied" : "No-op"} ingest taxonomy proposal ${result.proposal.path}.`,
    };
  }
  return applyLearningProposal(root, {
    selector: input.id,
    actor: "web",
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.previewFingerprint === undefined
      ? {}
      : { previewFingerprint: input.previewFingerprint }),
  });
}

function isIngestTaxonomyProposal(content: string): boolean {
  try {
    parseIngestTaxonomyOperationFromProposal(content);
    return true;
  } catch {
    return false;
  }
}

export async function rejectProposalFromWeb(
  input: ProposalActionRpcInput,
  options: WebApiOptions = {},
) {
  return {
    proposal: await updateLearningProposalStatus(repoRoot(options), {
      selector: input.id,
      status: "rejected",
      actor: "web",
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    }),
  };
}

export async function deferProposalFromWeb(
  input: ProposalActionRpcInput,
  options: WebApiOptions = {},
) {
  return {
    proposal: await updateLearningProposalStatus(repoRoot(options), {
      selector: input.id,
      status: "deferred",
      actor: "web",
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    }),
  };
}
