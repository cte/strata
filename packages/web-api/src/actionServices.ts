import {
  addWikiAction,
  deleteWikiAction,
  listWikiActions,
  updateWikiAction,
  type WikiActionItem,
} from "@strata/core/wiki-actions";
import { repoRoot, type WebApiOptions } from "./runtime.js";
import type {
  WikiActionAddRpcInput,
  WikiActionDeleteRpcInput,
  WikiActionListRpcInput,
  WikiActionUpdateRpcInput,
} from "./trpc.js";

export async function listWikiActionsForWeb(
  input: WikiActionListRpcInput,
  options: WebApiOptions,
): Promise<{ actions: WikiActionItem[] }> {
  return {
    actions: await listWikiActions(repoRoot(options), {
      owner: input.owner,
      status: input.status,
      query: input.query,
    }),
  };
}

export async function updateWikiActionForWeb(
  input: WikiActionUpdateRpcInput,
  options: WebApiOptions,
): Promise<{ action: WikiActionItem }> {
  return {
    action: await updateWikiAction(repoRoot(options), {
      id: input.id,
      ...(input.completed === undefined ? {} : { completed: input.completed }),
      ...(input.context === undefined ? {} : { context: input.context }),
    }),
  };
}

export async function addWikiActionForWeb(
  input: WikiActionAddRpcInput,
  options: WebApiOptions,
): Promise<{ action: WikiActionItem }> {
  return {
    action: await addWikiAction(repoRoot(options), {
      owner: input.owner,
      title: input.title,
      ...(input.context === undefined ? {} : { context: input.context }),
    }),
  };
}

export async function deleteWikiActionForWeb(
  input: WikiActionDeleteRpcInput,
  options: WebApiOptions,
): Promise<{ deleted: boolean }> {
  return deleteWikiAction(repoRoot(options), { id: input.id });
}
