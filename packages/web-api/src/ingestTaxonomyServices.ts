import path from "node:path";
import {
  addIngestTaxonomyProjectAlias,
  addIngestTaxonomySelfName,
  addIngestTaxonomySlackPattern,
  applyIngestTaxonomyProposal,
  readIngestTaxonomy,
  stageIngestTaxonomyProposal,
} from "@strata/ingest/ingest-taxonomy";
import { repoRoot, type WebApiOptions } from "./runtime.js";
import type {
  IngestTaxonomyProjectAliasRpcInput,
  IngestTaxonomyProposalApplyRpcInput,
  IngestTaxonomySelfNameRpcInput,
  IngestTaxonomySlackPatternRpcInput,
} from "./trpc.js";

export async function getIngestTaxonomyForWeb(options: WebApiOptions = {}) {
  const root = repoRoot(options);
  return webTaxonomyResult(root, await readIngestTaxonomy(root));
}

export async function addIngestTaxonomyProjectAliasForWeb(
  input: IngestTaxonomyProjectAliasRpcInput,
  options: WebApiOptions = {},
) {
  const root = repoRoot(options);
  const operation = {
    kind: "ingest.taxonomy.addProjectAlias" as const,
    label: input.label,
    aliases: input.aliases,
  };
  if (input.propose) {
    return {
      proposal: await stageIngestTaxonomyProposal(root, {
        operation,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      }),
    };
  }
  return webTaxonomyResult(
    root,
    await addIngestTaxonomyProjectAlias(root, {
      label: input.label,
      aliases: input.aliases,
    }),
  );
}

export async function addIngestTaxonomySelfNameForWeb(
  input: IngestTaxonomySelfNameRpcInput,
  options: WebApiOptions = {},
) {
  const root = repoRoot(options);
  const operation = {
    kind: "ingest.taxonomy.addSelfName" as const,
    name: input.name,
  };
  if (input.propose) {
    return {
      proposal: await stageIngestTaxonomyProposal(root, {
        operation,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      }),
    };
  }
  return webTaxonomyResult(root, await addIngestTaxonomySelfName(root, { name: input.name }));
}

export async function addIngestTaxonomySlackPatternForWeb(
  input: IngestTaxonomySlackPatternRpcInput,
  options: WebApiOptions = {},
) {
  const root = repoRoot(options);
  const operation = {
    kind: "ingest.taxonomy.addSlackPattern" as const,
    field: input.field,
    rule: input.rule,
  };
  if (input.propose) {
    return {
      proposal: await stageIngestTaxonomyProposal(root, {
        operation,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      }),
    };
  }
  return webTaxonomyResult(
    root,
    await addIngestTaxonomySlackPattern(root, {
      field: input.field,
      rule: input.rule,
    }),
  );
}

export async function applyIngestTaxonomyProposalForWeb(
  input: IngestTaxonomyProposalApplyRpcInput,
  options: WebApiOptions = {},
) {
  const root = repoRoot(options);
  const result = await applyIngestTaxonomyProposal(root, {
    selector: input.id,
    actor: "web",
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  });
  return {
    ...result,
    path: path.relative(root, result.path),
  };
}

function webTaxonomyResult<T extends { path: string }>(root: string, result: T): T {
  return {
    ...result,
    path: path.relative(root, result.path),
  };
}
